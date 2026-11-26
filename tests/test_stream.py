import tempfile
import time
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from unittest.mock import patch

import kg_playback
import kg_stream


@contextmanager
def server(handler):
    instance = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    instance.daemon_threads = True
    with instance:
        thread = Thread(target=instance.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        thread.start()
        try:
            yield instance.server_port
        finally:
            instance.shutdown()
            thread.join()


class FakeClient:
    userid = "stream-account"
    token = "test"

    def __init__(self, urls):
        self.urls = urls
        self.calls = 0

    def play_candidates(self, file_hash, mixsongid):
        self.calls += 1
        return list(self.urls), "320", "test"


SOURCE = {"file_hash": "c" * 32, "mixsongid": "3"}
SONG = b"ID3" + bytes(range(256)) * 40


def origin_factory(body=SONG, truncate_at=None, stall_at=None, stall_seconds=0,
                   expired_first=False, resume_total=None):
    """可配置故障的上游：断流 / 停顿 / 首链过期 / 续传总长不一致。"""
    hits = []

    class Origin(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            requested = self.headers.get("Range")
            hits.append(requested)
            if expired_first and len(hits) == 1:
                self.send_error(403)
                return
            start = 0
            end = len(body) - 1
            if requested and requested.startswith("bytes="):
                lo, _, hi = requested[len("bytes="):].partition("-")
                start = int(lo) if lo else 0
                if hi:
                    end = min(len(body) - 1, int(hi))
            if requested == "bytes=999999-":
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{len(body)}")
                self.end_headers()
                return
            total = resume_total if (resume_total and start) else len(body)
            data = body[start:end + 1]
            self.send_response(206)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Range", f"bytes {start}-{end}/{total}")
            self.end_headers()
            if truncate_at is not None and start == 0:
                self.wfile.write(body[:min(truncate_at, end + 1)])
                self.close_connection = True
                return
            if stall_at is not None and start == 0:
                self.wfile.write(body[:stall_at])
                self.wfile.flush()
                time.sleep(stall_seconds)
                try:
                    self.wfile.write(body[stall_at:])
                except OSError:
                    pass
                return
            self.wfile.write(data)

    return Origin, hits


class StreamTest(unittest.TestCase):
    def open_stream(self, urls, headers=None, links=None):
        return kg_stream.SongStream(FakeClient(urls), SOURCE,
                                    links or kg_playback.PlaybackLinks(),
                                    headers or {"Range": "bytes=0-"})

    def test_hanging_node_loses_race_to_healthy_node(self):
        class Slow(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                time.sleep(6)
                self.send_error(500)

        Origin, hits = origin_factory()
        with server(Slow) as slow_port, server(Origin) as fast_port:
            urls = [f"http://127.0.0.1:{slow_port}/hang", f"http://127.0.0.1:{fast_port}/audio"]
            started = time.monotonic()
            stream = self.open_stream(urls)
            elapsed = time.monotonic() - started
            self.assertLess(elapsed, 3)
            self.assertEqual(b"".join(stream.chunks()), SONG)
        self.assertEqual(hits, ["bytes=0-"])

    def test_truncated_upstream_resumes_from_offset(self):
        Origin, hits = origin_factory(truncate_at=1000)
        with server(Origin) as port:
            stream = self.open_stream([f"http://127.0.0.1:{port}/audio"])
            self.assertEqual(b"".join(stream.chunks()), SONG)
        self.assertEqual(hits, ["bytes=0-", "bytes=1000-"])

    def test_stalled_upstream_resumes_after_read_timeout(self):
        Origin, hits = origin_factory(stall_at=1000, stall_seconds=3)
        with server(Origin) as port, patch.object(kg_stream, "CONNECT_TIMEOUT", 1):
            stream = self.open_stream([f"http://127.0.0.1:{port}/audio"])
            self.assertEqual(b"".join(stream.chunks()), SONG)
        self.assertEqual(hits, ["bytes=0-", "bytes=1000-"])

    def test_expired_link_is_refreshed_once(self):
        Origin, hits = origin_factory(expired_first=True)
        with server(Origin) as port:
            client = FakeClient([f"http://127.0.0.1:{port}/audio"])
            links = kg_playback.PlaybackLinks()
            stream = kg_stream.SongStream(client, SOURCE, links, {"Range": "bytes=0-"})
            self.assertEqual(b"".join(stream.chunks()), SONG)
            self.assertEqual(client.calls, 2)
        self.assertEqual(hits, ["bytes=0-", "bytes=0-"])

    def test_out_of_range_seek_passes_416_through(self):
        Origin, hits = origin_factory()
        with server(Origin) as port:
            stream = self.open_stream([f"http://127.0.0.1:{port}/audio"],
                                      headers={"Range": "bytes=999999-"})
            self.assertEqual(stream.response.status, 416)
            self.assertEqual(b"".join(stream.chunks()), b"")

    def test_all_nodes_down_raises_user_readable_error(self):
        Origin, hits = origin_factory()
        with server(Origin) as port:
            urls = [f"http://127.0.0.1:{port}/audio"]
        try:
            with self.assertRaises(kg_stream.StreamUnavailable) as caught:
                self.open_stream(urls)
            self.assertIn("酷狗", str(caught.exception))
            self.assertIn("127.0.0.1", kg_api_penalty_hosts())
        finally:
            import kg_api
            kg_api._HOST_PENALTY.pop("127.0.0.1", None)

    def test_resume_with_mismatched_total_is_rejected(self):
        Origin, hits = origin_factory(truncate_at=1000, resume_total=len(SONG) + 1)
        with server(Origin) as port:
            stream = self.open_stream([f"http://127.0.0.1:{port}/audio"])
            self.assertEqual(b"".join(stream.chunks()), SONG[:1000])
        self.assertEqual(hits, ["bytes=0-", "bytes=1000-"])

    def test_candidates_cache_is_shared_and_refreshed_by_stale_url(self):
        Origin, hits = origin_factory()
        with server(Origin) as port:
            links = kg_playback.PlaybackLinks()
            client = FakeClient([f"http://127.0.0.1:{port}/audio"])
            first = kg_stream.SongStream(client, SOURCE, links, {"Range": "bytes=0-"})
            b"".join(first.chunks())
            second = kg_stream.SongStream(client, SOURCE, links, {"Range": "bytes=0-"})
            b"".join(second.chunks())
            self.assertEqual(client.calls, 1)
            refreshed = links.get(("c" * 32, "3", client.userid, client.token),
                                  lambda: client.play_candidates("c" * 32, "3")[0],
                                  stale_url=f"http://127.0.0.1:{port}/audio")
            self.assertEqual(client.calls, 2)
            self.assertEqual(refreshed, [f"http://127.0.0.1:{port}/audio"])

    def test_bounded_range_does_not_overread_or_trigger_spurious_resume(self):
        Origin, hits = origin_factory()
        with server(Origin) as port:
            stream = self.open_stream([f"http://127.0.0.1:{port}/audio"],
                                      headers={"Range": "bytes=0-999"})
            self.assertEqual(b"".join(stream.chunks()), SONG[:1000])
        self.assertEqual(hits, ["bytes=0-999"])

    def test_truncated_bounded_range_resumes_within_bounds(self):
        Origin, hits = origin_factory(truncate_at=1000)
        with server(Origin) as port:
            stream = self.open_stream([f"http://127.0.0.1:{port}/audio"],
                                      headers={"Range": "bytes=0-1999"})
            self.assertEqual(b"".join(stream.chunks()), SONG[:2000])
        self.assertEqual(hits, ["bytes=0-1999", "bytes=1000-1999"])

    def test_non_audio_200_response_loses_race_to_healthy_node(self):
        class HtmlError(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                body = b"<html>blocked</html>"
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        Origin, hits = origin_factory()
        with server(HtmlError) as bad_port, server(Origin) as good_port:
            urls = [f"http://127.0.0.1:{bad_port}/bad", f"http://127.0.0.1:{good_port}/audio"]
            stream = self.open_stream(urls)
            self.assertEqual(b"".join(stream.chunks()), SONG)
        self.assertEqual(hits, ["bytes=0-"])

    def test_quality_fallback_when_top_quality_unreachable(self):
        Origin, hits = origin_factory()
        with server(Origin) as dead_port:
            dead_url = f"http://127.0.0.1:{dead_port}/dead.flac"

        class MultiQualityClient:
            userid = "fallback-account"
            token = "test"

            def __init__(self, good_url):
                self.good_url = good_url
                self.requested = []

            def play_candidates(self, file_hash, mixsongid, qualities=None):
                self.requested.append(qualities)
                if qualities is None or qualities == ("flac",):
                    return [dead_url], "flac", "test"
                if qualities == ("320",):
                    return [self.good_url], "320", "test"
                return [], "", "none"

        with server(Origin) as good_port:
            client = MultiQualityClient(f"http://127.0.0.1:{good_port}/good.mp3")
            try:
                stream = kg_stream.SongStream(client, SOURCE,
                                              kg_playback.PlaybackLinks(),
                                              {"Range": "bytes=0-"})
                self.assertEqual(b"".join(stream.chunks()), SONG)
                self.assertEqual(client.requested, [None, ("320",)])
            finally:
                import kg_api
                kg_api._HOST_PENALTY.pop("127.0.0.1", None)
        self.assertEqual(hits, ["bytes=0-"])

    def test_slow_node_switches_to_healthy_alternative(self):
        slow_hits = []
        fast_hits = []

        class SlowNode(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                slow_hits.append(self.headers.get("Range"))
                self.send_response(206)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(SONG)))
                self.send_header("Content-Range", f"bytes 0-{len(SONG) - 1}/{len(SONG)}")
                self.end_headers()
                try:
                    self.wfile.write(SONG[:100])
                    self.wfile.flush()
                    time.sleep(0.25)
                    self.wfile.write(SONG[100:200])
                    self.wfile.flush()
                    time.sleep(0.5)
                except OSError:
                    pass

        class FastNode(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                requested = self.headers.get("Range")
                if requested == "bytes=0-":
                    time.sleep(0.15)  # 让慢节点先赢得首次建连竞速
                fast_hits.append(requested)
                start = 0 if requested in (None, "bytes=0-") else int(requested[len("bytes="):-1])
                data = SONG[start:]
                self.send_response(206)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Content-Range", f"bytes {start}-{len(SONG) - 1}/{len(SONG)}")
                self.end_headers()
                try:
                    self.wfile.write(data)
                except OSError:
                    pass

        with (server(SlowNode) as slow_port, server(FastNode) as fast_port,
              patch.object(kg_stream, "SLOW_WINDOW_SECONDS", 0.15),
              patch.object(kg_stream, "SLOW_MIN_BPS", 1024 * 1024),
              patch.object(kg_stream, "SLOW_MIN_REMAINING", 100)):
            try:
                urls = [f"http://127.0.0.1:{slow_port}/audio", f"http://127.0.0.1:{fast_port}/audio"]
                stream = self.open_stream(urls)
                self.assertEqual(b"".join(stream.chunks()), SONG)
                self.assertEqual(slow_hits, ["bytes=0-"])
                self.assertTrue(any(h and h != "bytes=0-" for h in fast_hits), f"expected resume on fast node, got {fast_hits}")
            finally:
                import kg_api
                kg_api._HOST_PENALTY.pop("127.0.0.1", None)


def kg_api_penalty_hosts():
    import kg_api
    return dict(kg_api._HOST_PENALTY)


if __name__ == "__main__":
    unittest.main()
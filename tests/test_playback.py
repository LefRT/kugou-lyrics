import os
import tempfile
import time
import unittest
from contextlib import contextmanager
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Thread
from unittest.mock import patch

import kg_playback
import kg_web


@contextmanager
def server(handler):
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as instance:
        thread = Thread(target=instance.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        thread.start()
        try:
            yield instance.server_port
        finally:
            instance.shutdown()
            thread.join()


class PlaybackTest(unittest.TestCase):
    def test_first_bytes_arrive_before_upstream_completes_and_seek_uses_disk(self):
        prefix = b"ID3" + b"a" * 61
        song = prefix + b"b" * 4096
        finish = Event()
        upstream_hits = []
        resolutions = []

        class Origin(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                upstream_hits.append((self.path, self.headers.get("Range")))
                if self.path == "/old":
                    self.send_error(403)
                    return
                requested = self.headers.get("Range")
                if requested == "bytes=999999-":
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{len(song)}")
                    self.end_headers()
                    return
                data = song if requested == "bytes=0-" else song[4:12]
                self.send_response(206)
                start = 0 if data is song else 4
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Content-Range", f"bytes {start}-{start + len(data) - 1}/{len(song)}")
                self.end_headers()
                if data is song:
                    self.wfile.write(prefix)
                    if finish.wait(5):
                        self.wfile.write(song[len(prefix):])
                else:
                    self.wfile.write(data)

        class Client:
            userid = "first-account"
            token = "test"
            logged_in = True

            def play_candidates(self, file_hash, mixsongid):
                target = "/old" if not resolutions else "/audio"
                resolutions.append((self.userid, file_hash, mixsongid))
                return [f"http://127.0.0.1:{origin_port}{target}"], "320", "test"

        def request(port, byte_range, expected_status, expected_body, expected_content_range):
            connection = HTTPConnection("127.0.0.1", port, timeout=3)
            try:
                connection.request("GET", "/api/song/stream?song_id=1", headers={"Range": byte_range})
                with connection.getresponse() as response:
                    self.assertEqual(response.status, expected_status)
                    self.assertEqual(response.getheader("Content-Range"), expected_content_range)
                    self.assertEqual(response.read(), expected_body)
            finally:
                connection.close()

        with tempfile.TemporaryDirectory() as directory, server(Origin) as origin_port:
            cache = kg_playback.AudioCache(directory)
            source = {"file_hash": "a" * 32, "mixsongid": "1"}
            path = cache.path(Client.userid, source["file_hash"], source["mixsongid"])
            with (patch.object(kg_web, "_song_source", return_value=source),
                  patch.object(kg_web, "_playback_audio", cache),
                  patch.object(kg_web, "_playback_links", kg_playback.PlaybackLinks()),
                  patch.object(kg_web.kg_api, "KugouClient", Client),
                  server(kg_web.Handler) as port):
                connection = HTTPConnection("127.0.0.1", port, timeout=3)
                try:
                    connection.request("GET", "/api/song/stream?song_id=1", headers={"Range": "bytes=0-"})
                    with connection.getresponse() as response:
                        self.assertEqual(response.status, 206)
                        self.assertEqual(response.read(len(prefix)), prefix)
                        self.assertFalse(path.exists())
                        finish.set()
                        self.assertEqual(response.read(), song[len(prefix):])
                finally:
                    finish.set()
                    connection.close()

                for _ in range(100):
                    if path.exists():
                        break
                    time.sleep(0.01)
                self.assertEqual(path.read_bytes(), song)
                request(port, "bytes=4-11", 206, song[4:12], f"bytes 4-11/{len(song)}")
                request(port, "bytes=-5", 206, song[-5:], f"bytes {len(song) - 5}-{len(song) - 1}/{len(song)}")
                request(port, "bytes=999999-", 416, b"", f"bytes */{len(song)}")
                self.assertEqual(upstream_hits, [("/old", "bytes=0-"), ("/audio", "bytes=0-")])
                self.assertEqual(len(resolutions), 2)

                Client.userid = "different-account"
                request(port, "bytes=999999-", 416, b"", f"bytes */{len(song)}")
                request(port, "bytes=4-11", 206, song[4:12], f"bytes 4-11/{len(song)}")
                self.assertEqual(upstream_hits[-2:], [("/audio", "bytes=999999-"), ("/audio", "bytes=4-11")])
                self.assertEqual(len(resolutions), 3)
                self.assertFalse(cache.path(Client.userid, source["file_hash"], source["mixsongid"]).exists())

    def test_unreachable_host_is_deprioritized_until_penalty_expires(self):
        import kg_api
        data = {"url": ["http://bad.example/a.flac", "http://good.example/a.flac"]}
        try:
            self.assertEqual(kg_api.KugouClient._play_urls(data),
                             ["http://bad.example/a.flac", "http://good.example/a.flac"])
            kg_api.note_unreachable("http://bad.example/a.flac")
            self.assertEqual(kg_api.KugouClient._play_urls(data)[0], "http://good.example/a.flac")
            # 惩罚过期后恢复原顺序；坏节点仍在候选里，不会把歌判成不可播
            kg_api._HOST_PENALTY["bad.example"] = time.monotonic() - 1
            self.assertEqual(kg_api.KugouClient._play_urls(data)[0], "http://bad.example/a.flac")
        finally:
            kg_api._HOST_PENALTY.pop("bad.example", None)

    def test_truncated_upstream_is_resumed_from_byte_offset(self):
        song = b"ID3" + bytes(range(256)) * 40
        hits = []

        class Origin(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                requested = self.headers.get("Range")
                hits.append(requested)
                start = 0 if requested == "bytes=0-" else int(requested[len("bytes="):-1])
                data = song[start:]
                self.send_response(206)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Content-Range", f"bytes {start}-{len(song) - 1}/{len(song)}")
                self.end_headers()
                if start == 0:
                    self.wfile.write(song[:1000])
                    self.close_connection = True  # 模拟传到一半上游断流
                else:
                    self.wfile.write(data)

        class Client:
            userid = "resume-account"
            token = "test"
            logged_in = True

            def play_candidates(self, file_hash, mixsongid):
                return [f"http://127.0.0.1:{origin_port}/audio"], "320", "test"

        with tempfile.TemporaryDirectory() as directory, server(Origin) as origin_port:
            cache = kg_playback.AudioCache(directory)
            source = {"file_hash": "b" * 32, "mixsongid": "2"}
            path = cache.path(Client.userid, source["file_hash"], source["mixsongid"])
            with (patch.object(kg_web, "_song_source", return_value=source),
                  patch.object(kg_web, "_playback_audio", cache),
                  patch.object(kg_web, "_playback_links", kg_playback.PlaybackLinks()),
                  patch.object(kg_web.kg_api, "KugouClient", Client),
                  server(kg_web.Handler) as port):
                connection = HTTPConnection("127.0.0.1", port, timeout=5)
                try:
                    connection.request("GET", "/api/song/stream?song_id=2", headers={"Range": "bytes=0-"})
                    with connection.getresponse() as response:
                        self.assertEqual(response.status, 206)
                        self.assertEqual(response.read(), song)
                finally:
                    connection.close()
                for _ in range(100):
                    if path.exists():
                        break
                    time.sleep(0.01)
                self.assertEqual(path.read_bytes(), song)
        self.assertEqual(hits, ["bytes=0-", "bytes=1000-"])

    def test_incomplete_or_interrupted_stream_is_never_published(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = kg_playback.AudioCache(directory)
            path = cache.path("account", "a" * 32, "1")
            self.assertEqual(b"".join(cache.capture(path, [b"ID3abc"], 12)), b"ID3abc")
            stalled = cache.capture(path, [b"ID3abc", b"second"], 12)
            next(stalled)
            stalled.close()
            self.assertEqual(list(cache.directory.iterdir()), [])
            self.assertIsNone(cache.open(path))

    def test_disk_budget_and_expiration(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = kg_playback.AudioCache(directory, budget=24, ttl=120)
            data = b"fLaC" + b"0" * 8
            paths = [cache.path("account", str(index), "1") for index in range(3)]
            for index, path in enumerate(paths):
                self.assertEqual(b"".join(cache.capture(path, [data], len(data))), data)
                timestamp = time.time() - 60 + 10 * index
                os.utime(path, (timestamp, timestamp))
            self.assertFalse(paths[0].exists())
            handle, ctype = cache.open(paths[1])
            with handle:
                self.assertEqual(ctype, "audio/flac")
            expired = time.time() - 121
            os.utime(paths[1], (expired, expired))
            self.assertIsNone(cache.open(paths[1]))

    def test_stream_error_is_reported_by_diag_url_and_cleared_on_success(self):
        import json
        song = b"ID3" + bytes(range(256)) * 10

        class Origin(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(206)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(song)))
                self.send_header("Content-Range", f"bytes 0-{len(song) - 1}/{len(song)}")
                self.end_headers()
                self.wfile.write(song)

        with server(Origin) as dead_port:
            dead_url = f"http://127.0.0.1:{dead_port}/dead.mp3"

        current_url = [dead_url]

        class Client:
            userid = "diag-account"
            token = "test"
            logged_in = True

            def play_candidates(self, file_hash, mixsongid, qualities=None):
                return [current_url[0]], "320", "test"

        with tempfile.TemporaryDirectory() as directory, server(Origin) as live_port:
            cache = kg_playback.AudioCache(directory)
            source = {"file_hash": "d" * 32, "mixsongid": "9"}
            links = kg_playback.PlaybackLinks()
            with (patch.object(kg_web, "_song_source", return_value=source),
                  patch.object(kg_web, "_playback_audio", cache),
                  patch.object(kg_web, "_playback_links", links),
                  patch.object(kg_web.kg_api, "KugouClient", Client),
                  server(kg_web.Handler) as port):
                try:
                    # 1. 拉流节点不可达：返回 503 且带 no-store
                    conn = HTTPConnection("127.0.0.1", port, timeout=5)
                    conn.request("GET", "/api/song/stream?song_id=9", headers={"Range": "bytes=0-"})
                    with conn.getresponse() as resp:
                        self.assertEqual(resp.status, 503)
                        self.assertEqual(resp.getheader("Cache-Control"), "no-store")
                        body = json.loads(resp.read())
                        self.assertIn("酷狗", body["error"])
                    conn.close()

                    # 2. diag=1 诊断接口返回刚记录的拉流失败原因；不带 diag 仍按直链检查返回 200
                    conn = HTTPConnection("127.0.0.1", port, timeout=5)
                    conn.request("GET", "/api/song/url?song_id=9&diag=1")
                    with conn.getresponse() as resp:
                        self.assertEqual(resp.status, 503)
                        self.assertIn("酷狗", json.loads(resp.read())["error"])
                    conn.close()

                    conn = HTTPConnection("127.0.0.1", port, timeout=5)
                    conn.request("GET", "/api/song/url?song_id=9")
                    with conn.getresponse() as resp:
                        self.assertEqual(resp.status, 200)
                        self.assertEqual(json.loads(resp.read())["url"], dead_url)
                    conn.close()

                    # 3. 节点恢复并播放成功后，旧诊断错误自动清除
                    current_url[0] = f"http://127.0.0.1:{live_port}/live.mp3"
                    links._entries.clear()
                    conn = HTTPConnection("127.0.0.1", port, timeout=5)
                    conn.request("GET", "/api/song/stream?song_id=9", headers={"Range": "bytes=0-"})
                    with conn.getresponse() as resp:
                        self.assertEqual(resp.status, 206)
                        self.assertEqual(resp.read(), song)
                    conn.close()

                    conn = HTTPConnection("127.0.0.1", port, timeout=5)
                    conn.request("GET", "/api/song/url?song_id=9&diag=1")
                    with conn.getresponse() as resp:
                        self.assertEqual(resp.status, 200)
                        self.assertEqual(json.loads(resp.read())["url"], current_url[0])
                    conn.close()
                finally:
                    import kg_api
                    kg_api._HOST_PENALTY.pop("127.0.0.1", None)
                    kg_web._clear_stream_error("9")

    def test_background_download_completes_after_client_disconnect_and_second_reader_joins(self):
        prefix = b"ID3" + b"a" * 61
        song = prefix + b"b" * 4096
        release = Event()
        upstream_hits = []

        class Origin(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                upstream_hits.append((self.path, self.headers.get("Range")))
                self.send_response(206)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(song)))
                self.send_header("Content-Range", f"bytes 0-{len(song) - 1}/{len(song)}")
                self.send_header("ETag", '"test-etag"')
                self.end_headers()
                self.wfile.write(prefix)
                self.wfile.flush()
                if release.wait(5):
                    self.wfile.write(song[len(prefix):])

        class Client:
            userid = "bg-account"
            token = "test"
            logged_in = True

            def play_candidates(self, file_hash, mixsongid, qualities=None):
                return [f"http://127.0.0.1:{origin_port}/audio"], "320", "test"

        with tempfile.TemporaryDirectory() as directory, server(Origin) as origin_port:
            cache = kg_playback.AudioCache(directory)
            source = {"file_hash": "e" * 32, "mixsongid": "10"}
            path = cache.path(Client.userid, source["file_hash"], source["mixsongid"])
            with (patch.object(kg_web, "_song_source", return_value=source),
                  patch.object(kg_web, "_playback_audio", cache),
                  patch.object(kg_web, "_playback_links", kg_playback.PlaybackLinks()),
                  patch.object(kg_web.kg_api, "KugouClient", Client),
                  server(kg_web.Handler) as port):
                # 1. 第一个客户端读到首包后主动断开（模拟切页面/切舞台）
                c1 = HTTPConnection("127.0.0.1", port, timeout=5)
                c1.request("GET", "/api/song/stream?song_id=10", headers={"Range": "bytes=0-"})
                r1 = c1.getresponse()
                self.assertEqual(r1.status, 206)
                self.assertEqual(r1.read(len(prefix)), prefix)
                c1.close()

                # 2. 第二个客户端带着 Range + If-Range 加入同一个正在进行的下载，并放行上游
                c2 = HTTPConnection("127.0.0.1", port, timeout=5)
                c2.request("GET", "/api/song/stream?song_id=10",
                           headers={"Range": "bytes=64-127", "If-Range": '"test-etag"'})
                release.set()
                with c2.getresponse() as r2:
                    self.assertEqual(r2.status, 206)
                    self.assertEqual(r2.getheader("Content-Range"), f"bytes 64-127/{len(song)}")
                    self.assertEqual(r2.read(), song[64:128])
                c2.close()

                # 3. 后台下载独立完成并落盘，全程只连过一次上游
                for _ in range(100):
                    if path.exists():
                        break
                    time.sleep(0.02)
                self.assertTrue(path.exists())
                self.assertEqual(path.read_bytes(), song)
                self.assertEqual(upstream_hits, [("/audio", "bytes=0-")])

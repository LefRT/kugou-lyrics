# -*- coding: utf-8 -*-
import gc
import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

import kg_api
import kg_qr
import kg_setup
import kg_store
import kg_web


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class SetupFlowTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp.name, "kugou_lyrics.db")
        self.session_path = os.path.join(self.tmp.name, "session.json")
        self.orig_db = kg_web.DB_PATH
        self.orig_session = kg_api.SESSION_FILE
        self.orig_data_dir = kg_api.DATA_DIR
        kg_web.DB_PATH = self.db_path
        kg_api.DATA_DIR = self.tmp.name
        kg_api.SESSION_FILE = self.session_path
        kg_setup._update_sync(
            running=False, finished=False, phase="idle",
            playlist="", done=0, total=0, krc=0, lrc=0, none=0, skipped=0,
            current="", error=None,
        )
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), kg_web.Handler)
        self.port = self.srv.server_address[1]
        self.thread = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        kg_web.DB_PATH = self.orig_db
        kg_api.SESSION_FILE = self.orig_session
        kg_api.DATA_DIR = self.orig_data_dir
        gc.collect()
        self.tmp.cleanup()

    def _url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.port}{path}"

    def test_fresh_launch_redirects_to_setup_then_enters_after_login_and_sync(self):
        opener = urllib.request.build_opener(_NoRedirect)
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            opener.open(self._url("/"))
        self.assertEqual(ctx.exception.code, 302)
        self.assertEqual(ctx.exception.headers.get("Location"), "/setup")
        ctx.exception.close()

        with urllib.request.urlopen(self._url("/setup")) as resp:
            html = resp.read().decode("utf-8")
            self.assertEqual(resp.status, 200)
            self.assertIn("扫码登录酷狗", html)

        with urllib.request.urlopen(self._url("/api/setup/status")) as resp:
            st = json.loads(resp.read())
            self.assertFalse(st["logged_in"])
            self.assertTrue(st["needs_setup"])
            self.assertEqual(st["song_count"], 0)

        with mock.patch.object(kg_api.KugouClient, "qr_create_key", return_value="mockkey123"):
            req = urllib.request.Request(self._url("/api/setup/qr"), method="POST")
            with urllib.request.urlopen(req) as resp:
                qr = json.loads(resp.read())
                self.assertEqual(qr["key"], "mockkey123")
                self.assertIn("<svg", qr["svg"])

        with mock.patch.object(
            kg_api.KugouClient,
            "qr_status",
            return_value={"status": 4, "token": "tok_abc", "userid": "12345", "nick_name": "tester"},
        ):
            with urllib.request.urlopen(self._url("/api/setup/qr/status?key=mockkey123")) as resp:
                res = json.loads(resp.read())
                self.assertEqual(res["status"], 4)
                self.assertTrue(os.path.isfile(self.session_path))

        fake_playlists = [{"name": "我喜欢", "listid": 2, "gid": "g1", "count": 1}]
        fake_tracks = [{"mixsongid": "s1", "hash": "h1", "title": "晴天", "artist": "周杰伦", "duration_ms": 269000}]
        fake_lyric = {
            "type": "krc",
            "text": "故事的小黄花",
            "timeline": {"type": "krc", "lines": [{"start": 1000, "end": 4000, "text": "故事的小黄花", "words": []}]},
        }
        with mock.patch.object(kg_api.KugouClient, "user_playlists", return_value=fake_playlists), \
             mock.patch.object(kg_api.KugouClient, "playlist_tracks", return_value=fake_tracks), \
             mock.patch.object(kg_api.KugouClient, "fetch_lyrics", return_value=fake_lyric):
            req = urllib.request.Request(
                self._url("/api/setup/sync"),
                data=json.dumps({"scope": "liked"}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req) as resp:
                self.assertEqual(resp.status, 202)
            for _ in range(30):
                with urllib.request.urlopen(self._url("/api/setup/sync/status")) as resp:
                    sync = json.loads(resp.read())
                if sync.get("finished"):
                    break
                time.sleep(0.05)
            self.assertTrue(sync["finished"])
            self.assertEqual(sync["krc"], 1)

        # Now root should serve main app directly (200, not 302)
        with opener.open(self._url("/")) as resp:
            self.assertEqual(resp.status, 200)

    def test_qr_svg_renders_kugou_url(self):
        svg = kg_qr.render_svg("https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=test12345")
        self.assertTrue(svg.startswith("<svg"))
        self.assertTrue(svg.endswith("</svg>"))


if __name__ == "__main__":
    unittest.main()

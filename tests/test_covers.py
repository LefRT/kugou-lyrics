# -*- coding: utf-8 -*-
import json
import os
import sqlite3
import tempfile
import unittest
from unittest import mock

import kg_api
import kg_covers


def _make_db(path, rows):
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE songs (song_id TEXT PRIMARY KEY, title TEXT, artist TEXT, file_hash TEXT)"
    )
    conn.executemany("INSERT INTO songs VALUES (?,?,?,?)", rows)
    conn.commit()
    conn.close()


class CoverFetchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = os.path.join(self.tmp.name, "t.db")
        self.covers_dir = os.path.join(self.tmp.name, "covers")
        orig = (kg_covers.COVERS_DIR, kg_covers.INDEX_FILE)
        kg_covers.COVERS_DIR = self.covers_dir
        kg_covers.INDEX_FILE = os.path.join(self.covers_dir, "_index.json")

        def restore():
            kg_covers.COVERS_DIR, kg_covers.INDEX_FILE = orig
        self.addCleanup(restore)

    def _fake_download(self, url, dest, **kwargs):
        with open(dest, "wb") as f:
            f.write(b"\xff\xd8fakejpeg")

    def test_fetch_writes_index_and_reuses_on_second_run(self):
        _make_db(self.db, [("s1", "晴天", "周杰伦", "hash1"),
                           ("s2", "稻香", "周杰伦", "hash2")])
        with mock.patch.object(kg_api.KugouClient, "song_url_legacy",
                               return_value={"album_img": "https://img/{size}.jpg",
                                             "albumid": "42", "album_name": "叶惠美"}), \
             mock.patch.object(kg_api.KugouClient, "download_file", self._fake_download):
            stats = kg_covers.fetch_library(self.db, sleep=0)
        self.assertEqual(stats["ok"], 2)
        self.assertEqual(stats["files"], 1)  # 同专辑只存一张
        with open(kg_covers.INDEX_FILE, encoding="utf-8") as f:
            index = json.load(f)
        self.assertEqual(index["s1"]["file"], index["s2"]["file"])

        with mock.patch.object(kg_api.KugouClient, "song_url_legacy") as legacy:
            stats = kg_covers.fetch_library(self.db, sleep=0)
        self.assertFalse(legacy.called)  # 已有条目直接跳过
        self.assertEqual(stats["reuse"], 2)

    def test_progress_callback_reports_totals(self):
        _make_db(self.db, [("s1", "晴天", "周杰伦", "hash1")])
        seen = []
        with mock.patch.object(kg_api.KugouClient, "song_url_legacy",
                               return_value={"album_img": "", "status": 0}), \
             mock.patch.object(kg_api.KugouClient, "search_cover", return_value=None):
            kg_covers.fetch_library(self.db, sleep=0, progress=seen.append)
        self.assertTrue(seen)
        self.assertEqual(seen[-1]["total"], 1)

    def test_missing_cover_count_tracks_new_songs(self):
        _make_db(self.db, [("s1", "a", "b", "h1"), ("s2", "c", "d", "h2")])
        self.assertEqual(kg_covers.missing_cover_count(self.db), 2)
        os.makedirs(self.covers_dir, exist_ok=True)
        with open(kg_covers.INDEX_FILE, "w", encoding="utf-8") as f:
            json.dump({"s1": {"file": "x.jpg"}}, f)
        self.assertEqual(kg_covers.missing_cover_count(self.db), 1)


if __name__ == "__main__":
    unittest.main()
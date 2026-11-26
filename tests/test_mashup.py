import json
import sqlite3
import sys
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path
from threading import Event, Timer
from unittest.mock import patch

import kg_mashup
import kg_store
import kg_web


class MashupTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        base = Path(temp.name)
        self.db = base / "songs.sqlite"
        self.output = base / "works"
        self.cache = base / "cache"
        self.cache.mkdir()
        for module, values in (
            (kg_store, {"DEFAULT_DB": str(self.db)}),
            (kg_mashup, {"MASHUPS_DIR": self.output, "CACHE_DIR": self.cache,
                         "FFMPEG": sys.executable, "FFPROBE": sys.executable}),
            (kg_web, {"MASHUPS_DIR": self.output, "TASKS_FILE": str(self.output / "_tasks.json"),
                      "MASHUP_TASKS": {}, "_TASK_CANCEL_EVENTS": {}}),
        ):
            mock = patch.multiple(module, **values)
            mock.start()
            self.addCleanup(mock.stop)
        with closing(sqlite3.connect(self.db)) as conn, conn:
            conn.executescript(kg_store._SCHEMA)
            for song_id, file_hash in (("1", "cached"), ("2", "shared"), ("3", "shared")):
                timeline = {"lines": [{"text": "想见你", "start": 15000, "end": 18500}]}
                conn.execute(
                    "INSERT INTO songs (song_id, title, artist, lyric_type, word_timeline, file_hash) "
                    "VALUES (?, ?, '歌手', 'krc', ?, ?)",
                    (song_id, f"歌{song_id}", json.dumps(timeline), file_hash),
                )

    def test_parallel_jobs_keep_selection_order_and_share_audio_cache(self):
        (self.cache / "cached_320.mp3").touch()
        calls = []
        events = []
        first_finished = Event()

        class Client:
            logged_in = True

            def resolve_play_url(self, file_hash, *_):
                calls.append(file_hash)
                return "https://example.invalid", "test"

            def download_file(self, _url, path, **_):
                Path(path).touch()

        def cut(src, dst, *_, **__):
            if "cached" in Path(src).name:
                self.assertTrue(first_finished.wait(5))
            Path(dst).touch()

        def progress(event):
            events.append(event)
            if event.get("status") == "ok" and event["index"] != 1:
                first_finished.set()

        with patch.object(kg_mashup.kg_api, "KugouClient", return_value=Client()), \
             patch.object(kg_mashup, "probe_duration_ms", return_value=30000), \
             patch.object(kg_mashup, "cut_clip", side_effect=cut):
            meta = kg_mashup.build_mashup("见", song_ids=["1", "3", "2"],
                                          workers=3, join=False, progress=progress)
        self.assertEqual(calls, ["shared"])
        self.assertNotEqual(next(e["index"] for e in events if e.get("status") == "ok"), 1)
        self.assertEqual([s["song_id"] for s in meta["segments"]], ["1", "3", "2"])

    def test_cancel_during_join_prevents_publication_and_releases_task(self):
        (self.cache / "cached_320.mp3").touch()
        (self.cache / "shared_320.mp3").touch()
        joining = Event()
        cleanup_allowed = Event()

        def join(_files, output, cancel_event):
            Path(output).touch()
            joining.set()
            self.assertTrue(cancel_event.wait(5))
            self.assertTrue(cleanup_allowed.wait(5))
            raise kg_mashup.MashupCancelled()

        with patch.object(kg_mashup.kg_api, "KugouClient") as client, \
             patch.object(kg_mashup, "probe_duration_ms", return_value=30000), \
             patch.object(kg_mashup, "cut_clip", side_effect=lambda _src, dst, *_, **__: Path(dst).touch()), \
             patch.object(kg_mashup, "concat_clips", side_effect=join):
            client.return_value.logged_in = True
            task, error = kg_web.create_mashup_task("见", ["1", "2"])
            self.assertIsNone(error)
            try:
                self.assertTrue(joining.wait(5))
                self.assertEqual(task["phase"], "joining")
                self.assertFalse(any(self.output.glob("*/meta.json")))
                self.assertEqual(kg_web.cancel_mashup_task(task["id"])[1], 202)
                self.assertEqual(kg_web.cancel_mashup_task(task["id"])[1], 200)
                self.assertIsNone(kg_web.create_mashup_task("见")[0])
            finally:
                cleanup_allowed.set()
            deadline = time.monotonic() + 5
            while kg_web._TASK_CANCEL_EVENTS and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertEqual(task["status"], "cancelled")
            self.assertFalse((self.output / "见").exists())
            saved = json.loads((self.output / "_tasks.json").read_text(encoding="utf-8"))
            self.assertEqual(saved[0]["status"], "cancelled")

            next_task, error = kg_web.create_mashup_task("见", ["1"])
            self.assertIsNone(error)
            deadline = time.monotonic() + 5
            while kg_web._TASK_CANCEL_EVENTS and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertEqual(next_task["status"], "done")
            self.assertEqual(kg_web.cancel_mashup_task(next_task["id"])[1], 409)
            self.assertTrue((self.output / "见" / "meta.json").is_file())
            client.return_value.resolve_play_url.assert_not_called()

    def test_media_child_is_terminated_on_cancel(self):
        cancelled = Event()
        timer = Timer(.5, cancelled.set)
        timer.start()
        started = time.monotonic()
        try:
            with self.assertRaises(kg_mashup.MashupCancelled):
                kg_mashup._run_media([sys.executable, "-c", "import time; time.sleep(10)"],
                                     timeout=12, cancel_event=cancelled)
            self.assertLess(time.monotonic() - started, 5)
        finally:
            timer.cancel()

    def test_phrase_window_stops_at_interlude_and_ranks_chorus(self):
        tl = {
            "lines": [
                {"text": "作词：某人", "start": 1000, "end": 2000, "credit": True},
                {"text": "开头想见你", "start": 5000, "end": 9000},
                # 5000ms gap (> CONTEXT_GAP_MS=1800) before next verse
                {"text": "微风吹过", "start": 14000, "end": 16500},
                {"text": "想见你在这里", "start": 17000, "end": 20500},
                {"text": "一直到天明", "start": 21000, "end": 24000},
                # 4000ms gap (> CONTEXT_GAP_MS) before chorus repeat
                {"text": "想见你在这里", "start": 28000, "end": 32000},
            ]
        }
        occ = kg_store.find_occurrences(json.dumps(tl), "见")
        cands = kg_mashup._rank_candidates(tl, occ, 10000, 10000)
        self.assertEqual(len(cands), 3)
        # Top candidate should be the repeated chorus line (with 3-line context), not the <15s intro
        best_score, best_occ, best_w = cands[0]
        self.assertEqual(best_occ["text"], "想见你在这里")
        self.assertEqual(best_w["vocal_start"], 14000)
        self.assertEqual(best_w["vocal_end"], 24000)
        # Padding stays within HEAD_PAD_MS=400, TAIL_PAD_MS=800 and doesn't cross gap midpoints
        self.assertEqual(best_w["start"], 13600)
        self.assertEqual(best_w["end"], 24800)

        with closing(sqlite3.connect(self.db)) as conn, conn:
            conn.execute(
                "INSERT INTO songs (song_id, title, artist, lyric_type, word_timeline, file_hash) "
                "VALUES ('chorus', '副歌', '歌手', 'krc', ?, 'chorus_hash')",
                (json.dumps(tl),),
            )
        self.assertEqual(
            kg_mashup.song_clip_window("chorus", "见"),
            {"start_ms": best_w["start"], "end_ms": best_w["end"]},
        )

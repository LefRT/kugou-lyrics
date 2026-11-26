import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import kg_web
from kg_lyric_index import compact, digest, open_db
from kg_lyric_models import ModelError, Usage
from kg_lyric_rank import Direction, Hit, make_intent, shortlist
from kg_lyric_search import LyricSearch


class LocalModel:
    def __init__(self):
        self.batches = 0
        self.fail_batch = None
        self.offline = False

    def fingerprint(self):
        if self.offline:
            raise ModelError("Ollama fixture offline")
        return "fixture@1"

    def encode(self, texts, *, query=False):
        self.batches += 1
        if self.batches == self.fail_batch:
            raise ModelError("interrupted batch")
        return [[1, int("释怀" in text), int("舍不得" in text)] for text in texts]


class Judge:
    def __init__(self, verdict, constraints=()):
        self.verdict = verdict
        self.constraints = constraints
        self.payloads = []
        self.usage = Usage()

    def complete(self, prompt, payload, *, max_tokens):
        self.usage.calls += 1
        self.payloads.append((payload, max_tokens))
        if "works" not in payload:
            return {"directions": [{
                "label": "舍不得", "situation": "离开后仍舍不得", "goal": "陪伴",
                "purpose": "companionship", "topic": "separation",
            }], "constraints": list(self.constraints)}
        if isinstance(self.verdict, Exception):
            raise self.verdict
        return {"results": [self.verdict(work, work["options"][0]) for work in payload["works"]]}


class LyricSearchTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base / "kugou.sqlite"
        self.archive = self.base / "archive.jsonl"
        self.model = LocalModel()
        self.backend = LyricSearch(self.base / "index", self.source, embedder=self.model)
        self.records = []
        with open_db(self.source) as db:
            db.execute("""CREATE TABLE songs (song_id TEXT PRIMARY KEY, lyric_type TEXT,
                word_timeline TEXT, lyrics_text TEXT, title TEXT, artist TEXT)""")

    def add_song(self, song_id, *, title=None, scope="passage", timeline=True, note=None, lines=None):
        title = title or f"虚构歌曲 {song_id}"
        note = note or f"舍不得一个旧朋友，地点 {song_id}"
        lines = lines or [f"站在站台等你 {song_id}", "我舍不得熄掉这盏灯", "我把信折好收了起来"]
        artist = f"歌手 {song_id}"
        source_type = "krc" if timeline else "none"
        word_timeline = compact({"lines": [
            {"text": text, "start": i * 1000, "end": i * 1000 + 800}
            for i, text in enumerate(lines)
        ]}) if timeline else None
        body = "\n".join(lines)
        ids = ["L0001", "L0002", "L0003"]
        record = {
            "schema_version": 1, "source_kind": "timeline" if timeline else "text",
            "source_sha256": digest(compact([source_type, word_timeline, body])),
            "lyrics_sha256": digest(compact(lines)), "song_id": song_id, "title": title, "artist": artist,
            "lines": [{"id": lid, "text": text, "start_ms": i * 1000 if timeline else None,
                       "end_ms": i * 1000 + 800 if timeline else None}
                      for i, (lid, text) in enumerate(zip(ids, lines, strict=True))],
            "analysis": {
                "song": {"scene": None, "tension": None, "speaker_and_addressee": None, "arc": [],
                         "ending": {"text": "收好旧信准备往前走", "evidence_line_ids": [ids[2]]}},
                "sections": [
                    {"id": "S1", "role": "verse", "line_ids": ids[:2], "paraphrase": note},
                    {"id": "S2", "role": "outro", "line_ids": ids[2:], "paraphrase": "释怀告别"},
                ],
                "readings": [{
                    "id": "R1", "scope": scope, "primary_section_id": "S1", "scene": note,
                    "core_meaning": note, "tension": "还想保留联系", "stance": "舍不得",
                    "evidence_level": "explicit", "evidence_line_ids": ids[:2], "limiting_line_ids": ids[2:],
                    "near_misses": [{"query": "帮我放下", "reason": "这里还在等",
                                     "evidence_line_ids": ids[:1]}],
                    "imagery": [{"image": "站台", "meaning": "等待", "evidence_line_ids": ids[:1]}],
                    "uses": [{"purpose": "companionship", "reason": note, "example_queries": ["陪我舍不得"]}],
                }],
                "appreciation": "APPRECIATION_SENTINEL",
            },
        }
        with open_db(self.source) as db:
            db.execute("INSERT INTO songs VALUES (?, ?, ?, ?, ?, ?)",
                       (song_id, source_type, word_timeline, body, title, artist))
        self.records.append(record)
        return record

    def build(self, **kwargs):
        self.archive.write_text("".join(compact(record) + "\n" for record in self.records), encoding="utf-8")
        return self.backend.index(self.archive, **kwargs)

    def test_exact_chinese_and_verified_time(self):
        self.add_song("1")
        self.add_song("2", timeline=False)
        stats = self.build()
        self.assertEqual(stats["songs"], 2)
        self.assertEqual(self.build()["new_vectors"], 0)
        literal = self.backend.search("「站台」", limit=2)
        self.assertEqual(literal["diagnostics"]["recall"], {"lyrics": 2, "situation": 0, "purpose": 0})
        matches = {match["song_id"]: match for match in literal["results"]}
        self.assertEqual(matches["1"]["clip"], {"start_ms": 0, "end_ms": 1800, "line_ids": ["L0001", "L0002"]})
        self.assertIsNone(matches["2"]["clip"])
        self.assertTrue(all("站台" in match["evidence"][0]["text"] for match in matches.values()))

    def test_scope_and_invalid_evidence(self):
        self.add_song("1")
        self.build()
        quote = "别劝我放下"
        judge = Judge(lambda work, option: [
            option["id"], "close", "song", "ok", [option["positive"][0]], "主歌在等"
        ], (quote,))
        out = self.backend.search(f"陪我舍不得，{quote}", judge=judge)
        self.assertEqual(out["results"][0]["scope"], "passage")
        self.assertEqual(out["diagnostics"]["constraints"], [quote])
        payload, cap = judge.payloads[-1]
        self.assertEqual(cap, 840)
        self.assertLessEqual(len(payload["works"][0]["lines"]), 6)
        self.assertIn("L0003", payload["works"][0]["ending_ids"])
        self.assertNotIn("APPRECIATION_SENTINEL", compact(payload))
        full = self.backend.search(f"我想找整首都贴合的歌，{quote}", judge=judge)
        self.assertEqual(full["results"], [])
        self.assertEqual(full["diagnostics"]["reviewed"], 1)
        bad = self.backend.search("陪我舍不得", judge=Judge(lambda work, option: [
            option["id"], "close", "passage", "ok", ["L0099"], "凭空捏造"
        ]))
        self.assertEqual(bad["results"], [])

    def test_web_search_status_and_evidence_without_real_models(self):
        with patch.object(kg_web.kg_lyric_search, "LyricSearch", return_value=self.backend):
            self.assertEqual(kg_web.api_semantic_lyric_search({"q": " "})[1], 400)
            self.assertEqual(kg_web.api_semantic_lyric_search({"q": "站台"})[1], 503)
            self.assertFalse(self.backend.history_path.exists())

            self.add_song("1")
            self.build()
            data, status = kg_web.api_semantic_lyric_search({"q": " 陪我舍不得，别劝我放下 "})
            self.assertEqual(status, 200)
            self.assertEqual(data["mode"], "local")
            self.assertTrue(data["constraints_pending"])
            self.assertEqual(data["warnings"], [])
            match, = data["results"]
            self.assertEqual(match["song_id"], "1")
            self.assertIn("站台", match["evidence"][0]["text"])
            self.assertEqual(match["clip"]["start_ms"], 0)

            self.model.offline = True
            data, status = kg_web.api_semantic_lyric_search({"q": "站台"})
            self.assertEqual(status, 200)
            self.assertTrue(data["results"])
            self.assertTrue(data["warnings"])

    def test_rejected_constraints_and_unavailable_models(self):
        self.add_song("1")
        self.build()
        query = "陪我舍不得，别劝我放下"
        reject = self.backend.search(query, judge=Judge(lambda work, option: [
            option["id"], "reject", "passage", "conflict", [], ""
        ]))
        self.assertEqual(reject["results"], [])
        judge = Judge(ModelError("timeout"))
        local = self.backend.search(query, judge=judge)
        self.assertEqual(judge.usage.calls, 2)
        self.assertEqual(local["results"][0]["review_status"], "local")
        scene = self.backend.search(query, judge=judge, scene_id="放学路上", session_id="one")
        self.assertEqual(scene["results"], [])
        self.assertEqual(scene["withheld_works"], 1)
        self.model.offline = True
        source = self.backend.search("站台")
        self.assertEqual(source["diagnostics"]["recall"]["situation"], 0)
        self.assertTrue(source["diagnostics"]["warnings"])
        self.assertTrue(source["results"])

    def test_source_changes_remove_unserved_match(self):
        bad = self.add_song("bad")
        bad["lines"][0]["start_ms"] = 1
        for index in range(3):
            self.add_song(str(index))
        stats = self.build()
        self.assertEqual(stats["skipped"], {"invalid_archive": 1})
        first = self.backend.search("站台", literal=True, limit=1)
        stale = next(record["song_id"] for record in self.records
                     if record["song_id"] not in ("bad", first["results"][0]["song_id"]))
        with open_db(self.source) as db:
            db.execute("UPDATE songs SET lyrics_text=? WHERE song_id=?", ("新版本", stale))
        following = self.backend.next(first["search_id"], limit=2)
        self.assertEqual(following["stale_works"], 1)
        self.assertEqual(len(following["results"]), 1)
        self.assertNotEqual(following["results"][0]["song_id"], stale)
        self.assertEqual(self.backend.search("站台", literal=True)["diagnostics"]["stale_source_hits"], 1)
        self.assertEqual(self.build()["skipped"]["stale_or_missing_source"], 1)

    def test_atomic_index_and_recoverable_vector_batches(self):
        self.add_song("one")
        original = self.build()
        for index in range(14):
            self.add_song(str(index))
        self.model.fail_batch = self.model.batches + 2
        with self.assertRaisesRegex(ModelError, "interrupted"):
            self.build()
        self.assertEqual(self.backend.search("站台", literal=True)["index_revision"], original["revision"])
        recovered = self.build()
        self.assertEqual(recovered["songs"], 15)
        self.assertEqual(recovered["reused_vectors"], 26)
        self.assertEqual(recovered["new_vectors"], 4)
        self.assertNotEqual(original["revision"], recovered["revision"])
        with self.assertRaisesRegex(ValueError, "不同目录"):
            self.build(full=True)

    def test_scene_cooldown_play_sessions_and_aliases(self):
        one = self.add_song("one", title="相同作品")
        self.add_song("live", title="相同作品", lines=[line["text"] for line in one["lines"]])
        for index in range(5):
            self.add_song(str(index))
        self.assertEqual(self.build()["works"], 6)
        scene = "放学路上"
        self.backend.event("preview", "0", scene_id=scene, session_id="audition", played_ms=1000)
        self.backend.event("failed", "1", scene_id=scene, session_id="failed", detail="network")
        works = []
        for index in range(6):
            session = f"after-school-{index}"
            # Change the request within the same scene.
            query = "站台" if index % 2 else "舍不得"
            page = self.backend.search(query, literal=True, limit=1, scene_id=scene, session_id=session)
            match = page["results"][0]
            self.assertEqual(page["cooldown_works"], index)
            self.assertNotIn(match["work_id"], works)
            works.append(match["work_id"])
            self.backend.event("play", match["song_id"], search_id=page["search_id"], played_ms=100)
            continuation = self.backend.next(page["search_id"], limit=7)
            self.assertTrue({item["work_id"] for item in continuation["results"]}.isdisjoint(works))
        self.assertEqual(continuation["shortage"], 7)
        after = self.backend.search("站台", literal=True, limit=1, scene_id=scene, session_id="seventh")
        self.assertEqual(after["results"][0]["work_id"], works[0])
        different = self.backend.search("站台", literal=True, limit=6, scene_id="雨天", session_id="other")
        self.assertEqual(len(different["results"]), 6)
        self.assertEqual(different["cooldown_works"], 0)

    def test_explicit_work_overrides(self):
        self.add_song("source")
        self.add_song("cover")
        overrides = self.base / "works.json"
        overrides.write_text(compact({"source": "song-a", "cover": "song-a"}), encoding="utf-8")
        self.assertEqual(self.build(overrides=overrides)["works"], 1)
        self.backend.event("play", "cover", scene_id="归途", session_id="a", played_ms=100)
        later = self.backend.search("站台", literal=True, scene_id="归途", session_id="b")
        self.assertEqual(later["cooldown_works"], 1)
        self.assertEqual(later["results"], [])

    def test_actual_exposure_and_concurrent_next(self):
        for index in range(4):
            self.add_song(str(index))
        self.build()
        page = self.backend.search("站台", literal=True, limit=1)
        search_id, song_id = page["search_id"], page["results"][0]["song_id"]
        with open_db(self.backend.history_path, readonly=True) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM event").fetchone()[0], 0)
        for expected in (True, False):
            event = self.backend.event("impression", song_id, search_id=search_id, event_id="shown")
            self.assertEqual(event["recorded"], expected)
        duplicate = self.backend.event("impression", song_id, search_id=search_id, event_id="repeat")
        self.assertEqual(duplicate, {"event_id": "shown", "recorded": False, "kind": "impression"})
        with ThreadPoolExecutor(max_workers=2) as pool:
            batches = list(pool.map(lambda _: self.backend.next(search_id, limit=1), range(2)))
        self.assertEqual({batch["results"][0]["rank"] for batch in batches}, {2, 3})
        self.assertEqual(len({batch["results"][0]["song_id"] for batch in batches}), 2)

    def test_shortlist_checks_new_works_and_intent_separates_negation(self):
        direction = Direction("陪伴", "舍不得", "陪我", "companionship", "separation")
        hits = [Hit(str(i), str(i), "r:R1", 0, ranks={"situation": i + 1}, score=1 / (61 + i))
                for i in range(8)]
        first = shortlist(hits, 4, (direction,), {})
        again = shortlist(hits, 4, (direction,), {(work, direction.key): 1 for work in first})
        self.assertEqual(set(first) & set(again), {"0", "1"})
        intent, _ = make_intent("我希望别人理解我告别时舍不得的感觉，别劝我放下")
        self.assertEqual(intent.constraints, ("别劝我放下",))
        self.assertNotIn("放下", intent.directions[0].situation)
        sad, _ = make_intent("伤心")
        self.assertEqual({d.purpose for d in sad.directions}, {"companionship", "expression", "shift"})


if __name__ == "__main__":
    unittest.main()

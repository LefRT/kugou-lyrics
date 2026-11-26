"""Backend entry point for evidence-based lyric search and scene rotation."""

import argparse
import json
import os
import sqlite3
import sys
import time
import uuid
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from kg_lyric_index import (
    DEFAULT_ARCHIVE, DEFAULT_DIRECTORY, INDEX_VERSION, SAMPLE_LIMIT, build_index, compact,
    get_setting, normalize, open_db, source_hash, source_record, word_tokens,
)
from kg_lyric_models import DeepSeek, ModelError, OllamaEmbeddings, Usage
from kg_lyric_rank import (
    FIT_ORDER, LANES, MAX_REVIEW, local_matches, make_intent, options_for, recall,
    review_matches, shortlist,
)
from kg_store import DEFAULT_DB


SCENE_COOLDOWN = 5
WEEK_MS = 7 * 86_400_000
MAX_QUERY_LENGTH = 400
MAX_RESULTS = 25
EVENTS = ("impression", "preview", "play", "failed", "feedback")
FEEDBACK = ("fits", "wrong_reading", "not_today")

_HISTORY_SCHEMA = """
CREATE TABLE IF NOT EXISTS scene_session (
    session_id TEXT PRIMARY KEY, scene_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS search_run (
    search_id TEXT PRIMARY KEY, created_ms INTEGER NOT NULL,
    query TEXT NOT NULL, scene_id TEXT, session_id TEXT REFERENCES scene_session(session_id),
    revision TEXT NOT NULL, diagnostics TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS search_hit (
    search_id TEXT NOT NULL REFERENCES search_run(search_id), work_id TEXT NOT NULL,
    song_id TEXT NOT NULL, item_key TEXT NOT NULL, direction INTEGER NOT NULL, demand_key TEXT NOT NULL,
    lanes TEXT NOT NULL, state TEXT NOT NULL, detail TEXT NOT NULL,
    PRIMARY KEY (search_id, song_id, item_key, direction)
);
CREATE INDEX IF NOT EXISTS search_hit_by_demand ON search_hit(demand_key, state, work_id);
CREATE TABLE IF NOT EXISTS search_match (
    id INTEGER PRIMARY KEY, search_id TEXT NOT NULL REFERENCES search_run(search_id),
    work_id TEXT NOT NULL, song_id TEXT NOT NULL, demand_key TEXT NOT NULL,
    eligible INTEGER NOT NULL, payload TEXT NOT NULL, rank INTEGER
);
CREATE INDEX IF NOT EXISTS search_match_by_search ON search_match(search_id, rank);
CREATE INDEX IF NOT EXISTS search_match_by_demand ON search_match(demand_key, eligible, work_id);
CREATE UNIQUE INDEX IF NOT EXISTS one_result_per_work ON search_match(search_id, work_id)
    WHERE rank IS NOT NULL;
CREATE TABLE IF NOT EXISTS event (
    seq INTEGER PRIMARY KEY, event_id TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, when_ms INTEGER NOT NULL,
    scene_id TEXT, session_id TEXT REFERENCES scene_session(session_id),
    search_id TEXT REFERENCES search_run(search_id), song_id TEXT NOT NULL, work_id TEXT NOT NULL,
    reading_id TEXT, demand_key TEXT, rank INTEGER, played_ms INTEGER, detail TEXT
);
CREATE INDEX IF NOT EXISTS event_played ON event(scene_id, session_id, seq) WHERE kind='play';
CREATE INDEX IF NOT EXISTS event_impressions ON event(demand_key, work_id, when_ms) WHERE kind='impression';
CREATE UNIQUE INDEX IF NOT EXISTS one_impression_per_work ON event(search_id, work_id)
    WHERE kind='impression';
"""


def _now_ms():
    return time.time_ns() // 1_000_000


def _identifier(value, name):
    if value is not None and (not isinstance(value, str) or not value.strip() or len(value) > 160):
        raise ValueError(f"{name} 须为非空字符串，长度最多 160")


def _session(db, scene, session):
    _identifier(scene, "scene_id")
    _identifier(session, "session_id")
    if (scene is None) != (session is None):
        raise ValueError("scene_id 和 session_id 须同时提供")
    if session is None:
        return
    db.execute("INSERT OR IGNORE INTO scene_session VALUES (?, ?)", (session, scene))
    saved = db.execute("SELECT scene_id FROM scene_session WHERE session_id=?", (session,)).fetchone()[0]
    if saved != scene:
        raise ValueError("此 session_id 已属于另一个场景")


def _blocked_works(db, scene, session, work_map):
    if scene is None:
        return set()
    recent = [row[0] for row in db.execute(
        """SELECT session_id FROM event
           WHERE kind='play' AND scene_id=? AND session_id<>?
           GROUP BY session_id ORDER BY MIN(seq) DESC LIMIT ?""",
        (scene, session, SCENE_COOLDOWN),
    )]
    sessions = [session, *recent]
    rows = db.execute(
        f"SELECT DISTINCT song_id, work_id FROM event WHERE kind='play' "
        f"AND scene_id=? AND session_id IN ({','.join('?' for _ in sessions)})",
        (scene, *sessions),
    )
    return {identity for song, work in rows for identity in (work, work_map.get(song, work))}


def _other_recent_works(db, scene, work_map):
    rows = db.execute(
        "SELECT DISTINCT song_id, work_id FROM event "
        "WHERE kind='play' AND when_ms>=? AND (? IS NULL OR scene_id IS NOT ?)",
        (_now_ms() - WEEK_MS, scene, scene),
    )
    return {identity for song, work in rows for identity in (work, work_map.get(song, work))}


def _prior_checks(db, directions):
    keys = sorted({direction.key for direction in directions})
    counts = db.execute(
        f"""SELECT work_id, demand_key, count(DISTINCT search_id) FROM search_hit
            WHERE demand_key IN ({','.join('?' for _ in keys)})
              AND state NOT IN ('recalled', 'awaiting_review')
            GROUP BY work_id, demand_key""",
        keys,
    )
    return {(work, key): count for work, key, count in counts}


def _opportunity_history(db, search_id, keys):
    if not keys:
        return {}, {}
    slots = ",".join("?" for _ in keys)
    impressions = {(work, demand): when for work, demand, when in db.execute(
        f"""SELECT work_id, demand_key, max(when_ms) FROM event
            WHERE kind='impression' AND demand_key IN ({slots}) GROUP BY work_id, demand_key""",
        keys,
    )}
    eligible = db.execute(
        f"""SELECT DISTINCT m.work_id, m.demand_key, m.search_id, s.created_ms
            FROM search_match AS m JOIN search_run AS s USING(search_id)
            WHERE m.eligible=1 AND m.search_id<>? AND m.demand_key IN ({slots})""",
        (search_id, *keys),
    )
    misses = Counter((work, key) for work, key, _, when in eligible
                     if when > impressions.get((work, key), -1))
    return impressions, misses


def _image_tokens(item):
    return set(word_tokens(" ".join(item["imagery"])))


def _take_matches(candidates, previous, limit, seen_times, misses, recent):
    selected = []
    directions = Counter(item["direction"] for item in previous)
    last = previous[-1] if previous else None
    while candidates and len(selected) < limit:
        last_images = _image_tokens(last) if last else set()
        last_artist = normalize(last["artist"]) if last else ""

        def key(item):
            identity = (item["work_id"], item["demand_key"])
            images = _image_tokens(item)
            similarity = (len(last_images & images) / len(last_images | images)
                          if last_images and images else 0)
            return (-FIT_ORDER[item["fit"]], directions[item["direction"]],
                    bool(last_artist and normalize(item["artist"]) == last_artist), similarity,
                    item["work_id"] in recent, -misses.get(identity, 0),
                    seen_times.get(identity, -1), -item["score"], item["song_id"], item["section_id"])

        last = min(candidates, key=key)
        selected.append(last)
        directions[last["direction"]] += 1
        candidates = [item for item in candidates if item["_current_work"] != last["_current_work"]]
    return selected


class LyricIndexUnavailable(ValueError):
    """The semantic index has not been published or must be rebuilt."""


class LyricSearch:
    def __init__(self, directory=DEFAULT_DIRECTORY, source_db=DEFAULT_DB, *, embedder=None):
        self.directory = Path(directory)
        self.index_path = self.directory / "index.sqlite"
        self.history_path = self.directory / "history.sqlite"
        self.source_db = Path(source_db)
        self.embedder = embedder if embedder is not None else OllamaEmbeddings()

    def index(self, archive=DEFAULT_ARCHIVE, *, full=False, limit=SAMPLE_LIMIT, overrides=None):
        default_overrides = self.directory / "work-overrides.json"
        if overrides is None and default_overrides.is_file():
            overrides = default_overrides
        return build_index(self.index_path, archive, self.source_db, self.embedder,
                           limit=None if full else limit, overrides_path=overrides)

    def _prepare_history(self):
        with open_db(self.history_path) as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(_HISTORY_SCHEMA)

    def _index_metadata(self, db):
        revision = get_setting(db, "revision")
        if not revision or get_setting(db, "version") != str(INDEX_VERSION):
            raise LyricIndexUnavailable("歌词索引尚未构建或版本过期，请运行 index")
        return revision, dict(db.execute("SELECT song_id, work_id FROM song"))

    def _ensure_index(self):
        if not self.index_path.is_file():
            raise LyricIndexUnavailable("歌词索引尚未构建，请运行 index")

    def search(self, query, *, limit=5, literal=False, scene_id=None, session_id=None, judge=None,
               review_limit=MAX_REVIEW):
        if not isinstance(query, str) or len(query) > MAX_QUERY_LENGTH or not query.strip() and scene_id is None:
            raise ValueError(f"请输入 1 至 {MAX_QUERY_LENGTH} 字的查询。场景搜索允许空查询")
        if not 1 <= limit <= MAX_RESULTS or not 1 <= review_limit <= MAX_REVIEW:
            raise ValueError(f"结果数须在 1 至 {MAX_RESULTS} 之间，复核名额须在 1 至 {MAX_REVIEW} 之间")
        self._ensure_index()
        self._prepare_history()
        with open_db(self.history_path) as history:
            _session(history, scene_id, session_id)
        usage_before = asdict(getattr(judge, "usage", Usage()))
        warnings = []
        search_id = uuid.uuid4().hex
        with open_db(self.index_path, readonly=True) as index, open_db(self.source_db, readonly=True) as source:
            index.execute("BEGIN")
            source.execute("BEGIN")
            revision, works = self._index_metadata(index)
            intent, warning = make_intent(query, literal=literal, context=scene_id, judge=judge)
            if warning:
                warnings.append(warning)
            with open_db(self.history_path, readonly=True) as history:
                excluded = _blocked_works(history, scene_id, session_id, works)
                checked = _prior_checks(history, intent.directions)

            sources, archives, stale_hits = {}, {}, set()

            def current(song_id, version):
                if song_id not in sources:
                    sources[song_id] = source_hash(source_record(source, song_id))
                if sources[song_id] != version:
                    stale_hits.add(song_id)
                    return False
                return True

            def archive(song_id):
                if song_id not in archives:
                    archives[song_id] = json.loads(index.execute(
                        "SELECT archive FROM song WHERE song_id=?", (song_id,)).fetchone()[0])
                return archives[song_id]

            hits, warning = recall(index, intent, self.embedder, excluded=excluded,
                                   current=current, archive=archive)
            if warning:
                warnings.append(warning)
            review_max = MAX_RESULTS if intent.literal else review_limit
            selected = shortlist(hits, review_max, intent.directions, checked)
            options = options_for(selected, intent, archive)
        reviewed = 0
        mode = "literal" if intent.literal else "local"
        matches = None
        if judge is not None and not intent.literal and options:
            for group in options.values():
                for option in group:
                    option.hit.status = "awaiting_review"
            try:
                matches, reviewed = review_matches(options, intent, judge)
                mode = "deepseek" if reviewed == len(options) else "partial"
                if mode == "partial":
                    warnings.append("部分候选缺少有效复核判定")
            except ModelError as error:
                warnings.append(str(error))
        if matches is None:
            matches = local_matches(options, intent)
        usage = {key: value - usage_before[key] for key, value in
                 asdict(getattr(judge, "usage", Usage())).items()}
        diagnostics = {
            "mode": mode, "intent_origin": intent.origin, "constraints": intent.constraints,
            "whole_song": intent.whole_song, "directions": [asdict(direction) for direction in intent.directions],
            "recall": {lane: len({hit.work_id for hit in hits if lane in hit.ranks}) for lane in LANES},
            "recalled_works": len({hit.work_id for hit in hits}), "shortlisted": len(options),
            "reviewed": reviewed, "eligible": len({m["work_id"] for m in matches if m["auto_eligible"]}),
            "stale_source_hits": len(stale_hits),
            "usage": usage, "warnings": warnings,
        }
        with open_db(self.history_path) as history:
            history.execute("BEGIN IMMEDIATE")
            history.execute("INSERT INTO search_run VALUES (?, ?, ?, ?, ?, ?, ?)", (
                search_id, _now_ms(), intent.query, scene_id, session_id, revision, compact(diagnostics)))
            history.executemany("INSERT INTO search_hit VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (
                (search_id, hit.work_id, hit.song_id, hit.key, hit.direction, intent.directions[hit.direction].key,
                 compact(hit.ranks), hit.status, hit.detail) for hit in hits
            ))
            history.executemany("""INSERT INTO search_match
                (search_id, work_id, song_id, demand_key, eligible, payload) VALUES (?, ?, ?, ?, ?, ?)""", (
                (search_id, m["work_id"], m["song_id"], m["demand_key"], m["auto_eligible"], compact(m))
                for m in matches
            ))
            return self._page(history, search_id, limit)

    def _page(self, history, search_id, limit):
        run = history.execute("SELECT * FROM search_run WHERE search_id=?", (search_id,)).fetchone()
        if run is None:
            raise ValueError("找不到 search_id")
        scene, session = run["scene_id"], run["session_id"]
        with open_db(self.index_path, readonly=True) as index, open_db(self.source_db, readonly=True) as source:
            index.execute("BEGIN")
            source.execute("BEGIN")
            _, works = self._index_metadata(index)
            blocked = _blocked_works(history, scene, session, works)
            recent = _other_recent_works(history, scene, works)
            previous_rows = history.execute(
                "SELECT payload, rank FROM search_match WHERE search_id=? AND rank IS NOT NULL ORDER BY rank",
                (search_id,),
            ).fetchall()
            previous = [json.loads(row["payload"]) for row in previous_rows]
            exhausted_works = {identity for item in previous for identity in
                               (item["work_id"], works.get(item["song_id"], item["work_id"]))}
            candidates, stale, withheld = [], set(), set()
            sources = {}
            for row in history.execute(
                    "SELECT id, payload FROM search_match WHERE search_id=? AND rank IS NULL", (search_id,)):
                match = json.loads(row["payload"])
                work = works.get(match["song_id"], match["work_id"])
                if (match["work_id"] in blocked or work in blocked
                        or match["work_id"] in exhausted_works or work in exhausted_works):
                    continue
                if scene is not None and not match["auto_eligible"]:
                    withheld.add(work)
                    continue
                song = match["song_id"]
                if song not in sources:
                    sources[song] = source_hash(source_record(source, song))
                if sources[song] != match["source_sha256"]:
                    stale.add(song)
                    continue
                match.update(_row_id=row["id"], _current_work=work)
                candidates.append(match)
        seen_times, misses = _opportunity_history(
            history, search_id, sorted({match["demand_key"] for match in candidates}))
        unique_works = {item["_current_work"] for item in candidates}
        matches = _take_matches(candidates, previous, limit, seen_times, misses, recent)
        rank = previous_rows[-1]["rank"] if previous_rows else 0
        for offset, match in enumerate(matches, 1):
            history.execute("UPDATE search_match SET rank=? WHERE id=?", (rank + offset, match.pop("_row_id")))
            match.pop("_current_work")
            match["rank"] = rank + offset
            match["search_id"] = search_id
        return {
            "search_id": search_id, "index_revision": run["revision"],
            "scene_id": scene, "session_id": session, "results": matches,
            "has_more": len(unique_works) > len(matches), "shortage": max(0, limit - len(matches)),
            "cooldown_works": len(blocked), "withheld_works": len(withheld), "stale_works": len(stale),
            "diagnostics": json.loads(run["diagnostics"]),
        }

    def next(self, search_id, *, limit=5):
        if not 1 <= limit <= MAX_RESULTS:
            raise ValueError(f"结果数须在 1 至 {MAX_RESULTS} 之间")
        self._ensure_index()
        self._prepare_history()
        with open_db(self.history_path) as history:
            history.execute("BEGIN IMMEDIATE")
            return self._page(history, search_id, limit)

    def event(self, kind, song_id, *, event_id=None, search_id=None, scene_id=None, session_id=None,
              played_ms=None, detail=None):
        _identifier(song_id, "song_id")
        _identifier(event_id, "event_id")
        if not song_id or kind not in EVENTS:
            raise ValueError("事件类型或歌曲 ID 无效")
        if played_ms is not None and (type(played_ms) is not int or played_ms < 0 or played_ms >= 2**63):
            raise ValueError("played_ms 须为非负毫秒数")
        if kind == "play" and not played_ms:
            raise ValueError("正式播放需要正的 played_ms")
        if kind in ("impression", "feedback") and search_id is None:
            raise ValueError("展示和反馈需要 search_id")
        if kind == "feedback" and detail not in FEEDBACK:
            raise ValueError("反馈取 fits、wrong_reading 或 not_today")
        event_id = event_id or uuid.uuid4().hex
        detail = detail[:300] if detail else None
        self._prepare_history()
        with open_db(self.history_path) as db:
            db.execute("BEGIN IMMEDIATE")
            match = None
            rank = None
            if search_id is not None:
                row = db.execute(
                    """SELECT m.payload, m.rank, r.scene_id, r.session_id
                       FROM search_match AS m JOIN search_run AS r USING(search_id)
                       WHERE m.search_id=? AND m.song_id=? AND m.rank IS NOT NULL""",
                    (search_id, song_id),
                ).fetchone()
                if row is None:
                    raise ValueError("该歌曲尚未在此搜索中返回")
                match, rank = json.loads(row["payload"]), row["rank"]
                if row["scene_id"] is not None:
                    if scene_id is not None and scene_id != row["scene_id"]:
                        raise ValueError("事件场景与搜索场景不符")
                    if session_id is not None and session_id != row["session_id"]:
                        raise ValueError("事件会话与搜索会话不符")
                    scene_id, session_id = row["scene_id"], row["session_id"]
            _session(db, scene_id, session_id)
            existing = db.execute("SELECT * FROM event WHERE event_id=?", (event_id,)).fetchone()
            if existing:
                fields = ("kind", "song_id", "search_id", "scene_id", "session_id", "played_ms", "detail")
                if tuple(existing[key] for key in fields) != (
                        kind, song_id, search_id, scene_id, session_id, played_ms, detail):
                    raise ValueError("同一个 event_id 已用于另一条事件")
                return {"event_id": event_id, "recorded": False, "kind": kind}
            if match is None:
                with open_db(self.source_db, readonly=True) as source:
                    if source_record(source, song_id) is None:
                        raise ValueError("曲库中没有此歌曲")
                work = "recording:" + song_id
                if self.index_path.is_file():
                    with open_db(self.index_path, readonly=True) as index:
                        row = index.execute("SELECT work_id FROM song WHERE song_id=?", (song_id,)).fetchone()
                        if row:
                            work = row[0]
                match = {"work_id": work, "reading_id": None, "demand_key": None}
            if kind == "impression":
                prior = db.execute("SELECT event_id FROM event WHERE kind='impression' AND search_id=? AND work_id=?",
                                   (search_id, match["work_id"])).fetchone()
                if prior:
                    return {"event_id": prior[0], "recorded": False, "kind": kind}
            db.execute("""INSERT INTO event
                (event_id, kind, when_ms, scene_id, session_id, search_id, song_id, work_id,
                 reading_id, demand_key, rank, played_ms, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                       (event_id, kind, _now_ms(), scene_id, session_id, search_id, song_id, match["work_id"],
                        match["reading_id"], match["demand_key"], rank, played_ms, detail))
        return {"event_id": event_id, "recorded": True, "kind": kind}


def main(argv=None):
    parser = argparse.ArgumentParser(description="歌词语义搜索后端")
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY)
    parser.add_argument("--source-db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--sample", action="store_true", help="使用同目录下独立的 sample 索引和历史")
    parser.add_argument("--ollama-url", default="http://127.0.0.1:11434")
    parser.add_argument("--embedding-model", default="qwen3-embedding:0.6b")
    commands = parser.add_subparsers(dest="command", required=True)
    index = commands.add_parser("index", help="导入只读档案并在本机建索引")
    index.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    index.add_argument("--full", action="store_true")
    index.add_argument("--limit", type=int, default=SAMPLE_LIMIT)
    index.add_argument("--overrides", type=Path)
    search = commands.add_parser("search", help="搜索歌词或生成场景歌单")
    search.add_argument("query", nargs="?", default="")
    search.add_argument("--literal", action="store_true")
    search.add_argument("--limit", type=int, default=5)
    search.add_argument("--review-limit", type=int, default=MAX_REVIEW)
    search.add_argument("--deepseek", action="store_true", help="允许本次搜索进行有预算的 API 复核")
    search.add_argument("--scene", dest="scene_id")
    search.add_argument("--session", dest="session_id")
    next_page = commands.add_parser("next", help="从同一次搜索的合格候选中取下一批")
    next_page.add_argument("search_id")
    next_page.add_argument("--limit", type=int, default=5)
    event = commands.add_parser("event", help="记录实际展示、试听、正式播放、失败或反馈")
    event.add_argument("kind", choices=EVENTS)
    event.add_argument("song_id")
    event.add_argument("--event-id")
    event.add_argument("--search-id")
    event.add_argument("--scene", dest="scene_id")
    event.add_argument("--session", dest="session_id")
    event.add_argument("--played-ms", type=int)
    event.add_argument("--detail")
    args = parser.parse_args(argv)
    try:
        backend = LyricSearch(
            args.directory / "sample" if args.sample else args.directory, args.source_db,
            embedder=OllamaEmbeddings(args.embedding_model, args.ollama_url))
        if args.command == "index":
            if args.full == args.sample:
                raise ValueError("请用 --sample index 构建样本索引，或用 index --full 构建正式索引")
            result = backend.index(args.archive, full=args.full, limit=args.limit, overrides=args.overrides)
        elif args.command == "search":
            judge = DeepSeek(os.environ.get("DEEPSEEK_API_KEY")) if args.deepseek else None
            result = backend.search(args.query, limit=args.limit, literal=args.literal, scene_id=args.scene_id,
                                    session_id=args.session_id, judge=judge, review_limit=args.review_limit)
        elif args.command == "next":
            result = backend.next(args.search_id, limit=args.limit)
        else:
            result = backend.event(args.kind, args.song_id, event_id=args.event_id, search_id=args.search_id,
                                   scene_id=args.scene_id, session_id=args.session_id, played_ms=args.played_ms,
                                   detail=args.detail)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ModelError, OSError, ValueError, sqlite3.Error) as error:
        print(compact({"error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

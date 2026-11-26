"""Import the lyric archive and maintain a transactional local search index."""

import hashlib
import json
import math
import re
import sqlite3
import struct
import unicodedata
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass
from itertools import islice
from pathlib import Path

from kg_lyric_models import ModelError
from kg_store import DEFAULT_DB


DATA = Path(DEFAULT_DB).parent
DEFAULT_ARCHIVE = DATA / "lyric_archive" / "archive.jsonl"
DEFAULT_DIRECTORY = DATA / "lyric_search"
INDEX_VERSION = 1
SAMPLE_LIMIT = 15
PURPOSES = frozenset({"recognition", "companionship", "expression", "release",
                      "reflection", "shift", "other"})

_SCHEMA = """
CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vector_cache (
    model TEXT NOT NULL, hash TEXT NOT NULL, embedding BLOB NOT NULL,
    PRIMARY KEY (model, hash)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS song (
    song_id TEXT PRIMARY KEY, work_id TEXT NOT NULL, source_sha256 TEXT NOT NULL,
    archive TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS item (
    id INTEGER PRIMARY KEY, song_id TEXT NOT NULL REFERENCES song(song_id),
    item_key TEXT NOT NULL, situation_hash TEXT, purpose_hash TEXT,
    UNIQUE (song_id, item_key)
);
CREATE VIRTUAL TABLE IF NOT EXISTS lyric_words USING fts5(words, tokenize = 'unicode61 remove_diacritics 0');
"""

_CJK = r"[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\U00020000-\U000323af]"
_WORD = re.compile(rf"{_CJK}+|(?:(?!{_CJK})[^\W_])+", re.UNICODE)
_STOP_WORDS = frozenset(
    "我想 想要 我想要 听一 一首 首歌 找一 想听 能够 可以 什么 这种 一种 那种 一个 "
    "一下 的歌 歌词 听歌 感觉 一下 about with song songs want that the and".split())


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalize(text):
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def word_tokens(text, *, query=False, single=False):
    tokens = []
    for term in _WORD.findall(normalize(text)):
        if re.fullmatch(_CJK + "+", term):
            if single:
                tokens.extend(term)
            tokens.extend(term[i:i + 2] for i in range(len(term) - 1))
        else:
            tokens.append(term)
    return list(dict.fromkeys(token for token in tokens if not query or token not in _STOP_WORDS))


@contextmanager
def open_db(path, *, readonly=False):
    path = Path(path)
    if not readonly:
        path.parent.mkdir(parents=True, exist_ok=True)
    location = path.resolve().as_uri() + "?mode=ro" if readonly else str(path)
    db = sqlite3.connect(location, uri=readonly, timeout=8)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def get_setting(db, key):
    row = db.execute("SELECT value FROM setting WHERE key=?", (key,)).fetchone()
    return row[0] if row else None


def set_setting(db, key, value):
    db.execute("INSERT OR REPLACE INTO setting(key, value) VALUES (?, ?)", (key, value))


def source_record(db, song_id):
    return db.execute(
        "SELECT lyric_type, word_timeline, lyrics_text, title, artist FROM songs WHERE song_id=?",
        (song_id,),
    ).fetchone()


def source_hash(record):
    return digest(compact(list(record)[:3])) if record is not None else None


def _valid_start(value):
    return type(value) is int and value >= 0


def _lyric_text(value):
    return unicodedata.normalize("NFC", value or "").strip()


def _check_lines(record, source):
    timeline = record["source_kind"] == "timeline"
    if timeline:
        original = json.loads(source["word_timeline"])["lines"]
    elif record["source_kind"] == "text":
        original = (source["lyrics_text"] or "").splitlines()
    else:
        raise ValueError("未知歌词来源")
    previous = 0
    for line in record["lines"]:
        number = line["id"]
        if not re.fullmatch(r"L[0-9]{4,}", number):
            raise ValueError("无效歌词行 ID")
        position = int(number[1:])
        if not previous < position <= len(original):
            raise ValueError("歌词行位置不匹配")
        previous = position
        origin = original[position - 1]
        start = end = None
        if timeline:
            text = origin.get("text")
            if text is None:
                text = "".join(word.get("t", "") for word in (origin.get("words") or [])
                               if isinstance(word, dict))
            start = origin.get("start")
            start = start if _valid_start(start) else None
            end = origin.get("end")
            end = end if _valid_start(end) and start is not None and end > start else None
        else:
            text = origin
        if (line["text"] != _lyric_text(text)
                or not line["text"]
                or type(line["start_ms"]) is not type(start) or line["start_ms"] != start
                or type(line["end_ms"]) is not type(end) or line["end_ms"] != end):
            raise ValueError("档案原句或时间与来源不符")
    if not previous or digest(compact([_lyric_text(line["text"]) for line in record["lines"]])) != record["lyrics_sha256"]:
        raise ValueError("正文哈希不匹配")


def _check_analysis(record):
    analysis = record["analysis"]
    known = {line["id"] for line in record["lines"]}
    sections = {part["id"]: set(part["line_ids"]) for part in analysis["sections"]}
    if ([lid for part in analysis["sections"] for lid in part["line_ids"]]
            != [line["id"] for line in record["lines"]]
            or len(sections) != len(analysis["sections"])):
        raise ValueError("段落未按顺序覆盖歌词")
    song = analysis["song"]
    grounded = [song[key] for key in ("scene", "speaker_and_addressee", "tension", "ending")
                if song[key] is not None]
    grounded += song["arc"]
    for arc in song["arc"]:
        if not set(arc["evidence_line_ids"]) <= sections[arc["section_id"]]:
            raise ValueError("推进引用超出本段")
    reading_ids = set()
    for reading in analysis["readings"]:
        if reading["id"] in reading_ids or reading["scope"] not in ("song", "passage"):
            raise ValueError("解读 ID 或范围无效")
        reading_ids.add(reading["id"])
        if not (sections[reading["primary_section_id"]] & set(reading["evidence_line_ids"])):
            raise ValueError("主段缺少正面证据")
        if not set(reading["limiting_line_ids"]) <= known:
            raise ValueError("限制引用不存在的歌词行")
        grounded.extend([reading, *reading["imagery"], *reading["near_misses"]])
        for use in reading["uses"]:
            if use["purpose"] not in PURPOSES:
                raise ValueError("用途标签无效")
    if any(not set(entry["evidence_line_ids"]) <= known for entry in grounded):
        raise ValueError("引用不存在的歌词行")


@dataclass
class Entry:
    key: str
    words: str
    situation: str = ""
    purpose: str = ""


def _entries(record):
    analysis = record["analysis"]
    lines = {line["id"]: line["text"] for line in record["lines"]}
    sections = {part["id"]: part for part in analysis["sections"]}
    for part in sections.values():
        words = word_tokens(" ".join(lines[lid] for lid in part["line_ids"]), single=True)
        yield Entry(f"s:{part['id']}", " ".join(words))
    for reading in analysis["readings"]:
        part = sections[reading["primary_section_id"]]
        imagery = [image["image"] for image in reading["imagery"]]
        words = word_tokens(" ".join(imagery + [lines[lid] for lid in reading["evidence_line_ids"]]),
                            single=True)
        situation = [
            reading["scene"], reading["core_meaning"], reading["tension"], reading["stance"],
            part["paraphrase"], *[f"{image['image']} {image['meaning']}" for image in reading["imagery"]],
        ]
        if reading["scope"] == "song":
            song = analysis["song"]
            situation.extend(song[k]["text"] for k in ("scene", "tension", "ending") if song[k])
        purpose = [text for use in reading["uses"] for text in (use["reason"], *use["example_queries"])]
        yield Entry(f"r:{reading['id']}", " ".join(words),
                    "；".join(text for text in situation if text)[:900],
                    "；".join(text for text in purpose if text)[:700])


def _work_id(record, overrides):
    override = overrides.get(record["song_id"])
    if override:
        return "manual:" + override
    title = normalize(record["title"])
    if title and title not in ("未知歌曲", "unknown"):
        return "work:" + digest(compact([title, record["lyrics_sha256"]]))[:32]
    return "recording:" + record["song_id"]


def normalized_vector(vector):
    try:
        size = len(vector)
        norm = math.sqrt(sum(x * x for x in vector))
        if not 0 < size <= 4096 or not math.isfinite(norm) or norm == 0:
            raise ValueError
        return tuple(x / norm for x in vector)
    except (TypeError, ValueError, OverflowError):
        raise ModelError("模型返回无效向量") from None


def _load_records(archive, source_db, overrides, limit):
    records, seen, skipped = [], set(), Counter()
    examples = []
    with open_db(source_db, readonly=True) as source, archive.open(encoding="utf-8-sig") as file:
        source.execute("BEGIN")
        for number, text in enumerate(islice(file, limit), 1):
            if not text.strip():
                continue
            try:
                record = json.loads(text)
                sid = record["song_id"]
                if not isinstance(sid, str) or not sid or sid in seen:
                    raise ValueError
            except (ValueError, KeyError, TypeError):
                raise ValueError(f"档案第 {number} 行损坏或歌曲 ID 重复") from None
            seen.add(sid)
            original = source_record(source, sid)
            if original is None or record.get("source_sha256") != source_hash(original):
                skipped["stale_or_missing_source"] += 1
                if len(examples) < 5:
                    examples.append(sid)
                continue
            try:
                if record["schema_version"] != 1:
                    raise ValueError("不支持的档案版本")
                _check_lines(record, original)
                _check_analysis(record)
                record["title"], record["artist"] = original["title"], original["artist"]
                entries = list(_entries(record))
                records.append((record, _work_id(record, overrides), entries))
            except (AttributeError, IndexError, KeyError, ValueError, TypeError):
                skipped["invalid_archive"] += 1
                if len(examples) < 5:
                    examples.append(sid)
    return records, dict(skipped), examples


def build_index(index_path, archive_path, source_db, embedder, *, limit=SAMPLE_LIMIT,
                overrides_path=None):
    if limit is not None and not 1 <= limit <= SAMPLE_LIMIT:
        raise ValueError(f"样本范围为 1 至 {SAMPLE_LIMIT} 首")
    overrides = {}
    if overrides_path is not None:
        overrides = json.loads(Path(overrides_path).read_text(encoding="utf-8-sig"))
        if not isinstance(overrides, dict) or any(
                not isinstance(value, str) or not value.strip() for value in overrides.values()):
            raise ValueError("作品映射须为歌曲 ID 到非空作品 ID 的 JSON 对象")

    with open_db(index_path) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(_SCHEMA)
        db.execute("BEGIN IMMEDIATE")
        mode = "full" if limit is None else "sample"
        if get_setting(db, "mode") not in (None, mode):
            raise ValueError("正式索引与样本索引须使用不同目录")
        ticket = str(int(get_setting(db, "build_ticket") or 0) + 1)
        set_setting(db, "build_ticket", ticket)
        set_setting(db, "mode", mode)
        db.commit()

        records, skipped, examples = _load_records(Path(archive_path), source_db, overrides, limit)
        if not records:
            raise ValueError(f"没有可索引的歌词档案。跳过统计 {compact(skipped)}")
        model = embedder.fingerprint()
        model_key = f"{INDEX_VERSION}:{model}"
        texts = {}
        for _, _, entries in records:
            for entry in entries:
                for text in (entry.situation, entry.purpose):
                    if text:
                        texts[digest(text)] = text
        cached = dict(db.execute("SELECT hash, length(embedding) FROM vector_cache WHERE model=?",
                                 (model_key,)))
        pending = [key for key in texts if key not in cached]
        dimensions = {cached[key] // 4 for key in texts.keys() & cached.keys()}
        for start in range(0, len(pending), 24):
            keys = pending[start:start + 24]
            vectors = [normalized_vector(vector) for vector in embedder.encode([texts[k] for k in keys])]
            dimensions.update(map(len, vectors))
            if len(vectors) != len(keys) or len(dimensions) != 1:
                raise ModelError("索引批次的向量数量或维度不一致")
            db.executemany("INSERT OR IGNORE INTO vector_cache VALUES (?, ?, ?)", (
                (model_key, key, struct.pack(f"<{len(vector)}f", *vector))
                for key, vector in zip(keys, vectors, strict=True)
            ))
            db.commit()
        if len(dimensions) > 1 or embedder.fingerprint() != model:
            raise ModelError("建索引期间 Ollama 模型或向量维度发生变化")

        archives = [(r["song_id"], work, r["source_sha256"], compact(r)) for r, work, _ in records]
        revision = digest(compact([mode, model_key, [(sid, work, digest(raw))
                                                     for sid, work, _, raw in archives]]))[:24]
        db.execute("BEGIN IMMEDIATE")
        if get_setting(db, "build_ticket") != ticket:
            raise ValueError("检测到新的索引构建，取消发布此版本")
        changed = get_setting(db, "revision") != revision
        if changed:
            db.execute("DELETE FROM lyric_words")
            db.execute("DELETE FROM item")
            db.execute("DELETE FROM song")
            db.executemany("INSERT INTO song VALUES (?, ?, ?, ?)", archives)
            entries = [(sid, entry) for (sid, _, _, _), (_, _, docs) in zip(archives, records)
                       for entry in docs]
            db.executemany("INSERT INTO item VALUES (?, ?, ?, ?, ?)", (
                (rowid, sid, entry.key, digest(entry.situation) if entry.situation else None,
                 digest(entry.purpose) if entry.purpose else None)
                for rowid, (sid, entry) in enumerate(entries, 1)
            ))
            db.executemany("INSERT INTO lyric_words(rowid, words) VALUES (?, ?)", (
                (rowid, entry.words) for rowid, (_, entry) in enumerate(entries, 1)
            ))
            for key, value in (("revision", revision), ("model", model_key),
                               ("dimensions", str(next(iter(dimensions), 0))),
                               ("version", str(INDEX_VERSION))):
                set_setting(db, key, value)
    return {"revision": revision, "mode": mode, "published": changed,
            "songs": len(records), "works": len({work for _, work, _ in records}),
            "readings": sum(len(record["analysis"]["readings"]) for record, _, _ in records),
            "new_vectors": len(pending), "reused_vectors": len(texts) - len(pending),
            "skipped": skipped, "examples": examples}

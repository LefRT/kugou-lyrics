# -*- coding: utf-8 -*-
"""SQLite 存储与查询。"""
import json
import os
import sqlite3
import time

import kg_krc

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")
DEFAULT_DB = os.path.join(DATA_DIR, "kugou_lyrics.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
    song_id       TEXT PRIMARY KEY,   -- mixsongid（缺失时用文件 hash）
    title         TEXT NOT NULL,
    artist        TEXT NOT NULL,
    lyrics_text   TEXT,               -- 纯文本歌词
    word_timeline TEXT,               -- 逐字/逐行时间轴 JSON
    lyric_type    TEXT,               -- krc / lrc / none
    file_hash     TEXT,
    duration_ms   INTEGER,
    mixsongid     TEXT,
    playlist      TEXT,               -- 来源歌单
    fetched_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_songs_lyrics ON songs(lyric_type);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""


def _connect(db_path=None):
    path = db_path or DEFAULT_DB
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    return conn


def upsert_song(db_path, song: dict):
    """song 需包含 song_id/title/artist，其余字段可选。"""
    with _connect(db_path) as conn:
        conn.execute(
            """INSERT INTO songs (song_id, title, artist, lyrics_text, word_timeline,
                                  lyric_type, file_hash, duration_ms, mixsongid, playlist, fetched_at)
               VALUES (:song_id, :title, :artist, :lyrics_text, :word_timeline,
                       :lyric_type, :file_hash, :duration_ms, :mixsongid, :playlist, :fetched_at)
               ON CONFLICT(song_id) DO UPDATE SET
                   title=excluded.title, artist=excluded.artist,
                   lyrics_text=excluded.lyrics_text, word_timeline=excluded.word_timeline,
                   lyric_type=excluded.lyric_type, file_hash=excluded.file_hash,
                   duration_ms=excluded.duration_ms, mixsongid=excluded.mixsongid,
                   playlist=CASE WHEN excluded.playlist IS NULL OR excluded.playlist = ''
                                 THEN songs.playlist
                                 ELSE CASE WHEN songs.playlist IS NULL OR songs.playlist = ''
                                      THEN excluded.playlist
                                      ELSE songs.playlist || ',' || excluded.playlist END END,
                   fetched_at=excluded.fetched_at""",
            {
                "song_id": song["song_id"],
                "title": song.get("title") or "未知歌曲",
                "artist": song.get("artist") or "未知歌手",
                "lyrics_text": song.get("lyrics_text"),
                "word_timeline": song.get("word_timeline"),
                "lyric_type": song.get("lyric_type") or "none",
                "file_hash": song.get("file_hash"),
                "duration_ms": song.get("duration_ms"),
                "mixsongid": song.get("mixsongid"),
                "playlist": song.get("playlist"),
                "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            },
        )


def _escape_like(kw: str) -> str:
    return kw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search_lyrics(db_path, keyword: str):
    """查询一：歌词中包含关键词的所有歌曲。"""
    with _connect(db_path) as conn:
        return conn.execute(
            r"""SELECT song_id, title, artist, lyric_type, playlist
                FROM songs
                WHERE lyrics_text LIKE ? ESCAPE '\'
                ORDER BY title""",
            (f"%{_escape_like(keyword)}%",),
        ).fetchall()


def find_song(db_path, ref: str):
    """按 song_id 精确匹配，或按歌名/歌手模糊匹配。"""
    with _connect(db_path) as conn:
        rows = conn.execute("SELECT * FROM songs WHERE song_id = ?", (ref,)).fetchall()
        if rows:
            return rows
        pat = f"%{_escape_like(ref)}%"
        return conn.execute(
            r"""SELECT * FROM songs
                WHERE title LIKE ? ESCAPE '\' OR artist LIKE ? ESCAPE '\'
                ORDER BY title""",
            (pat, pat),
        ).fetchall()


def list_songs(db_path):
    with _connect(db_path) as conn:
        return conn.execute(
            "SELECT song_id, title, artist, lyric_type, duration_ms FROM songs ORDER BY title"
        ).fetchall()


def get_stats(db_path):
    with _connect(db_path) as conn:
        total = conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]
        by_type = conn.execute(
            "SELECT lyric_type, COUNT(*) FROM songs GROUP BY lyric_type"
        ).fetchall()
        return total, dict(by_type)


# ---------------- 查询二：关键词出现时间 ----------------

def find_occurrences(word_timeline_json: str, keyword: str):
    """在时间轴中找出关键词的每次出现，返回精确到毫秒的时间。

    - KRC：逐字精确（多字符时间组按字符均分，见 kg_krc._split_words）
    - LRC：只有行级时间，出现时间 = 所在行的起始毫秒（approx=True）
    """
    if not word_timeline_json:
        return []
    try:
        tl = json.loads(word_timeline_json)
    except (TypeError, ValueError):
        return []
    if not isinstance(tl, dict):
        return []
    meta = tl.get("meta")
    if not isinstance(meta, dict):
        meta = {}
    title, artist = meta.get("ti") or "", meta.get("ar") or ""
    fkw = keyword.lower()
    out = []
    lines = tl.get("lines")
    if not isinstance(lines, list):
        return []
    for ln_no, line in enumerate(lines, start=1):
        if not isinstance(line, dict):
            continue
        text = line.get("text") or ""
        # 制作信息行不算歌词匹配；老数据没打标记的读时补判（含歌名行/角色行）
        if line.get("credit") or kg_krc.is_credit_line(text, title, artist,
                                                       first_lines=ln_no <= 4):
            continue
        if keyword not in text and fkw not in text.lower():
            continue
        words = line.get("words")
        if words:
            chars = [(w.get("t", ""), w.get("s"), w.get("e")) for w in words]
            hay = "".join(c[0] for c in chars).lower()
            idx, nth = 0, 0
            while True:
                j = hay.find(fkw, idx)
                if j < 0:
                    break
                seg = chars[j:j + len(keyword)]
                seg = [c for c in seg if c[0] != ""]
                if seg:
                    out.append({
                        "line": ln_no,
                        "start_ms": seg[0][1],
                        "end_ms": seg[-1][2],
                        "text": text,
                        "approx": False,
                    })
                idx = j + max(1, len(keyword))
        else:
            # LRC 行级时间：该行内每次出现都记为行起始时间
            hay = text.lower()
            idx = 0
            while True:
                j = hay.find(fkw, idx)
                if j < 0:
                    break
                out.append({
                    "line": ln_no,
                    "start_ms": line.get("start"),
                    "end_ms": line.get("end"),
                    "text": text,
                    "approx": True,
                })
                idx = j + max(1, len(keyword))
    return out


def ms_to_clock(ms: int) -> str:
    if ms is None:
        return "--:--.---"
    m, rest = divmod(int(ms), 60000)
    s, ms2 = divmod(rest, 1000)
    return f"{m:02d}:{s:02d}.{ms2:03d}"


def migrate_credit_text(db_path=None):
    """一次性修正旧数据：剔掉制作信息行和纯时间标签行，并重算 lyrics_text。

    早期入库的数据没有 credit 标记，lyrics_text 直接由整份时间轴拼成，
    导致「制作人」「录音」等检索会命中非歌词行；还有整行只有 `<0,917,0>`
    这类时间标签的脏行。这里按最新规则重算，credit 标记、去掉的脏行、
    lyrics_text 都会写回，版本号记录在 meta 表里，之后启动不再重复扫描。
    """
    conn = _connect(db_path)
    try:
        done = conn.execute(
            "SELECT value FROM meta WHERE key='credit_text_v2'").fetchone()
        if done:
            return 0
        rows = conn.execute(
            """SELECT song_id, title, artist, lyrics_text, word_timeline
               FROM songs WHERE word_timeline IS NOT NULL""").fetchall()
        changed = 0
        for r in rows:
            try:
                tl = json.loads(r["word_timeline"])
            except (TypeError, ValueError):
                continue
            if not isinstance(tl, dict):
                continue
            snapshot = json.loads(r["word_timeline"])
            kg_krc.mark_credit_lines(tl, r["title"] or "", r["artist"] or "")
            lines = tl.get("lines")
            if isinstance(lines, list):
                kept = [ln for ln in lines if isinstance(ln, dict)
                        and kg_krc.has_word_text(ln.get("text") or "")]
                if len(kept) != len(lines):
                    tl["lines"] = kept
            text = kg_krc.timeline_to_plain_text(tl)
            if tl != snapshot:
                conn.execute("UPDATE songs SET word_timeline=? WHERE song_id=?",
                             (json.dumps(tl, ensure_ascii=False, separators=(",", ":")),
                              r["song_id"]))
            if text != (r["lyrics_text"] or ""):
                conn.execute("UPDATE songs SET lyrics_text=? WHERE song_id=?",
                             (text, r["song_id"]))
            changed += 1
        conn.execute(
            "INSERT OR REPLACE INTO meta(key, value) VALUES('credit_text_v2', ?)",
            (time.strftime("%Y-%m-%d %H:%M:%S"),))
        conn.commit()
        return changed
    finally:
        conn.close()

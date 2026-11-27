# -*- coding: utf-8 -*-
"""
酷狗歌词库 · 本地网页控制台

用法：
  py -3 kg_web.py                 # 启动并自动打开浏览器
  py -3 kg_web.py --port 8765     # 指定端口
  py -3 kg_web.py --no-browser    # 不自动打开浏览器

仅监听 127.0.0.1，只能本机访问。
"""
import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import threading
import time
import webbrowser
from contextlib import closing
from http.client import HTTPException
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote, unquote

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
# 本地小工具：不生成 __pycache__，保持项目根目录干净（启动开销可忽略）
sys.dont_write_bytecode = True

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
import kg_api  # noqa: E402
import kg_covers  # noqa: E402
import kg_krc  # noqa: E402
import kg_lyric_search  # noqa: E402
import kg_playback  # noqa: E402
import kg_setup  # noqa: E402
import kg_share  # noqa: E402
import kg_stream  # noqa: E402
import kg_store  # noqa: E402
import kg_mashup  # noqa: E402
import kg_video  # noqa: E402

WEB_DIR = os.path.join(BASE, "web", "dist")
MASHUPS_DIR = os.path.join(BASE, "data", "mashups")
_video_exports = kg_video.VideoExports()
COVERS_DIR = os.path.join(BASE, "data", "covers")
DB_PATH = kg_store.DEFAULT_DB
PAGE_SIZE = 30

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".json": "application/json",
    ".woff2": "font/woff2",
    ".otf": "font/otf",
    ".ttf": "font/ttf",
    ".mp3": "audio/mpeg",
}


def _dist_path(rel_path: str):
    """Resolve a static file within web/dist."""
    dist_root = os.path.realpath(WEB_DIR)
    full = os.path.realpath(os.path.join(dist_root, rel_path))
    if not full.startswith(dist_root + os.sep) or not os.path.isfile(full):
        return None
    return full


def _read_dist(rel_path: str):
    full = _dist_path(rel_path)
    if full is None:
        return None
    with open(full, "rb") as f:
        return f.read()


def _safe_mashup_id(mid: str):
    """只允许安全目录名，防路径穿越。"""
    return isinstance(mid, str) and bool(mid) and re.fullmatch(r"[\w\-#\u4e00-\u9fff]+", mid) \
        and os.path.isdir(os.path.join(MASHUPS_DIR, mid))


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _int_param(qs, name, default):
    """query 里的整数参数，非法值回退默认（不让 ?page=abc 变成 500）。"""
    try:
        return int(qs.get(name, [str(default)])[0])
    except (TypeError, ValueError):
        return default


def api_stats():
    conn = db()
    try:
        total = conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]
        by_type = dict(conn.execute(
            "SELECT lyric_type, COUNT(*) FROM songs GROUP BY lyric_type").fetchall())
        playlists = {}
        for (pl,) in conn.execute("SELECT playlist FROM songs WHERE playlist IS NOT NULL"):
            for name in (pl or "").split(","):
                name = name.strip()
                if name:
                    playlists[name] = playlists.get(name, 0) + 1
    finally:
        conn.close()
    return {
        "total": total,
        "by_type": by_type,
        "db_mb": round(os.path.getsize(DB_PATH) / 1024 / 1024, 1),
        "playlists": sorted(
            [{"name": k, "count": v} for k, v in playlists.items()],
            key=lambda x: -x["count"])[:8],
    }


def api_lyric_search(kw, page=1):
    page = max(1, int(page or 1))
    conn = db()
    pat = f"%{kg_store._escape_like(kw)}%"
    total = conn.execute(
        r"SELECT COUNT(*) FROM songs WHERE lyrics_text LIKE ? ESCAPE '\'", (pat,)
    ).fetchone()[0]
    pages = max(1, -(-total // PAGE_SIZE))
    page = min(page, pages)
    rows = conn.execute(
        r"""SELECT song_id, title, artist, lyric_type, lyrics_text FROM songs
            WHERE lyrics_text LIKE ? ESCAPE '\'
            ORDER BY (lyric_type = 'krc') DESC, title
            LIMIT ? OFFSET ?""",
        (pat, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    ).fetchall()
    conn.close()
    lkw = kw.lower()
    items = [{
        "song_id": r["song_id"], "title": r["title"], "artist": r["artist"],
        "lyric_type": r["lyric_type"],
        "matches": (r["lyrics_text"] or "").lower().count(lkw),
    } for r in rows]
    return {"kw": kw, "total": total, "page": page, "pages": pages, "items": items}


def api_semantic_lyric_search(payload):
    query = payload.get("q") if isinstance(payload, dict) else None
    query = query.strip() if isinstance(query, str) else ""
    max_length = kg_lyric_search.MAX_QUERY_LENGTH
    # JSON permits escaped lone surrogates, which SQLite cannot store as UTF-8.
    if not 1 <= len(query) <= max_length or re.search(r"[\ud800-\udfff]", query):
        return {"error": f"请输入 1 至 {max_length} 字的有效查询。"}, 400

    backend = kg_lyric_search.LyricSearch(source_db=DB_PATH)
    try:
        result = backend.search(query, limit=kg_lyric_search.MAX_RESULTS)
    except kg_lyric_search.LyricIndexUnavailable:
        return {"error": "语义搜索索引尚未建立或需要重建，可以先使用关键词检索。"}, 503
    except ValueError as error:
        return {"error": str(error)}, 400
    except (OSError, sqlite3.Error) as error:
        print(f"语义搜索数据读取失败：{type(error).__name__}: {error}")
        return {"error": "暂时无法读取语义搜索数据，请稍后重试。"}, 503

    diagnostics = result["diagnostics"]
    constraints_pending = diagnostics["mode"] == "local" and bool(
        diagnostics["constraints"] or diagnostics["whole_song"]
    )
    return {
        "results": result["results"],
        "mode": diagnostics["mode"],
        "warnings": diagnostics["warnings"],
        "constraints_pending": constraints_pending,
    }, 200


def api_songs(q="", page=1):
    page = max(1, int(page or 1))
    conn = db()
    where, args = [], []
    if q:
        where.append(r"(title LIKE ? ESCAPE '\' OR artist LIKE ? ESCAPE '\')")
        pat = f"%{kg_store._escape_like(q)}%"
        args += [pat, pat]
    w = ("WHERE " + " AND ".join(where)) if where else ""
    total = conn.execute(f"SELECT COUNT(*) FROM songs {w}", args).fetchone()[0]
    pages = max(1, -(-total // PAGE_SIZE))
    page = min(page, pages)
    rows = conn.execute(
        f"""SELECT song_id, title, artist, lyric_type, duration_ms, word_timeline FROM songs {w}
            ORDER BY title LIMIT ? OFFSET ?""",
        args + [PAGE_SIZE, (page - 1) * PAGE_SIZE],
    ).fetchall()
    conn.close()
    items = []
    for r in rows:
        d = dict(r)
        wt = d.pop("word_timeline", None)
        if not d.get("duration_ms") and wt:
            try:
                tl = json.loads(wt)
                if isinstance(tl, dict):
                    ends = [ln.get("end") for ln in (tl.get("lines") or []) if ln.get("end")]
                    d["duration_ms"] = max(ends) if ends else None
            except (TypeError, ValueError):
                pass
        items.append(d)
    return {"total": total, "page": page, "pages": pages,
            "items": items}


def api_song(song_id):
    conn = db()
    try:
        r = conn.execute("SELECT * FROM songs WHERE song_id = ?", (song_id,)).fetchone()
    finally:
        conn.close()
    if not r:
        return None
    d = dict(r)
    d["timeline"] = None
    if d.get("word_timeline"):
        try:
            d["timeline"] = json.loads(d["word_timeline"])
        except (TypeError, ValueError):
            d["timeline"] = None
    d.pop("word_timeline", None)
    if d["timeline"] is not None and not isinstance(d["timeline"], dict):
        d["timeline"] = None
    if d["timeline"]:
        # 老数据入库时可能没打 credit 标记：读时按最新规则补判，staff/角色/歌名行不当歌词；
        # 歌名行优先用时间轴 meta 里的歌名/歌手（和歌词文本的写法更一致）
        meta = d["timeline"].get("meta")
        if not isinstance(meta, dict):
            meta = {}
        title = meta.get("ti") or d.get("title") or ""
        artist = meta.get("ar") or d.get("artist") or ""
        for i, ln in enumerate(d["timeline"].get("lines") or []):
            if not isinstance(ln, dict):
                continue
            ln["credit"] = bool(ln.get("credit")) or kg_krc.is_credit_line(
                ln.get("text") or "", title, artist, first_lines=i < 4)
    if not d.get("duration_ms") and d["timeline"]:
        lines = d["timeline"].get("lines")
        if not isinstance(lines, list):
            lines = []
        ends = [ln.get("end") for ln in lines if isinstance(ln, dict) and ln.get("end")]
        d["duration_ms"] = max(ends) if ends else None
    return d


def api_song_climax(song_id):
    conn = db()
    try:
        row = conn.execute("SELECT file_hash FROM songs WHERE song_id = ?", (song_id,)).fetchone()
    finally:
        conn.close()
    if row is None:
        return {"error": "not found"}, 404
    file_hash = (row["file_hash"] or "").strip().lower()
    try:
        climax = kg_api.song_climax(file_hash) if re.fullmatch(r"[a-f0-9]{32}", file_hash) else None
    except (kg_api.KgApiError, OSError, ValueError):
        return {"error": "暂时无法读取酷狗高潮标记"}, 502
    return {"climax": climax}, 200


def api_occurrences(song_id, kw):
    conn = db()
    r = conn.execute("SELECT word_timeline FROM songs WHERE song_id = ?",
                     (song_id,)).fetchone()
    conn.close()
    if not r or not r[0]:
        return {"occurrences": [], "count": 0}
    occ = kg_store.find_occurrences(r[0], kw)
    return {"occurrences": occ, "count": len(occ)}


def api_mashups():
    out = []
    if os.path.isdir(MASHUPS_DIR):
        for name in os.listdir(MASHUPS_DIR):
            mp = os.path.join(MASHUPS_DIR, name, "meta.json")
            if not os.path.isfile(mp):
                continue
            try:
                with open(mp, encoding="utf-8") as f:
                    m = json.load(f)
                if not isinstance(m, dict):
                    continue
                out.append({"id": name, "word": m.get("word", name),
                            "count": len(m.get("segments") or []),
                            "total_ms": m.get("total_ms") or 0,
                            "created": m.get("created_at") or "",
                            "skipped": len(m.get("skipped") or [])})
            except (OSError, ValueError, TypeError):
                continue
    out.sort(key=lambda m: (m.get("created", ""), m["id"]), reverse=True)
    return out


def api_mashup(mid):
    if not _safe_mashup_id(mid):
        return None
    try:
        with open(os.path.join(MASHUPS_DIR, mid, "meta.json"), encoding="utf-8") as f:
            meta = json.load(f)
        return meta if isinstance(meta, dict) else None
    except (OSError, ValueError):
        return None


def _delete_tasks_for_meta_locked(mid):
    """（调用方须持有 _TASKS_LOCK）删掉 meta_id 指向该作品的任务记录，返回被删 id。"""
    removed = [tid for tid, t in MASHUP_TASKS.items() if t.get("meta_id") == mid]
    for tid in removed:
        MASHUP_TASKS.pop(tid, None)
    return removed


def delete_mashup(mid):
    """删除觅字：整个 mashups/<mid>/ 目录（meta、分段音频、拼接版）一起移除。

    缀字里指向这个作品的制作记录同步删除——觅字/缀字两边的删除保持一致。
    """
    with _video_exports.lock:
        if not _safe_mashup_id(mid):
            return False
        if _video_exports.active(mid):
            raise kg_video.ExportError("作品正在导出视频，请先取消导出。")
        shutil.rmtree(os.path.join(MASHUPS_DIR, mid))
        _video_exports.forget(mid)
    with _TASKS_LOCK:
        removed = _delete_tasks_for_meta_locked(mid)
    if removed:
        _save_tasks()
        print(f"已删除觅字：{mid}（连同 {len(removed)} 条缀字记录）")
    else:
        print(f"已删除觅字：{mid}")
    return True


# ---------------- 专辑封面（kg_covers.py 拉取，covers/_index.json 为索引） ----------------

_cover_cache = {"mtime": None, "groups": []}


def api_covers():
    """按封面文件分组返回 [{file, items: [{song_id, title}]}]，多首歌共用一张图时同组。"""
    idx = os.path.join(COVERS_DIR, "_index.json")
    if not os.path.isfile(idx):
        return []
    try:
        mt = os.path.getmtime(idx)
        if _cover_cache["mtime"] != mt:
            with open(idx, encoding="utf-8") as f:
                raw = json.load(f)
            groups = {}
            if not isinstance(raw, dict):
                raw = {}
            for sid, info in raw.items():
                if not isinstance(info, dict):
                    continue
                fname = info.get("file")
                if not fname:
                    continue
                g = groups.setdefault(fname, {"file": fname, "items": []})
                g["items"].append({"song_id": sid, "title": info.get("title") or ""})
            _cover_cache["mtime"] = mt
            _cover_cache["groups"] = list(groups.values())
        return _cover_cache["groups"]
    except (OSError, ValueError):
        return []


# ---------------- 单曲播放：解析酷狗直链并同源代理（WebAudio 不吃跨域） ----------------

_playback_links = kg_playback.PlaybackLinks()
_playback_audio = kg_playback.AudioCache(os.path.join(BASE, "data", "playback-cache"))
_AUDIO_USER_AGENT = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36"
_STREAM_ERRORS = {}
_STREAM_ERRORS_LOCK = threading.Lock()
_STREAM_ERROR_TTL = 30


def _note_stream_error(song_id, message, status):
    if not song_id:
        return
    with _STREAM_ERRORS_LOCK:
        _STREAM_ERRORS[song_id] = (time.monotonic() + _STREAM_ERROR_TTL, message, status)
        if len(_STREAM_ERRORS) > 128:
            now = time.monotonic()
            for key in [k for k, v in _STREAM_ERRORS.items() if v[0] <= now]:
                _STREAM_ERRORS.pop(key, None)


def _clear_stream_error(song_id):
    if not song_id:
        return
    with _STREAM_ERRORS_LOCK:
        _STREAM_ERRORS.pop(song_id, None)


def _recent_stream_error(song_id):
    if not song_id:
        return None
    with _STREAM_ERRORS_LOCK:
        entry = _STREAM_ERRORS.get(song_id)
        if not entry:
            return None
        if time.monotonic() >= entry[0]:
            _STREAM_ERRORS.pop(song_id, None)
            return None
        return entry[1], entry[2]


def _song_source(song_id):
    with closing(db()) as conn:
        return conn.execute("SELECT file_hash, mixsongid FROM songs WHERE song_id = ? AND file_hash <> ''",
                            (song_id,)).fetchone()


def _load_share_audio(source):
    """为导出单文件歌词分享页读取音频字节，优先使用本地缓存，尽量取体积适中的 MP3。"""
    file_hash = (source["file_hash"] or "").strip().upper()
    mixsongid = source["mixsongid"]
    cache_dir = os.path.join(BASE, "data", "cache")
    for suffix in ("_128.mp3", "_320.mp3"):
        p = os.path.join(cache_dir, f"{file_hash}{suffix}")
        if os.path.isfile(p) and 0 < os.path.getsize(p) <= kg_playback.MAX_AUDIO_SIZE:
            with open(p, "rb") as f:
                data = f.read()
            kind = kg_playback.audio_type(data[:12]) or "audio/mpeg"
            return data, kind

    client = kg_api.KugouClient()
    cache_path = _playback_audio.path(client.userid if client.logged_in else "", file_hash, mixsongid)
    cached = _playback_audio.open(cache_path)
    if cached:
        handle, kind = cached
        with handle:
            handle.seek(0)
            return handle.read(), kind

    urls, _, _ = client.play_candidates(file_hash, mixsongid, qualities=("128", "320", "flac"))
    if not urls:
        return b"", "audio/mpeg"
    headers = {"User-Agent": _AUDIO_USER_AGENT, "Accept-Encoding": "identity"}
    try:
        response, _ = kg_stream._race(urls, headers)
    except kg_stream.StreamUnavailable:
        return b"", "audio/mpeg"
    chunks = []
    size = 0
    with response:
        content_type = response.headers.get("Content-Type", "audio/mpeg")
        while True:
            chunk = response.read(kg_playback.CHUNK_SIZE)
            if not chunk:
                break
            size += len(chunk)
            if size > kg_playback.MAX_AUDIO_SIZE:
                return b"", "audio/mpeg"
            chunks.append(chunk)
    data = b"".join(chunks)
    kind = kg_playback.audio_type(data[:12]) or content_type
    return data, kind


def resolve_song_play_url(song_id):
    source = _song_source(song_id)
    if not source:
        return None
    client = kg_api.KugouClient()
    key = (source["file_hash"], source["mixsongid"], client.userid, client.token)
    urls = _playback_links.get(
        key, lambda: client.play_candidates(source["file_hash"], source["mixsongid"])[0])
    return urls[0] if urls else None


# ---------------- 觅字一键制作：后台任务 ----------------

MASHUP_TASKS: dict = {}
_TASK_CANCEL_EVENTS = {}
_ACTIVE_TASK_STATES = {"running", "cancelling"}
_TASKS_LOCK = threading.Lock()
_SAVE_LOCK = threading.Lock()
_TASK_SEQ = [0]
TASKS_FILE = os.path.join(MASHUPS_DIR, "_tasks.json")


def _load_tasks():
    """启动时恢复任务历史，保留已完成及已取消的记录。"""
    defaults = {
        "word": "", "status": "error", "created": "", "total_songs": 0,
        "processed": 0, "segments": 0, "total_ms": 0, "meta_id": None,
        "error": None, "phase": None, "log": [], "skipped": [],
    }
    try:
        with open(TASKS_FILE, encoding="utf-8") as f:
            saved = json.load(f)
        if not isinstance(saved, list):
            return
        for t in saved:
            if not isinstance(t, dict) or not t.get("id"):
                continue
            for key, value in defaults.items():
                if key in t:
                    continue
                # 列表字段必须每个任务独立，不能共用 defaults 里的同一个 list
                t[key] = value.copy() if isinstance(value, list) else value
            if not isinstance(t.get("log"), list):
                t["log"] = []
            if not isinstance(t.get("skipped"), list):
                t["skipped"] = []
            if t.get("status") not in (*_ACTIVE_TASK_STATES, "done", "error", "cancelled"):
                t["status"] = "error"
            if t["status"] == "running":
                t["status"] = "error"
                t["error"] = "服务器重启，任务中断"
            elif t["status"] == "cancelling":
                t["status"] = "cancelled"
            t["phase"] = None
            t.pop("current", None)
            MASHUP_TASKS[t["id"]] = t
    except (OSError, ValueError, TypeError):
        pass


def _save_tasks():
    """终态变化后落盘，重启不丢制作记录。

    快照和写文件都在这把锁里串行化：否则旧快照可能在新快照之后落盘，
    把刚完成的任务状态覆盖回 running。写临时文件再 replace，避免半截 JSON。
    """
    try:
        with _SAVE_LOCK:
            with _TASKS_LOCK:
                tasks = sorted(MASHUP_TASKS.values(),
                               key=lambda t: t["created"], reverse=True)[:30]
                data = json.dumps(tasks, ensure_ascii=False, indent=1)
            os.makedirs(MASHUPS_DIR, exist_ok=True)
            tmp = TASKS_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, TASKS_FILE)
    except (OSError, TypeError, ValueError):
        pass


def _mashup_task_cb(task):
    """把 build_mashup 的进度事件写进任务状态（线程安全）。"""
    def cb(evt):
        stage = evt.get("stage")
        with _TASKS_LOCK:
            if task["status"] != "running":
                return
            if stage == "selected":
                task["total_songs"] = evt.get("songs", 0)
                task["phase"] = "processing"
                task["log"].append(
                    f"选中 {evt.get('songs', 0)} 首歌 / {evt.get('occurrences', 0)} 处出现，开始逐首处理")
            elif stage == "song":
                label = f"{evt.get('artist')} - {evt.get('title')}"
                status = evt.get("status")
                index, total = evt.get("index", 0), evt.get("total", 0)
                if status == "working":
                    task["log"].append(f"[{index}/{total}] 正在处理 {label}")
                elif status == "skip":
                    task["processed"] += 1
                    task["skipped"].append({"title": evt.get("title", ""),
                                            "artist": evt.get("artist", ""),
                                            "reason": evt.get("reason", "")})
                    task["log"].append(f"[{index}/{total}] 跳过 {label} —— {evt.get('reason')}")
                elif status == "ok":
                    task["processed"] += 1
                    task["segments"] += evt.get("made", 0)
                    task["log"].append(f"[{index}/{total}] {label} → {evt.get('made')} 段")
            elif stage == "joining":
                task["phase"] = "joining"
                task["log"].append("拼接完整音频中…")
            del task["log"][:-200]
    return cb


def _run_mashup_task(task, song_ids, cancel_event):
    def publish(meta, tmp_path, meta_path):
        with _TASKS_LOCK:
            if cancel_event.is_set():
                raise kg_mashup.MashupCancelled()
            os.replace(tmp_path, meta_path)
            task["status"] = "done"
            task["phase"] = None
            task["meta_id"] = meta["id"]
            task["segments"] = len(meta["segments"])
            task["total_ms"] = meta["total_ms"]
            task["skipped"] = meta.get("skipped", [])
            task["log"].append(
                f"完成：{len(meta['segments'])} 段 / 总长 {meta['total_ms'] // 1000}s"
                f" / 跳过 {len(meta.get('skipped', []))} 首")
    try:
        kg_mashup.build_mashup(task["word"], per_song=1, sleep_s=0, workers=3,
                              progress=_mashup_task_cb(task), song_ids=song_ids,
                              cancel_event=cancel_event, publish=publish)
    except Exception as e:  # noqa: BLE001
        with _TASKS_LOCK:
            if cancel_event.is_set():
                task["status"] = "cancelled"
                task["log"].append("已取消制作")
            elif task["status"] != "done":
                task["status"] = "error"
                task["error"] = str(e) if isinstance(e, kg_mashup.MashupError) else f"{type(e).__name__}: {e}"
                task["log"].append(f"失败：{task['error']}")
            task["phase"] = None
    finally:
        _save_tasks()
        with _TASKS_LOCK:
            _TASK_CANCEL_EVENTS.pop(task["id"], None)


def create_mashup_task(word, song_ids=None):
    """同一时间只允许一个制作任务；返回 (task, None) 或 (None, 错误信息)。"""
    with _TASKS_LOCK:
        running = [t for t in MASHUP_TASKS.values() if t["status"] in _ACTIVE_TASK_STATES]
        if running:
            if running[0]["status"] == "cancelling":
                return None, "上一个任务正在取消，请稍候"
            return None, f"已有制作任务在进行中（『{running[0]['word']}』），请等它完成"
        _TASK_SEQ[0] += 1
        task_id = f"t{int(time.time() * 1000)}_{_TASK_SEQ[0]}"
        task = {
            "id": task_id, "word": word, "status": "running",
            "created": time.strftime("%Y-%m-%d %H:%M:%S"),
            "total_songs": 0, "processed": 0, "segments": 0,
            "total_ms": 0, "meta_id": None, "error": None,
            "phase": "selecting", "log": [], "skipped": [],
        }
        cancel_event = _TASK_CANCEL_EVENTS[task_id] = threading.Event()
        MASHUP_TASKS[task_id] = task
        # 只保留最近 30 条历史任务（按创建时间，而不是 dict 插入顺序：
        # 从磁盘恢复时是最新在前，按插入顺序裁会把最新的先删掉）
        done = sorted((t for t in MASHUP_TASKS.values() if t["status"] not in _ACTIVE_TASK_STATES),
                      key=lambda t: t["created"])
        for old in done[:-30]:
            MASHUP_TASKS.pop(old["id"], None)
    threading.Thread(target=_run_mashup_task, args=(task, song_ids, cancel_event), daemon=True).start()
    _save_tasks()
    return task, None


def _task_summary(task):
    return {k: task[k] for k in
            ("id", "word", "status", "created", "total_songs", "processed",
             "segments", "total_ms", "meta_id", "error", "phase")}


def cancel_mashup_task(task_id):
    with _TASKS_LOCK:
        task = MASHUP_TASKS.get(task_id)
        if task is None:
            return {"error": "制作记录已不存在"}, 404
        if task["status"] in ("cancelling", "cancelled"):
            return {"status": task["status"]}, 200
        if task["status"] != "running":
            return {"error": "制作已结束"}, 409
        task["status"] = "cancelling"
        _TASK_CANCEL_EVENTS[task_id].set()
    _save_tasks()
    return {"status": "cancelling"}, 202


def _handle_mashup_create(handler, body):
    # 请求体大小已由 do_POST 按头校验（超限时根本不读体并断开），这里直接解析
    try:
        data = json.loads(body.decode("utf-8"))
    except ValueError:
        handler._json({"error": "请求体不是 JSON"}, 400)
        return
    if not isinstance(data, dict):
        handler._json({"error": "请求体需要是 JSON 对象"}, 400)
        return
    word = str(data.get("word", "")).strip()
    if not word or len(word) > 20:
        handler._json({"error": "请输入 1~20 个字的关键词"}, 400)
        return
    song_ids = None
    raw_ids = data.get("song_ids")
    if raw_ids is not None:
        if (not isinstance(raw_ids, list) or not raw_ids or len(raw_ids) > 1000
                or not all(isinstance(s, str) and 0 < len(s.strip()) <= 64 for s in raw_ids)):
            handler._json({"error": "song_ids 需要是 1~1000 个歌曲 id"}, 400)
            return
        song_ids = list(dict.fromkeys(s.strip() for s in raw_ids))
    task, err = create_mashup_task(word, song_ids)
    if err:
        handler._json({"error": err}, 409)
        return
    handler._json({"task_id": task["id"], "songs": len(song_ids) if song_ids else None})


class Handler(BaseHTTPRequestHandler):
    server_version = "KgLyricVault/1.0"
    _headers_sent = False

    def log_message(self, *a):
        pass

    def send_response(self, code, message=None):
        # 记下"响应头已发"：后续再出错只能断连接，不能再补一个 JSON 头
        self._headers_sent = True
        super().send_response(code, message)

    def _json(self, obj, code=200):
        if self._headers_sent:
            self.close_connection = True
            return
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if code >= 400:
            self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_audio(self, mid, rest):
        """serve mashups/<mid>/<rest>，支持 Range 以便拖动进度。"""
        if not _safe_mashup_id(mid):
            self._json({"error": "bad id"}, 403)
            return
        base = os.path.realpath(os.path.join(MASHUPS_DIR, mid))
        path = os.path.realpath(os.path.join(base, *rest.split("/")))
        if not path.startswith(base + os.sep) or not os.path.isfile(path) \
                or not path.lower().endswith((".mp3", ".mp4")):
            self._json({"error": "forbidden"}, 403)
            return
        try:
            handle = open(path, "rb")
        except OSError as e:
            self._json({"error": str(e)}, 500)
            return
        with handle:
            content_type = "video/mp4" if path.lower().endswith(".mp4") else "audio/mpeg"
            self._serve_media_file(handle, content_type)

    def _serve_media_file(self, handle, content_type, *, download_name=None):
        size = os.fstat(handle.fileno()).st_size
        start, end = 0, size - 1
        requested = (self.headers.get("Range") or "").strip()
        # There is no local validator for If-Range, so send the full representation in that case.
        match = None if self.headers.get("If-Range") else re.fullmatch(r"bytes=([0-9]{0,20})-([0-9]{0,20})", requested)
        partial = bool(match and any(match.groups()))
        if partial:
            if match[1]:
                start = int(match[1])
                if match[2]:
                    end = min(end, int(match[2]))
            else:
                start = max(0, size - int(match[2]))
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        length = end - start + 1
        self.send_response(206 if partial else 200)
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Type", content_type)
        if download_name:
            self.send_header("Content-Disposition",
                             f"attachment; filename=video.mp4; filename*=UTF-8''{quote(download_name, safe='')}")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "private, no-store")
        self.end_headers()
        try:
            handle.seek(start)
            remaining = length
            while remaining:
                chunk = handle.read(min(kg_playback.CHUNK_SIZE, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)
        except OSError:
            # 播放器 seek 会主动掐断连接。
            self.close_connection = True

    def _serve_video_export(self, mid):
        meta = api_mashup(mid)
        if meta:
            try:
                handle = open(os.path.join(MASHUPS_DIR, mid, kg_video.OUTPUT_NAME), "rb")
            except FileNotFoundError:
                pass
            else:
                with handle:
                    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(meta.get("word") or mid)).strip(" .")
                    self._serve_media_file(handle, "video/mp4", download_name=(name or "video") + ".mp4")
                return
        self._json({"error": "视频还未导出。"}, 404)

    def _handle_video_export(self, qs, cancel):
        self.close_connection = True
        port = self.server.server_address[1]
        host = self.headers.get("Host", "").lower()
        hosts = (f"127.0.0.1:{port}", f"localhost:{port}")
        if port == 80:
            hosts += ("127.0.0.1", "localhost")
        origin = self.headers.get("Origin")
        if host not in hosts or (origin and origin != f"http://{host}"):
            self._json({"error": "请从本机网页导出视频。"}, 403)
            return
        mid = qs.get("id", [""])[0]
        if cancel:
            ok = _video_exports.cancel(mid, qs.get("job", [""])[0])
            self._json({"ok": True} if ok else {"error": "当前没有可取消的导出。"}, 200 if ok else 409)
            return
        theme = qs.get("theme", ["day"])[0]
        if theme not in ("day", "night"):
            self._json({"error": "无效的舞台主题。"}, 400)
            return
        with _video_exports.lock:
            meta = api_mashup(mid)
            if not meta:
                self._json({"error": "作品不存在。"}, 404)
                return
            export = _video_exports.start(mid, Path(MASHUPS_DIR, mid), meta, theme, f"http://127.0.0.1:{port}")
        self._json(export, 202)

    def _serve_song_share(self, qs):
        song_id = qs.get("song_id", [""])[0]
        song = api_song(song_id)
        if not song:
            self._json({"error": "未找到这首歌。"}, 404)
            return
        fav_raw = qs.get("favs", [""])[0]
        fav_starts = []
        for token in fav_raw.split(","):
            token = token.strip()
            if token:
                try:
                    fav_starts.append(int(float(token)))
                except ValueError:
                    continue
        source = _song_source(song_id)
        audio_bytes, audio_mime = _load_share_audio(source) if source else (b"", "audio/mpeg")
        doc = kg_share.build_share_html(song, fav_starts=fav_starts,
                                        audio_bytes=audio_bytes, audio_mime=audio_mime).encode("utf-8")
        title = str(song.get("title") or "歌词分享").strip()
        artist = str(song.get("artist") or "").strip()
        base_name = f"{title} - {artist}" if artist else title
        safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", base_name).strip(" .") or "lyric-share"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Disposition",
                         f"attachment; filename=lyric-share.html; filename*=UTF-8''{quote(safe_name + '.html', safe='')}")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(doc)))
        self.end_headers()
        self.wfile.write(doc)

    def _serve_song_stream(self, qs):
        song_id = qs.get("song_id", [""])[0]
        source = _song_source(song_id)
        if source is None:
            msg = "酷狗暂时未提供这首歌的播放地址。"
            _note_stream_error(song_id, msg, 404)
            self._json({"error": msg}, 404)
            return
        client = kg_api.KugouClient()
        cache_path = _playback_audio.path(client.userid if client.logged_in else "",
                                          source["file_hash"], source["mixsongid"])
        cached = _playback_audio.open(cache_path)
        if cached:
            _clear_stream_error(song_id)
            handle, content_type = cached
            with handle:
                self._serve_media_file(handle, content_type)
            return

        active = _playback_audio.acquire_download(cache_path)
        if active:
            _clear_stream_error(song_id)
            with active:
                self._serve_progressive_download(active, song_id)
            return

        headers = {"User-Agent": _AUDIO_USER_AGENT, "Accept-Encoding": "identity"}
        for name in ("Range", "If-Range"):
            if value := self.headers.get(name):
                headers[name] = value
        try:
            stream = kg_stream.SongStream(client, source, _playback_links, headers)
        except kg_stream.StreamUnavailable as error:
            status = 404 if error.not_found else (502 if error.expired else 503)
            _note_stream_error(song_id, str(error), status)
            self._json({"error": str(error)}, status)
            return

        upstream = stream.response
        length = kg_playback.complete_length(upstream.status, upstream.headers)
        content_type = upstream.headers.get("Content-Type", "audio/mpeg")
        if (length > 0 and upstream.status in (200, 206)
                and not content_type.lower().startswith(("text/", "application/json"))):
            reader = _playback_audio.start_download(
                cache_path, stream, length, content_type,
                etag=upstream.headers.get("ETag"),
                last_modified=upstream.headers.get("Last-Modified"),
            )
            if reader is not None:
                _clear_stream_error(song_id)
                with reader:
                    self._serve_progressive_download(reader, song_id)
                return

        with stream.response:
            self._relay_song_audio(stream, cache_path, song_id)

    def _serve_progressive_download(self, reader, song_id=""):
        """边下边播：从后台全速下载的 .part 文件响应浏览器 Range 请求。"""
        size = reader.total
        start, end = 0, size - 1
        requested = (self.headers.get("Range") or "").strip()
        if_range = (self.headers.get("If-Range") or "").strip()
        range_ok = (not if_range
                    or (reader.etag and if_range == reader.etag)
                    or (reader.last_modified and if_range == reader.last_modified))
        match = re.fullmatch(r"bytes=([0-9]{0,20})-([0-9]{0,20})", requested) if range_ok else None
        partial = bool(match and any(match.groups()))
        if partial:
            if match[1]:
                start = int(match[1])
                if match[2]:
                    end = min(end, int(match[2]))
            else:
                start = max(0, size - int(match[2]))
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        length = end - start + 1
        self.send_response(206 if partial else 200)
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Type", reader.content_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "private, no-store")
        if reader.etag:
            self.send_header("ETag", reader.etag)
        if reader.last_modified:
            self.send_header("Last-Modified", reader.last_modified)
        self.end_headers()
        written = 0
        try:
            for chunk in reader.iter_range(start, end):
                self.wfile.write(chunk)
                written += len(chunk)
            if written < length:
                self.close_connection = True
                _note_stream_error(song_id, "音频传输中途中断，请重试。", 502)
        except (OSError, HTTPException):
            self.close_connection = True

    def _relay_song_audio(self, stream, cache_path, song_id=""):
        upstream = stream.response
        if upstream.status == 416:
            self.send_response(416)
            if content_range := upstream.headers.get("Content-Range"):
                self.send_header("Content-Range", content_range)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        content_type = upstream.headers.get("Content-Type", "audio/mpeg")
        if upstream.status not in (200, 206) or content_type.lower().startswith(("text/", "application/json")):
            msg = "酷狗返回了不可播放的音频响应，请重试。"
            _note_stream_error(song_id, msg, 502)
            self._json({"error": msg}, 502)
            return
        _clear_stream_error(song_id)
        self.send_response(upstream.status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "private, no-store")
        for name in ("Content-Length", "Content-Range", "Accept-Ranges", "Content-Encoding", "ETag", "Last-Modified"):
            if name == "Content-Length" and upstream.headers.get("Transfer-Encoding"):
                continue
            if value := upstream.headers.get(name):
                self.send_header(name, value)
        self.end_headers()
        length = kg_playback.complete_length(upstream.status, upstream.headers)
        expected = (stream.end - stream.offset) if stream.end is not None else None
        written = 0
        try:
            with closing(_playback_audio.capture(cache_path, stream.chunks(), length)) as relay:
                for chunk in relay:
                    self.wfile.write(chunk)
                    written += len(chunk)
            if expected is not None and written < expected:
                self.close_connection = True
                _note_stream_error(song_id, "音频传输中途中断，请重试。", 502)
        except (OSError, HTTPException):
            self.close_connection = True

    def _serve_cover(self, name):
        base = os.path.realpath(COVERS_DIR)
        full = os.path.realpath(os.path.join(base, name))
        if not full.startswith(base + os.sep) or not os.path.isfile(full) \
                or not full.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            self._json({"error": "not found"}, 404)
            return
        size = os.path.getsize(full)
        self.send_response(200)
        self.send_header("Content-Type", MIME_TYPES.get(os.path.splitext(full)[1].lower(), "image/jpeg"))
        self.send_header("Cache-Control", "max-age=604800")
        self.send_header("Content-Length", str(size))
        self.end_headers()
        with open(full, "rb") as f:
            self.wfile.write(f.read())

    def _serve_index(self):
        body = _read_dist("index.html")
        if body is None:
            self._json({"error": "前端未构建：请先在 web/ 下运行 npm run build"}, 500)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_favorites_asset(self, relative_path):
        full = _dist_path(relative_path)
        if full is None:
            self._json({"error": "not found"}, 404)
            return
        content_type = MIME_TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
        with open(full, "rb") as handle:
            if content_type == "audio/mpeg":
                self._serve_media_file(handle, content_type)
                return
            stat = os.fstat(handle.fileno())
            tag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
            tags = {entry.strip().removeprefix("W/") for entry in self.headers.get("If-None-Match", "").split(",")}
            cached = tag in tags or "*" in tags
            self.send_response(304 if cached else 200)
            self.send_header("ETag", tag)
            self.send_header("Cache-Control", "private, no-cache")
            if not cached:
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(stat.st_size))
            self.end_headers()
            if not cached:
                shutil.copyfileobj(handle, self.wfile)

    def do_GET(self):
        self._headers_sent = False
        u = urlparse(self.path)
        path, qs = unquote(u.path), parse_qs(u.query)
        try:
            if path == "/" or path == "/index.html":
                if not any(k in qs for k in ("stage", "song", "mashup")) and kg_setup.needs_setup(DB_PATH):
                    self.send_response(302)
                    self.send_header("Location", "/setup")
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                self._serve_index()
            elif path == "/setup":
                body = kg_setup.render_setup_page().encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            elif path == "/api/setup/status":
                self._json(kg_setup.setup_state(DB_PATH))
            elif path == "/api/setup/qr/status":
                self._json(kg_setup.poll_qr(qs.get("key", [""])[0]))
            elif path == "/api/setup/sync/status":
                self._json(kg_setup.sync_status())
            elif path.startswith("/assets/favorites/"):
                self._serve_favorites_asset(path.lstrip("/"))
            elif path.startswith("/assets/"):
                body = _read_dist(path.lstrip("/"))
                if body is None:
                    self._json({"error": "not found"}, 404)
                    return
                ext = os.path.splitext(path)[1].lower()
                self.send_response(200)
                self.send_header("Content-Type", MIME_TYPES.get(ext, "application/octet-stream"))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            elif path == "/api/mashups":
                self._json(api_mashups())
            elif path == "/api/mashup":
                m = api_mashup(qs.get("id", [""])[0])
                self._json(m if m else {"error": "not found"}, 200 if m else 404)
            elif path == "/api/mashup/video":
                self._serve_video_export(qs.get("id", [""])[0])
            elif path == "/api/mashup/video/status":
                mid = qs.get("id", [""])[0]
                export = _video_exports.summary(mid, Path(MASHUPS_DIR, mid)) if _safe_mashup_id(mid) else None
                self._json(export or {"error": "导出任务不存在。"}, 200 if export else 404)
            elif path == "/api/mashup/tasks":
                with _TASKS_LOCK:
                    tasks = sorted(MASHUP_TASKS.values(),
                                   key=lambda t: t["created"], reverse=True)
                    summaries = [_task_summary(t) for t in tasks]
                for t in summaries:
                    mid = t["meta_id"]
                    t["work_available"] = bool(mid and _safe_mashup_id(mid)
                                               and os.path.isfile(os.path.join(MASHUPS_DIR, mid, "meta.json")))
                    if t["work_available"]:
                        t["video_export"] = _video_exports.summary(mid, Path(MASHUPS_DIR, mid))
                self._json(summaries)
            elif path == "/api/mashup/preview":
                word = (qs.get("word", [""])[0] or "").strip()
                if not word or len(word) > 20:
                    self._json({"error": "请输入 1~20 个字的关键词"}, 400)
                else:
                    self._json({"word": word, "songs": kg_mashup.preview_word(word)})
            elif path == "/api/mashup/songcheck":
                word = (qs.get("word", [""])[0] or "").strip()
                sid = (qs.get("song_id", [""])[0] or "").strip()
                info = None
                if word and len(word) <= 20 and sid:
                    info = kg_mashup.song_word_occurrences(sid, word)
                self._json(info if info else {"error": "未找到这首歌"}, 200 if info else 404)
            elif path == "/api/mashup/songclip":
                # 弹窗试听：算出制作时会选中的片段窗口（毫秒），音频前端走 /api/song/stream
                word = (qs.get("word", [""])[0] or "").strip()
                sid = (qs.get("song_id", [""])[0] or "").strip()
                clip = None
                if word and len(word) <= 20 and sid:
                    clip = kg_mashup.song_clip_window(sid, word)
                self._json(clip if clip else {"error": "没有可用片段"}, 200 if clip else 404)
            elif path.startswith("/audio/"):
                parts = path.split("/", 3)
                if len(parts) < 4 or not parts[2] or not parts[3]:
                    self._json({"error": "not found"}, 404)
                else:
                    self._serve_audio(parts[2], parts[3])
            elif path == "/api/stats":
                self._json(api_stats())
            elif path == "/api/lyric":
                kw = (qs.get("q", [""])[0] or "").strip()
                if not kw:
                    self._json({"error": "缺少参数 q"}, 400)
                else:
                    self._json(api_lyric_search(kw, _int_param(qs, "page", 1)))
            elif path == "/api/songs":
                self._json(api_songs(qs.get("q", [""])[0].strip(),
                                     _int_param(qs, "page", 1)))
            elif path == "/api/covers":
                self._json(api_covers())
            elif path.startswith("/covers/"):
                self._serve_cover(path[len("/covers/"):])
            elif path == "/api/song/stream":
                self._serve_song_stream(qs)
            elif path == "/api/song/share":
                self._serve_song_share(qs)
            elif path == "/api/song/climax":
                self._json(*api_song_climax(qs.get("song_id", [""])[0]))
            elif path == "/api/song/url":
                # 播放地址预检查 / 播放失败诊断：带 diag=1 时优先返回刚发生的拉流错误
                sid = qs.get("song_id", [""])[0]
                if qs.get("diag", [""])[0] == "1":
                    recent = _recent_stream_error(sid)
                    if recent:
                        self._json({"error": recent[0]}, recent[1])
                        return
                url = resolve_song_play_url(sid)
                self._json({"url": url} if url else {"error": "酷狗暂时未提供这首歌的播放地址。"},
                           200 if url else 404)
            elif path == "/api/song":
                sid = qs.get("song_id", [""])[0]
                d = api_song(sid)
                self._json(d if d else {"error": "not found"}, 200 if d else 404)
            elif path == "/api/occ":
                sid, kw = qs.get("song_id", [""])[0], (qs.get("kw", [""])[0] or "").strip()
                if not sid or not kw:
                    self._json({"error": "缺少参数"}, 400)
                else:
                    self._json(api_occurrences(sid, kw))
            else:
                self._json({"error": "not found"}, 404)
        except kg_api.KgLoginRequired as e:
            self._json({"error": str(e)}, 401)
        except Exception as e:  # noqa: BLE001
            self.close_connection = True  # 处理中途失败，连接状态不可信，回完这条就断开
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    def do_DELETE(self):
        self._headers_sent = False
        u = urlparse(self.path)
        path, qs = unquote(u.path), parse_qs(u.query)
        try:
            if path == "/api/mashup":
                mid = qs.get("id", [""])[0]
                if not delete_mashup(mid):
                    self._json({"error": "not found"}, 404)
                    return
                self._json({"deleted": mid})
            elif path == "/api/mashup/task":
                tid = qs.get("id", [""])[0]
                with _TASKS_LOCK:
                    task = MASHUP_TASKS.get(tid)
                    busy = task is not None and task["status"] in _ACTIVE_TASK_STATES
                if busy:
                    self._json({"error": "进行中的记录不能删除"}, 409)
                elif task is None:
                    self._json({"error": "not found"}, 404)
                else:
                    # 完成的记录连同作品一起删：觅字列表里的作品同步消失
                    meta_id = task.get("meta_id")
                    if not (meta_id and delete_mashup(meta_id)):
                        # 失败的记录，或作品目录早已不在（「已删除」状态）：只删记录本身
                        with _TASKS_LOCK:
                            MASHUP_TASKS.pop(tid, None)
                        _save_tasks()
                    self._json({"deleted": tid})
            else:
                self.close_connection = True
                self._json({"error": "not found"}, 404)
        except kg_video.ExportError as e:
            self._json({"error": str(e)}, 409)
        except OSError as e:
            self._json({"error": f"删除失败：{e}"}, 500)
        except Exception as e:  # noqa: BLE001
            self.close_connection = True
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    def do_POST(self):
        self._headers_sent = False
        u = urlparse(self.path)
        path, qs = unquote(u.path), parse_qs(u.query)
        try:
            if path == "/api/setup/qr":
                self.close_connection = True
                self._json(kg_setup.create_qr())
            elif path == "/api/setup/sync":
                self.close_connection = True
                try:
                    length = int(self.headers.get("Content-Length") or 0)
                except ValueError:
                    length = 0
                raw = self.rfile.read(min(length, 4096)) if length > 0 else b""
                try:
                    body = json.loads(raw) if raw else {}
                except ValueError:
                    body = {}
                scope = body.get("scope", "liked") if isinstance(body, dict) else "liked"
                force = bool(body.get("force", False)) if isinstance(body, dict) else False
                self._json(*kg_setup.start_sync(DB_PATH, scope=scope, force=force))
            elif path == "/api/lyric/semantic":
                self._handle_semantic_lyric_search()
            elif path in ("/api/mashup/video", "/api/mashup/video/cancel"):
                self._handle_video_export(qs, path.endswith("/cancel"))
            elif path == "/api/mashup/create":
                try:
                    length = int(self.headers.get("Content-Length") or 0)
                except ValueError:
                    length = 0
                if length > 65536:
                    # 先看头再读体：不能把超大请求整个读进内存后才拒绝
                    self.close_connection = True
                    self._json({"error": "请求体过大"}, 413)
                    return
                _handle_mashup_create(self, self.rfile.read(length) if length else b"")
            elif path == "/api/mashup/task/cancel":
                # 取消请求不带正文；即使传了正文，也不能让未读正文进入下一次请求。
                self.close_connection = True
                self._json(*cancel_mashup_task(qs.get("id", [""])[0]))
            else:
                self.close_connection = True  # 未读请求体，断开防 keep-alive 错乱
                self._json({"error": "not found"}, 404)
        except kg_video.ExportError as e:
            self._json({"error": str(e)}, 409)
        except Exception as e:  # noqa: BLE001
            self.close_connection = True
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    def _handle_semantic_lyric_search(self):
        self.close_connection = True
        if self.headers.get_content_type() != "application/json":
            self._json({"error": "语义检索请求须使用 JSON。"}, 415)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length > 8192:
            self._json({"error": "请求体过大。"}, 413)
            return
        try:
            payload = json.loads(self.rfile.read(length)) if length > 0 else None
        except (ValueError, RecursionError):
            self._json({"error": "无法读取语义检索请求。"}, 400)
            return
        self._json(*api_semantic_lyric_search(payload))


def main():
    ap = argparse.ArgumentParser(description="酷狗歌词库网页控制台")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    if not os.path.exists(DB_PATH):
        kg_store._connect(DB_PATH).close()
    if kg_setup.needs_setup(DB_PATH):
        print("检测到首次使用（尚未登录酷狗账号或歌词库为空），浏览器将自动打开扫码登录与同步引导页。")
    # 老库的 lyrics_text 还可能带着制作信息行，启动时修正一次（版本号存在 meta 表）
    try:
        fixed = kg_store.migrate_credit_text(DB_PATH)
        if fixed:
            print(f"已修正 {fixed} 首旧歌词文本（剔除制作信息行）")
    except Exception as e:  # noqa: BLE001
        print(f"旧歌词文本迁移失败（不影响启动）：{type(e).__name__}: {e}")
    _load_tasks()
    # 已有歌词库但封面缓存缺失（或新加了歌）时，后台补拉一次，页面刷新即可看到封面墙
    try:
        kg_covers.ensure_library_covers(DB_PATH)
    except Exception as e:  # noqa: BLE001
        print(f"封面后台补拉未启动（不影响使用）：{type(e).__name__}: {e}")
    # Windows 上 HTTPServer 默认 allow_reuse_address=1：端口被占也能"成功"绑定，
    # 浏览器打开的却是占坑服务的页面且毫无报错。关掉它，让冲突被真正检测出来，
    # 再依次向后找空闲端口，保证双击 start.bat 打开的一定是本站
    class ConsoleServer(ThreadingHTTPServer):
        allow_reuse_address = False

    srv = None
    port = args.port
    for _ in range(20):
        try:
            srv = ConsoleServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            print(f"端口 {port} 被占用，尝试 {port + 1} …")
            port += 1
    if srv is None:
        sys.exit(f"{args.port}~{port - 1} 全被占用，无法启动")
    url = f"http://127.0.0.1:{port}"
    print(f"歌词库控制台已启动: {url}  （Ctrl+C 退出）")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出")
    finally:
        _video_exports.shutdown()


if __name__ == "__main__":
    main()

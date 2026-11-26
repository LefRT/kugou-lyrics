# -*- coding: utf-8 -*-
"""首次启动网页引导：零依赖酷狗扫码登录 + 歌单歌词同步。"""
import json
import os
import threading
import time
from contextlib import closing

import kg_api
import kg_qr
import kg_store

BASE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(BASE, "setup_template", "index.html")
LIKED_NAMES = {"我喜欢", "我喜欢的音乐", "默认收藏", "My Favorites"}

_sync_lock = threading.Lock()
_sync_state = {
    "running": False,
    "finished": False,
    "phase": "idle",
    "playlist": "",
    "playlists_total": 0,
    "playlists_done": 0,
    "done": 0,
    "total": 0,
    "krc": 0,
    "lrc": 0,
    "none": 0,
    "skipped": 0,
    "current": "",
    "error": None,
}


def song_count(db_path: str) -> int:
    if not os.path.exists(db_path):
        return 0
    try:
        with closing(kg_store._connect(db_path)) as conn:
            row = conn.execute("SELECT COUNT(*) FROM songs").fetchone()
            return int(row[0]) if row else 0
    except Exception:
        return 0


def needs_setup(db_path: str) -> bool:
    client = kg_api.KugouClient()
    return (not client.logged_in) or (song_count(db_path) == 0)


def setup_state(db_path: str) -> dict:
    client = kg_api.KugouClient()
    count = song_count(db_path)
    with _sync_lock:
        sync = dict(_sync_state)
    return {
        "logged_in": client.logged_in,
        "userid": client.userid if client.logged_in else "",
        "song_count": count,
        "needs_setup": (not client.logged_in) or (count == 0),
        "sync": sync,
    }


def create_qr() -> dict:
    client = kg_api.KugouClient()
    key = client.qr_create_key()
    url = client.qr_content_url(key)
    svg = kg_qr.render_svg(url)
    return {"key": key, "url": url, "svg": svg}


def poll_qr(key: str) -> dict:
    key = (key or "").strip()
    if not key:
        return {"status": -1, "label": "缺少二维码 key"}
    client = kg_api.KugouClient()
    d = client.qr_status(key)
    st = d.get("status")
    labels = {
        0: "二维码已过期，请刷新",
        1: "等待扫码",
        2: "已扫码，请在手机酷狗上确认登录",
        4: "登录成功",
    }
    out = {"status": st, "label": labels.get(st, f"状态 {st}")}
    if st == 4:
        client.token = str(d.get("token") or "")
        client.userid = str(d.get("userid") or "")
        if d.get("dfid"):
            client.dfid = str(d["dfid"])
        if not client.logged_in:
            return {"status": -1, "label": "酷狗未返回完整登录凭据，请重试"}
        client.save_session()
        out["userid"] = client.userid
        out["nickname"] = str(d.get("nick_name") or d.get("nickname") or "")
    return out


def sync_status() -> dict:
    with _sync_lock:
        return dict(_sync_state)


def _update_sync(**kwargs):
    with _sync_lock:
        _sync_state.update(kwargs)


def _pick_playlists(playlists: list[dict], scope: str) -> list[dict]:
    if scope == "all":
        return playlists
    liked = [
        p for p in playlists
        if p.get("name") in LIKED_NAMES or str(p.get("listid")) == "2"
    ]
    return liked or playlists[:1]


def _run_sync(db_path: str, scope: str, force: bool):
    try:
        client = kg_api.KugouClient()
        if not client.logged_in:
            _update_sync(running=False, phase="error", error="尚未登录酷狗账号，请先扫码登录。")
            return
        _update_sync(phase="playlists", current="正在获取酷狗歌单列表…")
        playlists = client.user_playlists()
        if not playlists:
            _update_sync(running=False, phase="error", error="未获取到歌单列表，请稍后重试或重新扫码登录。")
            return
        chosen = _pick_playlists(playlists, scope)
        _update_sync(phase="tracks", playlists_total=len(chosen), playlists_done=0)

        plan = []
        total_tracks = 0
        for pl in chosen:
            _update_sync(playlist=pl["name"], current=f"正在读取歌单「{pl['name']}」…")
            tracks = client.playlist_tracks(pl["listid"], pl["gid"])
            plan.append((pl, tracks))
            total_tracks += len(tracks)

        if total_tracks == 0:
            _update_sync(
                running=False, finished=True, phase="done",
                total=0, done=0, current="歌单中暂无歌曲",
            )
            return

        _update_sync(phase="lyrics", total=total_tracks, done=0)
        done = krc_n = lrc_n = none_n = skip_n = 0
        for p_idx, (pl, tracks) in enumerate(plan):
            _update_sync(playlist=pl["name"], playlists_done=p_idx)
            for tr in tracks:
                done += 1
                song_id = tr["mixsongid"] or tr["hash"]
                label = f"{tr['title']} - {tr['artist']}"
                _update_sync(done=done, current=label)
                existing = kg_store.find_song(db_path, song_id)
                if existing and not force and existing[0]["lyric_type"] in ("krc", "lrc"):
                    skip_n += 1
                    _update_sync(skipped=skip_n)
                    continue
                lyr = None
                if tr["hash"]:
                    try:
                        lyr = client.fetch_lyrics(
                            tr["hash"], tr["duration_ms"],
                            f"{tr['artist']} - {tr['title']}", tr["mixsongid"] or None,
                            title=tr["title"], artist=tr["artist"],
                        )
                    except kg_api.KgApiError:
                        lyr = None
                if lyr:
                    timeline_json = json.dumps(
                        lyr["timeline"], ensure_ascii=False, separators=(",", ":")
                    )
                    kg_store.upsert_song(db_path, {
                        "song_id": song_id, "title": tr["title"], "artist": tr["artist"],
                        "lyrics_text": lyr["text"], "word_timeline": timeline_json,
                        "lyric_type": lyr["type"], "file_hash": tr["hash"],
                        "duration_ms": tr["duration_ms"], "mixsongid": tr["mixsongid"],
                        "playlist": pl["name"],
                    })
                    if lyr["type"] == "krc":
                        krc_n += 1
                    else:
                        lrc_n += 1
                else:
                    none_n += 1
                    kg_store.upsert_song(db_path, {
                        "song_id": song_id, "title": tr["title"], "artist": tr["artist"],
                        "lyrics_text": None, "word_timeline": None, "lyric_type": "none",
                        "file_hash": tr["hash"], "duration_ms": tr["duration_ms"],
                        "mixsongid": tr["mixsongid"], "playlist": pl["name"],
                    })
                _update_sync(krc=krc_n, lrc=lrc_n, none=none_n, skipped=skip_n)
                time.sleep(0.18)
            _update_sync(playlists_done=p_idx + 1)

        _update_sync(
            running=False, finished=True, phase="done",
            done=total_tracks, total=total_tracks,
            krc=krc_n, lrc=lrc_n, none=none_n, skipped=skip_n,
            current="同步完成",
        )
    except Exception as e:
        _update_sync(running=False, phase="error", error=f"同步出错：{e}")


def start_sync(db_path: str, scope: str = "liked", force: bool = False) -> tuple[dict, int]:
    scope = "all" if scope == "all" else "liked"
    with _sync_lock:
        if _sync_state["running"]:
            return dict(_sync_state), 200
        _sync_state.update({
            "running": True,
            "finished": False,
            "phase": "starting",
            "playlist": "",
            "playlists_total": 0,
            "playlists_done": 0,
            "done": 0,
            "total": 0,
            "krc": 0,
            "lrc": 0,
            "none": 0,
            "skipped": 0,
            "current": "正在准备同步…",
            "error": None,
        })
    threading.Thread(
        target=_run_sync, args=(db_path, scope, bool(force)), daemon=True
    ).start()
    return sync_status(), 202


def render_setup_page() -> str:
    with open(TEMPLATE_PATH, "r", encoding="utf-8") as f:
        return f.read()

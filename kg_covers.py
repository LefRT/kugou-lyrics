# -*- coding: utf-8 -*-
"""拉取全库专辑封面：按专辑去重，每张专辑只存一张。

- 封面地址来自免登录接口 m.kugou.com/app/i/getSongInfo.php（cmd=playInfo 的 album_img 字段）
- album_img 为空时（多为无专辑的 UGC/单曲），用 song_search_v2 按 FileHash 精确匹配再取一次；
  该接口对这类曲目常只给歌手头像，记为 src=singer（--no-singer 可跳过，只要真专辑图）
- 去重键：专辑的封面模板 URL（同专辑多首歌返回同一地址），文件名用 albumid
- 断点续跑：covers/_index.json 记录 song_id → 封面文件，重跑自动跳过已完成的歌
- 网页首次同步与正常启动会自动补封面，一般不需要手动运行；手动用法：
    py -3 kg_covers.py                # 240px 全量
    py -3 kg_covers.py --size 480     # 480px（换尺寸需先清空 covers/ 重跑）
    py -3 kg_covers.py --limit 10     # 只跑前 10 首（测试用）
    py -3 kg_covers.py --no-singer    # 不接受歌手头像兜底
"""
import argparse
import json
import os
import sqlite3
import sys
import threading
import time

sys.dont_write_bytecode = True

import kg_api
import kg_store

BASE = os.path.dirname(os.path.abspath(__file__))
COVERS_DIR = os.path.join(BASE, "data", "covers")
INDEX_FILE = os.path.join(COVERS_DIR, "_index.json")


class RateLimited(RuntimeError):
    """连续多首被酷狗限流，本次中止（进度已存盘）。"""


def _write_index(index):
    """原子写索引：中途被杀不会留下半截 JSON 导致下次全量重跑。"""
    tmp = INDEX_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, INDEX_FILE)


def _load_index():
    if not os.path.exists(INDEX_FILE):
        return {}
    try:
        with open(INDEX_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _song_rows(db_path):
    if not os.path.exists(db_path):
        return []
    try:
        conn = sqlite3.connect(db_path)
        rows = conn.execute(
            "SELECT song_id, title, artist, file_hash FROM songs WHERE file_hash != ''"
        ).fetchall()
        conn.close()
        return rows
    except sqlite3.Error:
        return []


def _normalize_jpeg(path):
    """CDN 对 .jpg 地址偶尔返回 PNG；统一转成真 JPEG（后端按扩展名给 MIME）。"""
    try:
        with open(path, "rb") as f:
            if f.read(8) != b"\x89PNG\r\n\x1a\n":
                return
        from PIL import Image
        with Image.open(path) as im:
            im.convert("RGB").save(path, "JPEG", quality=90, optimize=True)
    except (ImportError, OSError, ValueError):
        pass


def missing_cover_count(db_path=None) -> int:
    """库里还没进封面索引的歌曲数（用于判断是否需要补拉）。"""
    index = _load_index()
    return sum(1 for row in _song_rows(db_path or kg_store.DEFAULT_DB)
               if str(row[0]) not in index)


def fetch_library(db_path=None, size=240, allow_singer=True, sleep=0.25,
                  limit=0, progress=None, stop=None) -> dict:
    """拉取全库封面。progress(stats) 每 50 首及结束时回调；stop() 为真时提前结束。"""
    db_path = db_path or kg_store.DEFAULT_DB
    os.makedirs(COVERS_DIR, exist_ok=True)
    index = _load_index()
    rows = _song_rows(db_path)
    if limit:
        rows = rows[:limit]

    client = kg_api.KugouClient()
    ok = reuse = fail = singer = 0
    rate_hits = 0
    stopped = False
    processed = 0
    total = len(rows)
    t0 = time.time()

    def emit(done):
        if not progress:
            return
        try:
            progress({"total": total, "done": done, "ok": ok, "reuse": reuse,
                      "fail": fail, "singer": singer})
        except Exception:
            pass

    for i, (song_id, title, artist, fhash) in enumerate(rows, 1):
        processed = i
        if stop and stop():
            stopped = True
            break
        sid = str(song_id)
        entry = index.get(sid)
        if isinstance(entry, dict) and entry.get("file"):
            reuse += 1
            continue
        d, err = {}, ""
        for attempt in range(3):
            try:
                d = client.song_url_legacy(fhash)
            except kg_api.KgApiError as e:
                d, err = {}, str(e)[:120]
            img = (d.get("album_img") or "").strip()
            err = str(d.get("error") or d.get("err") or err or "")
            if img:
                rate_hits = 0
                break
            if "频繁" in err:
                # 只有"操作太频繁"才是限流，等了再试；连续多首全撞限流就中止
                rate_hits += 1
                if rate_hits >= 9:
                    _write_index(index)
                    raise RateLimited(
                        f"连续 {rate_hits} 次被限流，中止（进度已存盘，"
                        f"过段时间重跑即可从断点继续）")
                wait = (90, 240, 480)[attempt]
                print(f"[{i}] 限流：{err} —— 等 {wait}s 再试", flush=True)
                time.sleep(wait)
            else:
                # status=0 无版权 / status=1 但 album_img 为空：接口明确拒绝或真没有，重试无意义
                rate_hits = 0
                break
        album_id = str(d.get("albumid") or "").strip()
        album_name = str(d.get("album_name") or "").strip()
        src = "playInfo"
        if not img and "频繁" not in err:
            # playInfo 没有封面：按 FileHash 精确匹配再搜一次（多为无专辑的单曲/UGC）
            cov = None
            try:
                cov = client.search_cover(title, artist, fhash)
            except (kg_api.KgApiError, ValueError) as e:
                err = f"搜索封面失败: {e}"[:120]
            if cov:
                img = cov["img"]
                album_id = cov.get("album_id") or ""
                album_name = cov.get("album") or ""
                src = cov.get("kind") or "search"
                rate_hits = 0
        if not img:
            if "频繁" in err:
                # 整首歌都撞在限流上：不写索引（下轮重跑会再试），也不算真失败
                continue
            label = "无版权（接口拒绝返回）" if d.get("status") == 0 else "无封面"
            index[sid] = {"file": "", "error": (err or label)[:120], "title": title}
            fail += 1
            continue
        if src == "singer" and not allow_singer:
            index[sid] = {"file": "", "error": "仅有歌手头像（--no-singer 已跳过）",
                          "title": title}
            fail += 1
            continue
        fname = f"alb_{album_id or kg_api._md5(img)[:12]}_{size}.jpg"
        dest = os.path.join(COVERS_DIR, fname)
        try:
            if os.path.isfile(dest) and os.path.getsize(dest) > 0:
                pass  # 同专辑的另一首歌已经下过了
            else:
                client.download_file(img.replace("{size}", str(size)),
                                     dest, max_mb=5, timeout=30)
                _normalize_jpeg(dest)
            index[sid] = {"file": fname, "album": album_id, "album_name": album_name,
                          "title": title, "src": src}
            ok += 1
            if src == "singer":
                singer += 1
        except (kg_api.KgApiError, OSError) as e:
            index[sid] = {"file": "", "error": str(e)[:120], "title": title}
            fail += 1
        if i % 50 == 0:
            _write_index(index)
            emit(i)
            print(f"[{i}/{total}] 本次新增 {ok}（头像兜底 {singer}）"
                  f" 失败 {fail} | {time.time() - t0:.0f}s", flush=True)
        time.sleep(sleep)

    _write_index(index)
    files = len([x for x in os.listdir(COVERS_DIR) if x.endswith(".jpg")])
    stats = {"total": total, "done": processed, "ok": ok, "reuse": reuse,
             "fail": fail, "singer": singer, "files": files, "stopped": stopped,
             "elapsed": round(time.time() - t0, 1)}
    emit(total)
    return stats


_backfill_started = False
_backfill_lock = threading.Lock()


def _background_fetch(db_path):
    try:
        fetch_library(db_path)
    except Exception as e:
        print(f"后台补拉封面中止：{e}", flush=True)


def ensure_library_covers(db_path=None) -> bool:
    """库里有歌但封面索引有缺口时，后台补拉一次（每次进程只尝试一次）。"""
    global _backfill_started
    with _backfill_lock:
        if _backfill_started:
            return False
        _backfill_started = True
    try:
        if missing_cover_count(db_path) <= 0:
            return False
    except Exception:
        return False
    threading.Thread(target=_background_fetch, args=(db_path,), daemon=True).start()
    return True


def main():
    ap = argparse.ArgumentParser(description="拉取专辑封面（按专辑去重）")
    ap.add_argument("--size", type=int, default=240, choices=(150, 240, 480),
                    help="封面尺寸，默认 240")
    ap.add_argument("--sleep", type=float, default=0.25, help="每次请求间隔秒数")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 首（0=全量）")
    ap.add_argument("--no-singer", action="store_true",
                    help="无专辑图时不用歌手头像兜底")
    args = ap.parse_args()

    try:
        stats = fetch_library(size=args.size, sleep=args.sleep, limit=args.limit,
                              allow_singer=not args.no_singer)
    except RateLimited as e:
        sys.exit(str(e))
    print(f"完成：扫描 {stats['total']} 首（跳过已有 {stats['reuse']}），"
          f"本次新增 {stats['ok']} 张（其中歌手头像兜底 {stats['singer']}），"
          f"失败 {stats['fail']}，封面文件共 {stats['files']} 张，"
          f"用时 {stats['elapsed']:.0f}s", flush=True)


if __name__ == "__main__":
    main()
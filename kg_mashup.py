# -*- coding: utf-8 -*-
"""
串烧制作：以关键词为线索，从含该词的歌曲中剪出「词前后 N 秒」的片段。

流程：查库(KRC逐字) → 逐首取播放地址并整首缓存 → ffmpeg 剪片段(淡入淡出)
     → 片段时间轴平移为片段内相对时间 → meta.json + 拼接版串烧 mp3
"""
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kg_api          # noqa: E402
import kg_store        # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
MASHUPS_DIR = os.path.join(BASE, "data", "mashups")
CACHE_DIR = os.path.join(BASE, "data", "cache")

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")


class MashupError(Exception):
    """制作失败（无 ffmpeg / 未登录 / 选不到歌 / 一段未成 等）。"""


class MashupCancelled(MashupError):
    """制作已取消。"""


def _run_media(cmd, timeout, cancel_event, *, check=False, text=False):
    if cancel_event is None:
        return subprocess.run(cmd, capture_output=True, timeout=timeout, check=check, text=text)
    if cancel_event.is_set():
        raise MashupCancelled()
    deadline = time.monotonic() + timeout
    with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=text) as proc:
        try:
            while not cancel_event.is_set():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(cmd, timeout)
                try:
                    stdout, stderr = proc.communicate(timeout=min(0.2, remaining))
                except subprocess.TimeoutExpired:
                    continue
                result = subprocess.CompletedProcess(cmd, proc.returncode, stdout, stderr)
                if check:
                    result.check_returncode()
                return result
            raise MashupCancelled()
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.communicate()


def _emit(progress, **evt):
    """向网页任务报告进度；回调异常不影响制作本身。"""
    if progress:
        try:
            progress(evt)
        except Exception:  # noqa: BLE001
            pass


_RESERVED_NAMES = {"CON", "PRN", "AUX", "NUL"} \
    | {f"COM{i}" for i in range(1, 10)} | {f"LPT{i}" for i in range(1, 10)}


def _sanitize(name: str) -> str:
    # 必须和 kg_web._safe_mashup_id 的白名单一致，否则带标点的词会生成打不开的目录
    cleaned = re.sub(r"[^\w\-#\u4e00-\u9fff]+", "_", name, flags=re.UNICODE)[:40].strip("_")
    if cleaned.upper() in _RESERVED_NAMES:
        cleaned = f"m_{cleaned}"
    return cleaned or "mashup"


def probe_duration_ms(path: str, cancel_event=None):
    """读取音频时长；ffprobe 失败/输出异常时返回 0，由调用方决定跳过或回退。"""
    try:
        r = _run_media(
            [FFPROBE, "-v", "error", "-show_entries", "format=duration",
             "-of", "json", path],
            timeout=30, cancel_event=cancel_event, text=True)
        if r.returncode != 0:
            return 0
        d = json.loads(r.stdout or "{}")
        sec = float((d.get("format") or {}).get("duration") or 0)
        return int(sec * 1000)
    except (subprocess.SubprocessError, ValueError, TypeError, OSError):
        return 0


def cut_clip(src, dst, start_ms, dur_ms, cancel_event=None, fade_in_ms=300, fade_out_ms=900):
    """剪片段：响度归一 + 自适应淡入淡出。

    - loudnorm 把各歌拉到同一响度（-16 LUFS），避免换歌时音量突变；
    - 淡入在人声开口前完成，淡出落在句尾余音里（时长由 _plan_window 算好），
      曲线用 qsin/hsin，比线性更自然。
    """
    dur_s = dur_ms / 1000
    fi = max(0.05, min(fade_in_ms / 1000, dur_s / 3))
    fo = max(0.1, min(fade_out_ms / 1000, dur_s / 2))
    af = (f"loudnorm=I=-16:TP=-1.5:LRA=11,"
          f"afade=t=in:st=0:d={fi:.3f}:curve=qsin,"
          f"afade=t=out:st={max(0.0, dur_s - fo):.3f}:d={fo:.3f}:curve=hsin")
    cmd = [
        FFMPEG, "-y", "-nostdin", "-loglevel", "error",
        "-ss", f"{start_ms/1000:.3f}", "-t", f"{dur_s:.3f}", "-i", src,
        "-vn", "-map_metadata", "-1", "-af", af, "-ar", "44100",
        "-codec:a", "libmp3lame", "-b:a", "160k", dst,
    ]
    _run_media(cmd, timeout=60, cancel_event=cancel_event, check=True)


# ───────────── 选段策略 ─────────────
# 以「乐句」为单位取窗口，而不是机械的「词前后 N 秒」：
#   1. 先定位关键词所在歌词行；
#   2. 向前/向后按整行扩展上下文，直到超出 before/after 预算，
#      或遇到行间大空隙（间奏/换段，>CONTEXT_GAP_MS）为止——不把间奏带进来；
#   3. 起点 = 首行开口前 HEAD_PAD_MS（不越过与上一行空隙的中点），
#      终点 = 末行唱完后 TAIL_PAD_MS（不越过与下一行空隙的中点），留出呼吸与余音；
#   4. 剪辑时再在边界附近解码一小段音频，把切点吸附到能量最低处（静音点）。
# 同一首多处出现时打分择优：重复句（副歌）> 上下文完整 > 时长适中 > 非前奏，同分取靠前。
CONTEXT_GAP_MS = 1800
HEAD_PAD_MS = 400
TAIL_PAD_MS = 800
MIN_CLIP_MS = 3000


def _lyric_lines(tl):
    return [ln for ln in (tl.get("lines") or [])
            if not ln.get("credit") and ln.get("end", 0) > ln.get("start", 0)]


def _norm_text(s):
    return re.sub(r"[\W_]+", "", s or "").lower()


def _line_index(lines, occ):
    if not lines:
        return None
    mid = (occ["start_ms"] + occ["end_ms"]) // 2
    for i, ln in enumerate(lines):
        if ln["start"] <= mid <= ln["end"]:
            return i
    return min(range(len(lines)),
               key=lambda i: min(abs(lines[i]["start"] - mid), abs(lines[i]["end"] - mid)))


def _plan_window(lines, occ, before_ms, after_ms):
    """按乐句规划窗口，返回 dict 或 None（太短/无法定位）。"""
    i = _line_index(lines, occ)
    if i is None:
        return None
    a = b = i
    while a > 0:
        p = lines[a - 1]
        if lines[a]["start"] - p["end"] > CONTEXT_GAP_MS or occ["start_ms"] - p["start"] > before_ms:
            break
        a -= 1
    while b < len(lines) - 1:
        n = lines[b + 1]
        if n["start"] - lines[b]["end"] > CONTEXT_GAP_MS or n["end"] - occ["end_ms"] > after_ms:
            break
        b += 1
    first, last = lines[a], lines[b]
    prev_end = lines[a - 1]["end"] if a > 0 else None
    next_start = lines[b + 1]["start"] if b + 1 < len(lines) else None
    start = first["start"] - HEAD_PAD_MS
    if prev_end is not None:
        start = max(start, prev_end + max(0, first["start"] - prev_end) // 2)
    start = max(0, start)
    end = last["end"] + TAIL_PAD_MS
    if next_start is not None:
        end = min(end, last["end"] + max(0, next_start - last["end"]) // 2)
    if end - start < MIN_CLIP_MS:
        return None
    return {"start": start, "end": end, "vocal_start": first["start"], "vocal_end": last["end"],
            "prev_end": prev_end, "next_start": next_start,
            "n_lines": b - a + 1, "line_idx": i}


def _rank_candidates(tl, occs, before_ms, after_ms):
    """给每处出现规划窗口并打分，按分数降序返回 [(score, occ, window)]。"""
    lines = _lyric_lines(tl)
    if not lines:
        return []
    counts = {}
    for ln in lines:
        k = _norm_text(ln["text"])
        counts[k] = counts.get(k, 0) + 1
    out = []
    for k, occ in enumerate(occs):
        w = _plan_window(lines, occ, before_ms, after_ms)
        if not w:
            continue
        score = 0.0
        if counts.get(_norm_text(lines[w["line_idx"]]["text"]), 0) >= 2:
            score += 2.0                      # 重复句（多为副歌），辨识度高
        score += min(w["n_lines"], 3) * 0.5   # 有上下文，听感完整
        dur = w["end"] - w["start"]
        if dur < 6000:
            score -= 1.0
        elif dur > 25000:
            score -= 1.0
        if occ["start_ms"] < 15000:
            score -= 0.5                      # 太靠前常是前奏/开场白
        score -= k * 0.05                     # 同分取靠前
        out.append((score, occ, w))
    out.sort(key=lambda x: -x[0])
    return out


def _quiet_point(src, lo_ms, hi_ms, cancel_event=None):
    """解码 [lo, hi] 区间，返回 30ms 窗内能量最低处的绝对毫秒；失败返回 None。"""
    if hi_ms - lo_ms < 60:
        return None
    import array
    sr = 8000
    try:
        r = _run_media([FFMPEG, "-nostdin", "-loglevel", "error",
                        "-ss", f"{lo_ms/1000:.3f}", "-t", f"{(hi_ms-lo_ms)/1000:.3f}", "-i", src,
                        "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"],
                       timeout=30, cancel_event=cancel_event)
    except (subprocess.SubprocessError, OSError):
        return None
    if r.returncode != 0 or not r.stdout:
        return None
    pcm = array.array("h")
    pcm.frombytes(r.stdout[: len(r.stdout) // 2 * 2])
    if sys.byteorder == "big":
        pcm.byteswap()
    win = int(sr * 0.03)
    hop = win // 2
    if len(pcm) < win:
        return None
    best, best_e = 0, None
    for s in range(0, len(pcm) - win + 1, hop):
        e = sum(x * x for x in pcm[s:s + win:2])
        if best_e is None or e < best_e:
            best, best_e = s, e
    return lo_ms + int((best + win / 2) * 1000 / sr)


def _refine_bounds(src, w, audio_ms, cancel_event=None):
    """在规划边界附近吸附静音点，并给出淡入/淡出时长（毫秒）。"""
    start, end = w["start"], min(w["end"], audio_ms)
    lo = max(0, w["vocal_start"] - 700, (w["prev_end"] or 0) + 50)
    q = _quiet_point(src, lo, w["vocal_start"] - 40, cancel_event)
    if q is not None:
        start = q
    hi = min(audio_ms, w["vocal_end"] + 1000,
             (w["next_start"] - 50) if w["next_start"] is not None else audio_ms)
    q = _quiet_point(src, w["vocal_end"] + 120, hi, cancel_event)
    if q is not None:
        end = q
    fade_in = max(80, min(400, w["vocal_start"] - start))
    fade_out = max(350, min(1200, end - w["vocal_end"] + 300))
    return start, end, fade_in, fade_out


def concat_clips(files, out_path, cancel_event=None):
    """拼接为单个 mp3（片段本身已有淡入淡出）。"""
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        for p in files:
            # concat demuxer 的引号语法：路径里的单引号要转义成 '\''
            safe_path = os.path.abspath(p).replace("'", "'\\''")
            f.write(f"file '{safe_path}'\n")
        list_path = f.name
    try:
        _run_media(
            [FFMPEG, "-y", "-nostdin", "-loglevel", "error", "-f", "concat", "-safe", "0",
             "-i", list_path, "-codec:a", "libmp3lame", "-b:a", "160k", out_path],
            timeout=300, cancel_event=cancel_event, check=True)
    finally:
        os.unlink(list_path)


SONG_FIELDS = ("song_id, title, artist, word_timeline, file_hash, mixsongid, duration_ms")


def _select_occurrences(conn, word, per_song, max_segments, only_ids=None, check_cancel=None,
                        before=10, after=10):
    """选歌：返回 [(song, 排好序的候选 [(score, occ, window)], 想要段数)]。

    每首按 _rank_candidates 打分择优；真正取哪几处在拿到音频时长后
    （process_song 里）决定，以便跳过超出试听音频的候选。
    only_ids 给定时按给定顺序只处理这些歌；max_segments 为总段数上限（None 不封顶）。
    """
    if only_ids is not None:
        rows = (conn.execute(
            f"SELECT {SONG_FIELDS} FROM songs WHERE song_id=? AND lyric_type='krc'",
            (sid,)).fetchone() for sid in only_ids)
    else:
        rows = conn.execute(f"SELECT {SONG_FIELDS} FROM songs WHERE lyric_type='krc' ORDER BY title")
    picked, total = [], 0
    for r in rows:
        if check_cancel:
            check_cancel()
        if not r:
            continue
        occ = kg_store.find_occurrences(r["word_timeline"], word)
        if not occ:
            continue
        try:
            tl = json.loads(r["word_timeline"])
        except (TypeError, ValueError):
            continue
        cands = _rank_candidates(tl, occ, before * 1000, after * 1000)
        if not cands:
            continue
        want = max(1, per_song)
        if max_segments is not None:
            want = min(want, max_segments - total)
            if want <= 0:
                break
        picked.append((dict(r), cands, want))
        total += want
        if max_segments is not None and total >= max_segments:
            break
    return picked


def preview_word(word):
    """列出歌词含该词的全部候选歌（制作弹窗预览用，字段够前端展示即可）。

    不设数量上限：候选有多少给多少，挑歌由用户在弹窗里完成。
    """
    conn = sqlite3.connect(kg_store.DEFAULT_DB)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT song_id, title, artist, word_timeline FROM songs "
            "WHERE lyric_type='krc' ORDER BY title").fetchall()
        out = []
        for r in rows:
            occ = kg_store.find_occurrences(r["word_timeline"], word)
            if not occ:
                continue
            out.append({"song_id": r["song_id"], "title": r["title"],
                        "artist": r["artist"], "occurrences": len(occ)})
        return out
    finally:
        conn.close()


def song_word_occurrences(song_id, word):
    """弹窗里「自定义添加」时的校验：这首歌词里有没有该词、出现在几处。"""
    conn = sqlite3.connect(kg_store.DEFAULT_DB)
    conn.row_factory = sqlite3.Row
    try:
        r = conn.execute(
            "SELECT song_id, title, artist, word_timeline FROM songs "
            "WHERE song_id=? AND lyric_type='krc'", (song_id,)).fetchone()
        if not r:
            return None
        occ = kg_store.find_occurrences(r["word_timeline"], word)
        return {"song_id": r["song_id"], "title": r["title"],
                "artist": r["artist"], "occurrences": len(occ)}
    finally:
        conn.close()


def song_clip_window(song_id, word, before=10, after=10):
    """弹窗试听：按制作选段规则算出这首歌会被选中的最佳片段窗口（毫秒）。

    与 build_mashup per_song=1 一致，使用 _rank_candidates 选出最高分候选。
    没有可用片段返回 None。
    """
    conn = sqlite3.connect(kg_store.DEFAULT_DB)
    conn.row_factory = sqlite3.Row
    try:
        r = conn.execute(
            "SELECT word_timeline FROM songs WHERE song_id=? AND lyric_type='krc'",
            (song_id,)).fetchone()
    finally:
        conn.close()
    if not r or not r["word_timeline"]:
        return None
    try:
        tl = json.loads(r["word_timeline"])
    except (TypeError, ValueError):
        return None
    occ = kg_store.find_occurrences(r["word_timeline"], word)
    if not occ:
        return None
    cands = _rank_candidates(tl, occ, before * 1000, after * 1000)
    if not cands:
        return None
    w = cands[0][2]
    return {"start_ms": w["start"], "end_ms": w["end"]}


def _segment_lines(timeline, clip_start, clip_end):
    """取窗口内歌词行，时间平移为片段内相对毫秒（制作信息行不展示）。

    逐字时间也要夹在片段内：窗口切在一句中间时，句首那些已经唱完的字
    不能留下负时间，否则舞台会把它们排到开头。
    """
    lines = []
    for ln in timeline["lines"]:
        if ln.get("credit"):
            continue
        if ln["end"] < clip_start or ln["start"] > clip_end:
            continue
        start = max(0, ln["start"] - clip_start)
        end = max(start, min(clip_end, ln["end"]) - clip_start)
        words = []
        for w in (ln.get("words") or []):
            word_start = max(0, w["s"] - clip_start)
            word_end = min(clip_end, w["e"]) - clip_start
            if word_end <= 0:
                continue
            words.append({"t": w["t"], "s": word_start, "e": max(word_start, word_end)})
        lines.append({
            "start": start,
            "end": end,
            "text": ln["text"],
            "words": words or None,
        })
    return lines


def build_mashup(word, before=10, after=10, per_song=1, max_segments=None,
                 quality=320, join=True, sleep_s=1.0, progress=None, song_ids=None,
                 *, workers=1, cancel_event=None, publish=None):
    """制作选中的歌曲，按选歌顺序输出。网页可并行处理并在发布前取消。"""
    if not FFMPEG or not FFPROBE:
        raise MashupError("未找到 ffmpeg/ffprobe，请先安装（winget install Gyan.FFmpeg）")

    def check_cancel():
        if cancel_event is not None and cancel_event.is_set():
            raise MashupCancelled()

    conn = sqlite3.connect(kg_store.DEFAULT_DB)
    conn.row_factory = sqlite3.Row
    try:
        selection = _select_occurrences(conn, word, per_song, max_segments,
                                        only_ids=song_ids, check_cancel=check_cancel,
                                        before=before, after=after)
    finally:
        conn.close()
    check_cancel()
    if not selection:
        raise MashupError(f"库里没有 KRC 歌词含『{word}』的歌曲")
    n_occ = sum(want for _, _, want in selection)
    print(f"『{word}』：{len(selection)} 首歌 / {n_occ} 处出现，开始制作…")
    _emit(progress, stage="selected", songs=len(selection), occurrences=n_occ)

    client = kg_api.KugouClient(check_cancel=check_cancel) if cancel_event else kg_api.KugouClient()
    if not client.logged_in:
        raise MashupError("未登录，请先运行: py -3 kg_cli.py login")
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_locks = {}
    total = len(selection)
    t0 = time.monotonic()

    def process_song(index, song, cands, want, first_slot, cache_lock):
        check_cancel()
        title, artist = song["title"], song["artist"]
        label = f"{artist} - {title}"
        event = dict(stage="song", index=index, total=total, title=title, artist=artist)
        _emit(progress, **event, status="working")
        segments, skipped = [], []

        def skip(reason):
            skipped.append({"title": title, "artist": artist, "reason": reason})

        cached = os.path.join(CACHE_DIR, f"{song['file_hash']}_{quality}.mp3")
        audio_ms = 0
        try:
            with cache_lock:
                check_cancel()
                if os.path.isfile(cached):
                    audio_ms = probe_duration_ms(cached, cancel_event)
                if audio_ms <= 0:
                    url, note = client.resolve_play_url(song["file_hash"], song["mixsongid"], quality)
                    if url:
                        client.download_file(url, cached, timeout=40 if cancel_event else 60)
                        audio_ms = probe_duration_ms(cached, cancel_event)
                        if audio_ms <= 0:
                            skip("无法读取音频时长（文件可能损坏）")
                    else:
                        skip(note)
        except (kg_api.KgApiError, subprocess.SubprocessError, OSError, ValueError) as e:
            skip(f"下载/解析失败: {e}")

        if audio_ms > 0:
            tl = json.loads(song["word_timeline"])
            chosen, beyond = [], False
            for _score, occ, w in cands:
                if len(chosen) >= want:
                    break
                if occ["start_ms"] >= audio_ms or w["vocal_end"] > audio_ms:
                    beyond = True
                    continue
                if any(w["start"] < c["end"] and c["start"] < w["end"] for _, c in chosen):
                    continue
                chosen.append((occ, w))
            if not chosen:
                skip(f"音频只有 {audio_ms//1000}s，候选乐句都超出（疑似试听片段）" if beyond
                     else "没有能完整截取的乐句")
            chosen.sort(key=lambda x: x[1]["start"])
            for slot, (occ, w) in enumerate(chosen, first_slot):
                check_cancel()
                clip_start, clip_end, fade_in, fade_out = _refine_bounds(cached, w, audio_ms, cancel_event)
                fname = f"seg_{slot:03d}.mp3"
                seg_path = os.path.join(seg_dir, fname)
                try:
                    cut_clip(cached, seg_path, clip_start, clip_end - clip_start, cancel_event,
                             fade_in_ms=fade_in, fade_out_ms=fade_out)
                except subprocess.SubprocessError as e:
                    skip(f"剪辑失败: {e}")
                    continue
                seg_dur = probe_duration_ms(seg_path, cancel_event) or (clip_end - clip_start)
                segments.append({
                    "file": f"segments/{fname}",
                    "song_id": song["song_id"],
                    "title": title, "artist": artist,
                    "clip_start_ms": clip_start, "clip_end_ms": clip_end,
                    "duration_ms": seg_dur,
                    "word_rel_ms": {"start": occ["start_ms"] - clip_start,
                                    "end": occ["end_ms"] - clip_start},
                    "lines": _segment_lines(tl, clip_start, clip_end),
                })

        check_cancel()
        if segments:
            print(f"  [{index}/{total}] {label[:40]} → {len(segments)} 段")
            _emit(progress, **event, status="ok", made=len(segments))
        else:
            reason = skipped[-1]["reason"]
            print(f"  [{index}/{total}] 跳过 {label[:40]}：{reason}")
            _emit(progress, **event, status="skip", reason=reason)
        return segments, skipped

    def process_selection():
        jobs = []
        slot = 1
        for index, (song, cands, want) in enumerate(selection, 1):
            lock = cache_locks.setdefault(song["file_hash"], Lock())
            jobs.append((index, song, cands, want, slot, lock))
            slot += want
        if workers == 1 or total == 1:
            for job in jobs:
                result = process_song(*job)
                yield result
                if result[0] and sleep_s and job[0] < total:
                    if cancel_event:
                        cancel_event.wait(sleep_s)
                    else:
                        time.sleep(sleep_s)
            return
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(process_song, *job): job[0] for job in jobs}
            results = {}
            try:
                for future in as_completed(futures):
                    check_cancel()
                    results[futures[future]] = future.result()
            finally:
                for future in futures:
                    future.cancel()
            yield from (results[index] for index in range(1, total + 1))

    # 先占用目录名，等剪辑和拼接都结束后再原子发布 meta.json。
    stem = _sanitize(word)
    out_dir = os.path.join(MASHUPS_DIR, stem)
    i = 2
    while True:
        check_cancel()
        try:
            os.makedirs(out_dir)
            break
        except FileExistsError:
            out_dir = os.path.join(MASHUPS_DIR, f"{stem}-{i}")
            i += 1

    try:
        seg_dir = os.path.join(out_dir, "segments")
        os.mkdir(seg_dir)
        segments, skipped = [], []
        for song_segments, song_skipped in process_selection():
            segments.extend(song_segments)
            skipped.extend(song_skipped)
        check_cancel()
        if not segments:
            reason = skipped[0]["reason"]
            raise MashupError(f"一个片段都没剪成（{total} 首被跳过）：{reason}")

        joined = None
        if join and len(segments) > 1:
            _emit(progress, stage="joining")
            filename = f"{stem}_串烧.mp3"
            joined_path = os.path.join(out_dir, filename)
            try:
                concat_clips([os.path.join(out_dir, s["file"]) for s in segments], joined_path, cancel_event)
                joined = filename
            except subprocess.SubprocessError as e:
                print(f"拼接失败（片段仍可播放）: {e}")
                if os.path.isfile(joined_path):
                    os.unlink(joined_path)
        check_cancel()
        meta = {
            "id": os.path.basename(out_dir),
            "word": word,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "params": {"before": before, "after": after, "per_song": per_song,
                       "quality": quality},
            "total_ms": sum(s["duration_ms"] for s in segments),
            "segments": segments,
            "skipped": skipped,
            "joined": joined,
        }
        meta_path = os.path.join(out_dir, "meta.json")
        tmp_meta = meta_path + ".tmp"
        with open(tmp_meta, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=1)
            f.flush()
            os.fsync(f.fileno())
        if publish:
            publish(meta, tmp_meta, meta_path)
        else:
            check_cancel()
            os.replace(tmp_meta, meta_path)
    except BaseException:
        shutil.rmtree(out_dir, ignore_errors=True)
        raise

    used = time.monotonic() - t0
    print(f"\n完成：{len(segments)} 段 / 总长 {meta['total_ms']//1000}s / 跳过 {len(skipped)} 首 / 用时 {used:.1f}s")
    print(f"输出目录: {out_dir}")
    if joined:
        print(f"拼接文件: {os.path.join(out_dir, joined)}")
    print("网页控制台 → 『觅字』播放")
    return meta

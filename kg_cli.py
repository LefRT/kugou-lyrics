# -*- coding: utf-8 -*-
"""
酷狗收藏歌词工具 CLI

用法：
  py -3 kg_cli.py login                 扫码登录（手机酷狗App扫一扫）
  py -3 kg_cli.py sync                  拉取"我喜欢"收藏歌曲 + 下载歌词入库
  py -3 kg_cli.py sync --all            拉取全部自建歌单
  py -3 kg_cli.py fetch 周杰伦 晴天      无登录：搜索一首歌并入库（测试用）
  py -3 kg_cli.py search 关键词          查询：歌词含关键词的所有歌曲
  py -3 kg_cli.py timeline 晴天 晴天     查询：某首歌中关键词每次出现的毫秒时间
  py -3 kg_cli.py songs                 列出库内歌曲
"""
import argparse
import json
import os
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
sys.dont_write_bytecode = True

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)

import kg_api
import kg_store

QR_PNG = os.path.join(kg_api.DATA_DIR, "kugou_login_qrcode.png")
LIKED_NAMES = {"我喜欢", "我喜欢的音乐", "默认收藏", "My Favorites"}


# ---------------- login ----------------
def render_qr(url: str):
    import qrcode
    os.makedirs(kg_api.DATA_DIR, exist_ok=True)
    img = qrcode.make(url)
    img.save(QR_PNG)
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    qr.make(fit=True)
    print('┌─ 二维码（也可用手机酷狗App扫屏幕）────────────────', file=sys.stderr)
    qr.print_ascii(invert=True)
    print('└──────────────────────────────────────────────────', file=sys.stderr)
    return QR_PNG


def cmd_login(args):
    client = kg_api.KugouClient()
    if args.token and args.userid:
        client.token, client.userid = args.token, str(args.userid)
        client.save_session()
        print(f"已保存会话：userid={client.userid}")
        return
    for attempt in range(3):
        key = client.qr_create_key()
        url = client.qr_content_url(key)
        png = render_qr(url)
        print(f"\n二维码已生成: {png}")
        print("打开手机酷狗App → 我的 → 右上角『+』/扫一扫，扫描上面二维码（180秒内有效）\n")
        deadline = time.time() + 180
        last = None
        while time.time() < deadline:
            d = client.qr_status(key)
            st = d.get("status")
            if st != last:
                print(f"  [{time.strftime('%H:%M:%S')}] 状态: "
                      f"{ {0:'已过期', 1:'等待扫码', 2:'已扫码，请在手机上确认', 4:'登录成功'}.get(st, st) }")
                last = st
            if st == 4:
                client.token = str(d.get("token") or "")
                client.userid = str(d.get("userid") or "")
                if d.get("dfid"):
                    client.dfid = str(d["dfid"])
                if not client.logged_in:
                    print("  酷狗未返回完整的登录凭据。")
                    return
                client.save_session()
                nick = d.get("nick_name") or d.get("nickname") or ""
                print(f"\n登录成功！userid={client.userid} 昵称={nick}")
                print("会话已保存到 session.json，下一步运行: py -3 kg_cli.py sync")
                return
            if st == 0:
                print("  二维码已过期，重新生成…")
                break
            time.sleep(2)
    print("登录超时/取消。可重新运行 login。")


# ---------------- sync ----------------
def pick_playlists(playlists, args):
    if args.all:
        return playlists
    if args.playlist is not None:
        if not (0 <= args.playlist < len(playlists)):
            sys.exit(f"歌单序号越界：0~{len(playlists) - 1}")
        return [playlists[args.playlist]]
    liked = [p for p in playlists
             if p["name"] in LIKED_NAMES or str(p["listid"]) == "2"]
    return liked


def cmd_sync(args):
    client = kg_api.KugouClient()
    if not client.logged_in:
        sys.exit("未登录。请先运行: py -3 kg_cli.py login")
    playlists = client.user_playlists()
    if not playlists:
        sys.exit("未获取到歌单列表（可用 KG_DEBUG=1 重跑查看原始响应）")
    print(f"共 {len(playlists)} 个歌单：")
    for i, p in enumerate(playlists):
        print(f"  [{i}] {p['name']}  ({p['count']} 首, listid={p['listid']}, gid={p['gid']})")
    chosen = pick_playlists(playlists, args)
    print(f"\n将同步：{'、'.join(p['name'] for p in chosen)}")

    total = krc_n = lrc_n = none_n = skip_n = 0
    for pl in chosen:
        print(f"\n▶ {pl['name']}")
        tracks = client.playlist_tracks(pl["listid"], pl["gid"])
        print(f"  拉取到 {len(tracks)} 首")
        for i, tr in enumerate(tracks, 1):
            total += 1
            song_id = tr["mixsongid"] or tr["hash"]
            label = f"{tr['artist']} - {tr['title']}"
            existing = kg_store.find_song(args.db, song_id)
            if existing and not args.force and existing[0]["lyric_type"] in ("krc", "lrc"):
                skip_n += 1
                continue
            lyr = None
            if tr["hash"]:
                try:
                    lyr = client.fetch_lyrics(
                        tr["hash"], tr["duration_ms"],
                        f"{tr['artist']} - {tr['title']}", tr["mixsongid"] or None,
                        title=tr["title"], artist=tr["artist"])
                except kg_api.KgApiError as e:
                    print(f"  [{i}/{len(tracks)}] {label} 获取失败: {e}")
            if lyr:
                timeline_json = json.dumps(lyr["timeline"], ensure_ascii=False,
                                           separators=(",", ":"))
                kg_store.upsert_song(args.db, {
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
                kg_store.upsert_song(args.db, {
                    "song_id": song_id, "title": tr["title"], "artist": tr["artist"],
                    "lyrics_text": None, "word_timeline": None, "lyric_type": "none",
                    "file_hash": tr["hash"], "duration_ms": tr["duration_ms"],
                    "mixsongid": tr["mixsongid"], "playlist": pl["name"],
                })
            if i % 10 == 0 or i == len(tracks):
                print(f"  [{i}/{len(tracks)}] 完成（逐字 {krc_n} / 行级 {lrc_n} / 无 {none_n} / 跳过 {skip_n}）")
            time.sleep(args.sleep / 1000)
    print(f"\n同步结束：共 {total} 首 | KRC逐字 {krc_n} | LRC {lrc_n} | 无歌词 {none_n} | 已有跳过 {skip_n}")
    print(f"数据库: {os.path.abspath(args.db)}")


# ---------------- fetch（无登录测试入口） ----------------
def cmd_fetch(args):
    client = kg_api.KugouClient()
    kw = " ".join(args.keyword)
    songs = client.search_song(kw, pagesize=8)
    if not songs:
        sys.exit("搜索无结果")
    print("搜索结果：")
    for i, s in enumerate(songs):
        print(f"  [{i}] {s['singers']} - {s['name']} ({s['duration_ms'] // 1000}s)")
    idx = args.index if args.index is not None else 0
    s = songs[idx]
    print(f"\n获取: {s['singers']} - {s['name']}")
    lyr = client.fetch_lyrics(s["hash"], s["duration_ms"],
                              f"{s['singers']} - {s['name']}", s["mixsongid"],
                              title=s["name"], artist=s["singers"])
    if not lyr:
        sys.exit("该歌曲无歌词")
    song_id = str(s["mixsongid"]) if s["mixsongid"] else s["hash"]
    kg_store.upsert_song(args.db, {
        "song_id": song_id, "title": s["name"], "artist": s["singers"],
        "lyrics_text": lyr["text"],
        "word_timeline": json.dumps(lyr["timeline"], ensure_ascii=False, separators=(",", ":")),
        "lyric_type": lyr["type"], "file_hash": s["hash"],
        "duration_ms": s["duration_ms"], "mixsongid": str(s["mixsongid"] or ""),
        "playlist": "手动获取",
    })
    print(f"已入库 [{lyr['type']}] song_id={song_id}")
    print("\n歌词预览：")
    for ln in lyr["text"].splitlines()[:8]:
        print("  ", ln)


# ---------------- 查询 ----------------
def cmd_search(args):
    rows = kg_store.search_lyrics(args.db, args.keyword)
    print(f"歌词包含『{args.keyword}』的歌曲：{len(rows)} 首\n")
    for r in rows:
        print(f"  {r['title']}  —  {r['artist']}   [{r['lyric_type']}]  id={r['song_id']}")


def cmd_timeline(args):
    rows = kg_store.find_song(args.db, args.ref)
    if not rows:
        sys.exit(f"库中找不到：{args.ref}")
    if len(rows) > 1:
        print(f"匹配到 {len(rows)} 首，请用 song_id 精确指定：")
        for r in rows:
            print(f"  {r['title']} — {r['artist']}  [{r['lyric_type']}]  id={r['song_id']}")
        sys.exit(1)
    r = rows[0]
    if not r["word_timeline"]:
        sys.exit(f"『{r['title']}』没有时间轴数据（lyric_type={r['lyric_type']}）")
    occ = kg_store.find_occurrences(r["word_timeline"], args.keyword)
    print(f"『{r['title']}』— {r['artist']}  [{r['lyric_type']}]")
    print(f"关键词『{args.keyword}』共出现 {len(occ)} 次：\n")
    for i, o in enumerate(occ, 1):
        approx = "（行级时间，非逐字精确）" if o["approx"] else ""
        print(f"  第{i:2d}次  {o['start_ms']:>7d} - {o['end_ms']:>7d} ms  "
              f"({kg_store.ms_to_clock(o['start_ms'])} → {kg_store.ms_to_clock(o['end_ms'])}){approx}")
        print(f"          行{o['line']}: {o['text']}")


def cmd_songs(args):
    rows = kg_store.list_songs(args.db)
    total, by_type = kg_store.get_stats(args.db)
    print(f"库内共 {total} 首：{by_type}\n")
    for r in rows:
        print(f"  {r['title']}  —  {r['artist']}   [{r['lyric_type']}]  id={r['song_id']}")


# ---------------- mashup（觅词制作） ----------------
def cmd_mashup(args):
    import kg_mashup
    try:
        kg_mashup.build_mashup(
            word=args.word,
            before=args.before, after=args.after,
            per_song=args.per_song, max_segments=args.max,
            quality=args.quality, join=not args.no_join,
            sleep_s=args.interval / 1000,
        )
    except kg_mashup.MashupError as e:
        sys.exit(str(e))


def main():
    ap = argparse.ArgumentParser(description="酷狗收藏歌词工具")
    ap.add_argument("--db", default=kg_store.DEFAULT_DB, help="SQLite 路径（默认 kugou_lyrics.db）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("login", help="扫码登录")
    p.add_argument("--token", help="手动注入会话 token（兜底用）")
    p.add_argument("--userid", help="手动注入会话 userid")
    p.set_defaults(func=cmd_login)

    p = sub.add_parser("sync", help="拉取收藏/歌单并下载歌词")
    p.add_argument("--all", action="store_true", help="同步全部歌单（默认仅『我喜欢』）")
    p.add_argument("--playlist", type=int, default=None, help="指定歌单序号")
    p.add_argument("--force", action="store_true", help="已有歌词也重新获取")
    p.add_argument("--sleep", type=int, default=250, help="每首歌间隔毫秒（默认250）")
    p.set_defaults(func=cmd_sync)

    p = sub.add_parser("fetch", help="无登录：搜索并入库一首歌")
    p.add_argument("keyword", nargs="+")
    p.add_argument("--index", type=int, default=None)
    p.set_defaults(func=cmd_fetch)

    p = sub.add_parser("search", help="查询歌词含关键词的歌曲")
    p.add_argument("keyword")
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("timeline", help="查询关键词在某首歌中的出现时间")
    p.add_argument("ref", help="歌名/歌手/song_id")
    p.add_argument("keyword")
    p.set_defaults(func=cmd_timeline)

    p = sub.add_parser("songs", help="列出库内歌曲")
    p.set_defaults(func=cmd_songs)

    p = sub.add_parser("mashup", help="觅词：剪辑含该词的片段并连播（原名串烧）")
    p.add_argument("word", help="关键词，如：桥")
    p.add_argument("--before", type=int, default=10, help="词前秒数（默认10）")
    p.add_argument("--after", type=int, default=10, help="词后秒数（默认10）")
    p.add_argument("--per-song", type=int, default=1,
                   help="每首取几处（默认1：多处时取第二处）")
    p.add_argument("--max", type=int, default=60, help="总段数上限（默认60）")
    p.add_argument("--quality", default="320", help="音质 128/320/flac（默认320 高品；flac 需会员且体积大）")
    p.add_argument("--interval", type=int, default=1000, help="每首歌间隔毫秒（默认1000）")
    p.add_argument("--no-join", action="store_true", help="不生成拼接版 mp3")
    p.set_defaults(func=cmd_mashup)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

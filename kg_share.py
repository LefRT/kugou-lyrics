# -*- coding: utf-8 -*-
"""一键生成独立单文件手写水彩歌词分享 HTML。"""

import base64
import html
import json
import os
import re
from functools import lru_cache
from pathlib import Path

BASE = Path(__file__).resolve().parent
TEMPLATE_DIR = BASE / "share_template"
FONTS_DIR = BASE / "web" / "src" / "assets" / "fonts"
PINYIN_PATH = BASE / "data" / "hanzi_pinyin.json"

_STOP_CHARS = set("的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严啊呢吗吧呀哦嘛哈")
_WEAK_CHARS = set("的我你他她它了着过是在有和就都也还要会能把被让给向从到对与及而却但若如只才又再很太更最每这那哪谁什怎啊呢吗吧呀哦嘛")
_HANZI_RE = re.compile(r"[\u4e00-\u9fff]")


@lru_cache(maxsize=1)
def _pinyin_map():
    try:
        with PINYIN_PATH.open(encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


@lru_cache(maxsize=1)
def _template_assets():
    css = (TEMPLATE_DIR / "style.css").read_text(encoding="utf-8")
    art_js = (TEMPLATE_DIR / "art.js").read_text(encoding="utf-8")
    runtime_js = (TEMPLATE_DIR / "runtime.js").read_text(encoding="utf-8")
    en_font_path = FONTS_DIR / "letter-en.otf"
    font_css = ""
    if en_font_path.is_file():
        b64 = base64.b64encode(en_font_path.read_bytes()).decode("ascii")
        font_css = (
            '@font-face {\n'
            '  font-family: "LetterEN";\n'
            f'  src: url("data:font/otf;base64,{b64}") format("opentype");\n'
            '  font-display: swap;\n'
            '}'
        )
    css = css.replace("__EMBED_FONTS__", font_css)
    return css, art_js, runtime_js


def to_pinyin(text):
    """汉字转大写无声调拼音，英文保留字母大写。"""
    pmap = _pinyin_map()
    out = []
    for ch in str(text or ""):
        if ch in pmap:
            out.append(pmap[ch])
        elif "a" <= ch <= "z" or "A" <= ch <= "Z":
            out.append(ch.upper())
    return "".join(out)[:14]


def _split_title(title, artist):
    clean = str(title or "").strip() or "未命名"
    short = re.sub(r"\s*[\(（\[【][^\)）\]】]*[\)）\]】]\s*$", "", clean).strip() or clean
    hanzi = _HANZI_RE.findall(short)
    if len(hanzi) >= 4 and len(short) <= 12:
        cut = (len(short) + 1) // 2
        top_text = short[:cut].strip()
        bot_text = short[cut:].strip()
        return {
            "top": {"text": top_text, "pinyin": to_pinyin(top_text)},
            "bottom": {"text": bot_text, "pinyin": to_pinyin(bot_text)},
        }
    sub = str(artist or "").strip() or short
    return {
        "top": {"text": short[:10], "pinyin": to_pinyin(short[:6])},
        "bottom": {"text": sub[:10], "pinyin": to_pinyin(sub[:6])},
    }


def _extract_unique_lines(song, fav_starts):
    fav_set = {int(s) for s in (fav_starts or ()) if isinstance(s, (int, float))}
    raw_lines = (song.get("timeline") or {}).get("lines") or []
    entries = []
    index_by_key = {}

    if raw_lines:
        for i, ln in enumerate(raw_lines):
            if not isinstance(ln, dict) or ln.get("credit"):
                continue
            text = re.sub(r"\s+", " ", str(ln.get("text") or "")).strip()
            if not text:
                continue
            start = int(ln.get("start") or 0)
            end = int(ln.get("end") or 0)
            if end <= start:
                nxt = raw_lines[i + 1] if i + 1 < len(raw_lines) else None
                nxt_start = int(nxt.get("start") or 0) if isinstance(nxt, dict) else 0
                end = nxt_start if nxt_start > start else start + 4000
            is_fav = any(abs(start - fs) <= 250 for fs in fav_set)
            key = text.lower()
            if key in index_by_key:
                item = entries[index_by_key[key]]
                item["spans"].append([start, end])
                item["faved"] = item["faved"] or is_fav
            else:
                index_by_key[key] = len(entries)
                entries.append({"text": text, "spans": [[start, end]], "faved": is_fav})
    else:
        for raw in str(song.get("lyrics_text") or "").splitlines():
            text = re.sub(r"\s+", " ", raw).strip()
            if not text:
                continue
            key = text.lower()
            if key not in index_by_key:
                index_by_key[key] = len(entries)
                entries.append({"text": text, "spans": [], "faved": False})

    return entries


def _pick_keyword(text):
    """从歌词中挑一个有表现力的 2 字中文词（跳过虚词）。"""
    best = None
    best_score = -1
    for m in re.finditer(r"[\u4e00-\u9fff]{2,}", text):
        seg = m.group(0)
        for i in range(len(seg) - 1):
            pair = seg[i:i + 2]
            if pair[0] in _WEAK_CHARS or pair[1] in _WEAK_CHARS:
                continue
            score = 2
            if pair[0] not in _STOP_CHARS:
                score += 2
            if pair[1] not in _STOP_CHARS:
                score += 2
            # 靠后半句的词通常更有画面感
            if m.start() + i >= len(text) // 3:
                score += 1
            if score > best_score:
                best_score = score
                best = (m.start() + i, m.start() + i + 2, pair)
    return best


def _decorate_line(entry, *, rot=-1.0, indent="", with_kw=False, py_mode=None):
    text = entry["text"]
    tokens = [text]
    picked_kw = None
    if with_kw:
        hit = _pick_keyword(text)
        if hit:
            s, e, kw = hit
            picked_kw = kw
            py = to_pinyin(kw)
            before, after = text[:s], text[e:]
            tokens = []
            if before:
                tokens.append(before)
            if py_mode in ("above", "below") and py:
                tokens.append({"kw": kw, "py": py, "pos": py_mode, "rot": -2 if rot < -1.0 else 2})
            else:
                tokens.append({"kw": kw, "rot": -2 if rot < -1.0 else 2})
                if py_mode == "inline" and py:
                    tokens.append({"py": py})
            if after:
                tokens.append(after)
    spec = {"spans": entry["spans"], "faved": entry["faved"], "rot": rot, "tokens": tokens}
    if indent:
        spec["indent"] = indent
    return spec, picked_kw


def _distribute(entries):
    """按参考图 5 段比例自动把整首歌排进左右两栏。"""
    n = len(entries)
    if n <= 5:
        return entries, [], [], [], []
    # 目标比例：leftMid 30%, leftBottom 17%, rightTop 17%, rightMid 18%, rightBottom 18%
    c_lm = max(2, round(n * 0.30))
    c_lb = max(2, min(4, round(n * 0.17)))
    c_rt = max(2, min(5, round(n * 0.17)))
    c_rm = max(2, round(n * 0.18))
    used = c_lm + c_lb + c_rt + c_rm
    if used >= n:
        c_rm = max(1, c_rm - (used - n + 1))
    i1 = min(n, c_lm)
    i2 = min(n, i1 + c_lb)
    i3 = min(n, i2 + c_rt)
    i4 = min(n, i3 + c_rm)
    return entries[:i1], entries[i1:i2], entries[i2:i3], entries[i3:i4], entries[i4:]


def _build_stanza(entries, *, indents, kw_slots):
    rots = (-1.3, -1.0, -1.2, -0.9, -1.1, -0.8)
    out = []
    for i, entry in enumerate(entries):
        rot = rots[i % len(rots)]
        indent = indents[i % len(indents)] if indents else ""
        py_mode = kw_slots.get(i)
        with_kw = py_mode is not None
        spec, _ = _decorate_line(entry, rot=rot, indent=indent, with_kw=with_kw, py_mode=py_mode)
        out.append(spec)
    return out


def _compute_layout(entries):
    n = max(1, len(entries))
    max_len = max((len(e["text"]) for e in entries), default=10)
    # 兼顾行数与单行字数，保证任何歌曲都舒适地落在 3:4 宣纸卡片内
    size_by_lines = 3.25 if n <= 20 else max(2.15, 3.25 - (n - 20) * 0.055)
    size_by_width = 3.25 if max_len <= 13 else max(2.05, 42.0 / max_len)
    line_size = round(min(size_by_lines, size_by_width), 2)
    stanza_gap = round(max(0.32, 0.85 - max(0, n - 18) * 0.025), 2)
    block_gap = round(max(1.8, 4.6 - max(0, n - 20) * 0.16), 2)
    return {
        "lineSize": f"{line_size}cqw",
        "stanzaGap": f"{stanza_gap}cqw",
        "blockGap": f"{block_gap}cqw",
    }


def build_share_data(song, fav_starts=(), audio_data_uri=""):
    entries = _extract_unique_lines(song, fav_starts)
    # 超过 36 句唯一歌词时优先保留收藏句并等距抽样，避免卡片溢出
    if len(entries) > 36:
        fav_idx = {i for i, e in enumerate(entries) if e["faved"]}
        keep = set(fav_idx)
        step = len(entries) / 36.0
        idx = 0.0
        while len(keep) < 36 and int(idx) < len(entries):
            keep.add(int(idx))
            idx += step
        entries = [entries[i] for i in sorted(keep)[:36]]

    lm, lb, rt, rm, rb = _distribute(entries)

    left_mid = _build_stanza(
        lm,
        indents=("",),
        kw_slots={0: "none", 2: "inline", max(0, len(lm) - 1): "below"} if lm else {},
    )

    left_bottom_lines = _build_stanza(lb, indents=("",), kw_slots={})
    floating = None
    if lb:
        anchor = next((e for e in reversed(lb) if e["faved"]), lb[-1])
        hit = _pick_keyword(anchor["text"])
        if hit:
            kw = hit[2]
            floating = {"kw": kw, "py": to_pinyin(kw), "spans": anchor["spans"], "faved": anchor["faved"]}

    right_top = _build_stanza(
        rt,
        indents=("", "3%", "1%", "5%"),
        kw_slots={0: "inline", 1: "inline"} if rt else {},
    )
    right_mid = _build_stanza(
        rm,
        indents=("", "8%", "5%", "11%", "3%"),
        kw_slots={0: "none", max(0, len(rm) - 2): "above"} if rm else {},
    )
    right_bottom = _build_stanza(
        rb,
        indents=("3%", "", "2%", "1%", "4%", "2%"),
        kw_slots={0: "inline", 2: "inline", max(0, len(rb) - 1): "below"} if rb else {},
    )

    return {
        "audioSrc": audio_data_uri,
        "title": _split_title(song.get("title"), song.get("artist")),
        "layout": _compute_layout(entries),
        "leftMid": left_mid,
        "leftBottom": {"lines": left_bottom_lines, "floating": floating},
        "rightTop": right_top,
        "rightMid": right_mid,
        "rightBottom": right_bottom,
    }


def build_share_html(song, fav_starts=(), audio_bytes=b"", audio_mime="audio/mpeg"):
    """返回完整独立单文件 HTML（UTF-8 字符串）。"""
    css, art_js, runtime_js = _template_assets()
    audio_uri = (
        f"data:{audio_mime};base64,{base64.b64encode(audio_bytes).decode('ascii')}"
        if audio_bytes else ""
    )
    data = build_share_data(song, fav_starts=fav_starts, audio_data_uri=audio_uri)
    safe_json = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    page_title = html.escape(f"{song.get('title') or '歌词'} · 歌词分享")

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{page_title}</title>
  <style>
{css}
  </style>
</head>
<body>
  <svg class="svg-defs" aria-hidden="true">
    <defs>
      <filter id="ink-bleed" x="-4%" y="-4%" width="108%" height="108%">
        <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="2" seed="7" result="noise"/>
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.9" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
    </defs>
  </svg>
  <main class="desk">
    <article class="card" id="share-card" aria-label="手写水彩歌词分享卡">
      <canvas class="art-layer" id="art-canvas" aria-hidden="true"></canvas>
      <div class="paper-grain" aria-hidden="true"></div>
      <div class="sheet">
        <section class="col col--left">
          <header class="hero" id="hero-title"></header>
          <div class="player-bar" aria-label="播放控制">
            <div class="progress-rail" id="progress-rail">
              <span class="progress-fill" id="progress-fill"></span>
              <span class="progress-dot" id="progress-dot"></span>
            </div>
            <div class="player-controls">
              <button class="ctrl" id="btn-loop" type="button" aria-label="单曲循环" aria-pressed="false">
                <svg viewBox="0 0 28 18"><path d="M5 6h14a4 4 0 0 1 0 8H8a4 4 0 0 1-3-6.6M16 3l3.5 3L16 9" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button class="ctrl" id="btn-prev" type="button" aria-label="上一句">
                <svg viewBox="0 0 20 18"><path d="M4.5 4v10M15.5 4.2 7.5 9l8 4.8z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
              </button>
              <button class="ctrl ctrl--play" id="btn-play" type="button" aria-label="播放或暂停" aria-pressed="false">
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="1.4"/>
                  <g class="icon-pause"><path d="M9.6 8.3v7.4M14.4 8.3v7.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></g>
                  <g class="icon-play"><path d="M10.2 8.2 16.4 12l-6.2 3.8z" fill="currentColor"/></g>
                </svg>
              </button>
              <button class="ctrl" id="btn-next" type="button" aria-label="下一句">
                <svg viewBox="0 0 20 18"><path d="M15.5 4v10M4.5 4.2 12.5 9l-8 4.8z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
              </button>
              <button class="ctrl" id="btn-reset" type="button" aria-label="重头播放">
                <svg viewBox="0 0 24 18"><path d="M3 4.5h18M3 9h18M3 13.5h18" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg>
              </button>
            </div>
          </div>
          <div class="stanza stanza--left-mid" id="stanza-left-mid"></div>
          <div class="stanza stanza--left-bottom" id="stanza-left-bottom"></div>
        </section>
        <section class="col col--right">
          <div class="stanza stanza--right-top" id="stanza-right-top"></div>
          <div class="stanza stanza--right-mid" id="stanza-right-mid"></div>
          <div class="stanza stanza--right-bottom" id="stanza-right-bottom"></div>
        </section>
      </div>
    </article>
  </main>
  <script>window.__SHARE_DATA__ = {safe_json};</script>
  <script>
{art_js}
  </script>
  <script>
{runtime_js}
  </script>
</body>
</html>
"""

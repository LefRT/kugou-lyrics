# -*- coding: utf-8 -*-
"""
KRC 解密与解析 / LRC 解析，输出统一的时间轴结构。

KRC 解密参考：chthollyphile/folia-major src/services/onlineMusic/kugou/krcDecrypt.ts
（跳过 "krc1" 头后与 16 字节密钥 XOR，再 zlib 解压；此处额外保留传统 32 字节密钥作兜底）
"""
import re
import zlib

# folia-major krcDecrypt.ts 的 16 字节密钥
FOLIA_KEY = bytes([64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105])
# 传统开源工具常用的 32 字节密钥（历史上另一种编码变体）
CLASSIC_KEY = bytes([64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 178, 208, 183,
                     201, 207, 187, 60, 176, 175, 178, 187, 109, 176, 219, 42, 246, 11, 146, 39])

KRC_HEADER = b"krc1"

_KRC_LINE_RE = re.compile(r"^\[(\d+),(\d+)\](.*)$")
_KRC_WORD_RE = re.compile(r"<(\d+),(\d+),\d+(?:,\d+)?>([^<\r\n]*)")
# 只有时间标签、没有字的情况（如整行就是 <0,917,0>）：去掉标签后应当判为空行
_KRC_TAG_RE = re.compile(r"<[^>]*>")
_LRC_META_RE = re.compile(r"^\[(\w+):([^\]]*)\]\s*$")
_LRC_TIME_RE = re.compile(r"\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]")


class KrcDecryptError(ValueError):
    pass


def decrypt_krc(raw: bytes) -> str:
    """解密 KRC 字节流为明文 KRC 文本。"""
    if raw[:4] != KRC_HEADER:
        raise KrcDecryptError("不是有效的 KRC 数据（缺少 krc1 头）")
    body = raw[4:]
    last_err = None
    for key in (FOLIA_KEY, CLASSIC_KEY):
        dec = bytes(b ^ key[i % len(key)] for i, b in enumerate(body))
        try:
            return zlib.decompress(dec).decode("utf-8", "replace")
        except zlib.error as e:  # 密钥不对时 zlib 头校验失败
            last_err = e
    raise KrcDecryptError(f"KRC 解密失败（两种密钥均无法解压）: {last_err}")


def _split_words(start_ms: int, end_ms: int, text: str):
    """把一个时间组（可能是多字符，如英文单词）按字符数均分成逐字时间条目。"""
    n = len(text)
    if n == 0:
        return []
    if n == 1:
        return [{"t": text, "s": start_ms, "e": end_ms}]
    per = (end_ms - start_ms) / n
    bounds = [start_ms + round(per * i) for i in range(n + 1)]
    bounds[0], bounds[-1] = start_ms, end_ms
    return [{"t": ch, "s": bounds[i], "e": bounds[i + 1]} for i, ch in enumerate(text)]


def parse_krc(text: str) -> dict:
    """解析明文 KRC 文本为统一时间轴。

    返回 {"type": "krc", "meta": {...}, "lines": [
        {"start": ms, "end": ms, "text": "整行文本",
         "words": [{"t": 字, "s": 起毫秒, "e": 止毫秒}, ...] | None}]}
    """
    meta, lines = {}, []
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        m = _KRC_LINE_RE.match(line)
        if not m:
            mm = re.match(r"^\[(\w+):(.*)\]$", line)
            if mm:
                meta[mm.group(1).lower()] = mm.group(2).strip()
            continue
        start, dur = int(m.group(1)), int(m.group(2))
        rest = m.group(3)
        words = []
        for w in _KRC_WORD_RE.finditer(rest):
            words.extend(_split_words(start + int(w.group(1)),
                                      start + int(w.group(1)) + int(w.group(2)),
                                      w.group(3)))
        plain = "".join(w["t"] for w in words) if words else _KRC_TAG_RE.sub("", rest).strip()
        if not plain:
            # 整行只有时间标签（<0,917,0>）或空白：不成词，别塞进时间轴当一行歌词
            continue
        lines.append({
            "start": start,
            "end": start + dur,
            "text": plain,
            "words": words or None,
        })
    return {"type": "krc", "meta": meta, "lines": lines}


def parse_lrc(text: str) -> dict:
    """解析 LRC 文本为统一时间轴（行级时间，words 为 None）。"""
    meta, entries = {}, []
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        mm = _LRC_META_RE.match(line)
        if mm:
            meta[mm.group(1).lower()] = mm.group(2).strip()
            continue
        times, pos = [], 0
        while True:
            m = _LRC_TIME_RE.match(line, pos)
            if not m:
                break
            mm_, ss, frac = int(m.group(1)), int(m.group(2)), m.group(3)
            frac_ms = int(frac) * (10 ** (3 - len(frac))) if frac else 0
            times.append(mm_ * 60000 + ss * 1000 + frac_ms)
            pos = m.end()
        if not times:
            continue
        content = line[pos:].strip()
        for t in times:
            entries.append((t, content))
    entries.sort(key=lambda x: x[0])
    lines = []
    for i, (t, content) in enumerate(entries):
        end = entries[i + 1][0] if i + 1 < len(entries) else t + 5000
        lines.append({"start": t, "end": end, "text": content, "words": None})
    return {"type": "lrc", "meta": meta, "lines": lines}


def timeline_to_plain_text(timeline: dict) -> str:
    """从时间轴提取纯文本歌词（跳过空行与制作信息行）。"""
    lines = timeline.get("lines") or []
    if not isinstance(lines, list):
        return ""
    return "\n".join(ln["text"] for ln in lines
                     if isinstance(ln, dict) and ln.get("text") and not ln.get("credit"))


def looks_like_krc(raw: bytes) -> bool:
    return raw[:4] == KRC_HEADER


# ---------------- 制作信息（staff/版权）行识别 ----------------
# 这类行不算歌词：匹配、串烧选段、正文展示都应排除。
_CREDIT_KEYWORDS = (
    "词", "曲", "词曲", "作词", "作曲", "编曲", "改编词", "改编曲", "填词", "谱曲",
    "监制", "音乐监制", "制作人", "统筹", "企划", "宣传", "出版", "发行", "出品",
    "出品人", "鸣谢", "特别鸣谢", "感谢", "和声", "和声编写", "和音", "合声",
    "合声编写", "合唱", "伴唱", "主唱", "演唱", "录音", "录音师", "录音棚",
    "混音", "缩混", "母带", "吉他", "贝斯", "贝司", "鼓", "键盘", "弦乐", "钢琴",
    "小提琴", "大提琴", "笛", "箫", "二胡", "古筝", "琵琶", "管乐", "打击乐",
    "乐队", "乐团", "指挥", "封面", "插画", "设计", "摄影", "书法", "题字",
    "MV", "视频", "字幕", "文案", "调音", "音响", "灯光", "OP", "SP", "原曲",
    "原唱", "版权", "唱片公司", "经纪公司", "营销", "市场", "企宣", "策划",
    "编剧", "调校", "混音师", "词曲作者",
)

_CREDIT_EN_RE = re.compile(
    r"^(lyrics?|lyricist|composed?|composer|produced?|producer|arranged?|"
    r"arrangement|written|mixed|recorded|mastered|vocal|vocals|guitar|bass|"
    r"drums?|keyboard|strings|piano|op|sp)\b[\w\s.×·/(&)\-]*[:：]",
    re.IGNORECASE)

_CREDIT_CONTAINS_RE = re.compile(
    r"(歌词.*(编辑|制作|上传|提供|校对|翻译|分配)|版权所有|翻录必究|"
    r"unauthorized|未经许可|著作权|翻录|"
    r"^(制作人|出品人|唱片公司|经纪公司)\s*[:：]|"
    r"听歌就在|星曜计划|酷狗音乐|酷狗|酷我音乐|QQ音乐|网易云音乐|"
    r"翻唱请注明|欢迎收听|"
    # 平台声明/授权提示（『此版本为正式授权翻唱作品』）
    r"正式授权|授权翻唱|翻唱作品|此版本为|本歌词(由|转|来自)|歌词制作|歌词提供|"
    # 酷狗词曲激励之类的站内广告语（『让好声音遇见好词曲』『重磅词曲激励，马上了解』）
    r"好词曲|词曲激励|词曲大赛|扫码|公众号)")

# 角色行：短前缀 + 冒号（『男：』『女：』『音频编辑：刘云鹏』『推广执行：…』『哎呐：…』）
# 前缀带断句/引号的按歌词算；『我说：』这类人称起头的也放过。
_ROLE_LINE_RE = re.compile(r"^\s*([^：:]{1,10})[：:]")
_ROLE_STOP = ("我", "你", "他", "她", "它", "这", "那", "谁", "什么", "为何",
              "为什么", "如果", "但是", "可是", "于是", "所以", "他说", "她说",
              "我说", "你说")

# 中英混排的职员行（『录音师 Recording Engineer：…』『混音&母带Mixed&Mastered by：…』）
# 前缀可能超过 10 个字符，但里面一定带一个明确的制作岗位词，才判为 credit。
_ROLE_BROAD_RE = re.compile(r"^\s*([^：:]{1,80})[：:]")
_ROLE_CREDIT_HINTS = (
    "制作人", "配唱", "监棚", "录音", "混音", "缩混", "母带", "后期", "编曲",
    "作词", "作曲", "监制", "统筹", "企划", "宣传", "发行", "出品", "和声",
    "吉他", "贝斯", "贝司", "弦乐", "钢琴", "鼓录音", "人声", "立体声", "全景声",
    "音乐制作", "制作统筹", "推广执行",
)
# 顿号/斜杠/& 常用来并列岗位与乐器（『铜管、弦乐录音师』），不算句子标点
_ROLE_SENTENCE_PUNCT = re.compile(r"[，,。！!？?；;…~～\"“”『』「」]")


def _looks_credit_role(text: str) -> bool:
    """长职员前缀（中英混排）也识别，避免『配唱制作人Vocal Producer：』漏网。"""
    m = _ROLE_BROAD_RE.match(text)
    if not m:
        return False
    head = m.group(1).strip()
    if not head or head.startswith(_ROLE_STOP):
        return False
    if _ROLE_SENTENCE_PUNCT.search(head):
        return False
    return any(hint in head for hint in _ROLE_CREDIT_HINTS)


def _looks_role_line(text: str) -> bool:
    m = _ROLE_LINE_RE.match(text)
    if not m:
        return False
    head = m.group(1).strip()
    if not head:
        return True
    if head.startswith(_ROLE_STOP):
        return False
    if re.search(r"[，,。！!？?；;、…~～\"“”『』「」]", head):
        return False
    return True


def _has_title_artist(text: str, title: str, artist: str) -> bool:
    """形如『晴天 - 周杰伦 (Jay Chou)』的首行歌名行。"""
    if not title or not artist or len(text) > 60:
        return False
    t, a = title.strip(), artist.strip()
    if not t or not a:
        return False
    main = text.split("(")[0]
    if t not in main:
        return False
    # 歌手写法常不一致（DB『老狼、王婧』vs 歌词『老狼/王婧』）：按分隔符拆开，命中任一即算
    parts = [p for p in re.split(r"[、/／,，&＆;\s]+", a) if len(p) >= 2]
    if not parts:
        return a in main
    return any(p in main for p in parts)


def has_word_text(text: str) -> bool:
    """行内是否真含文字：`<0,917,0>`、`...`、`——` 这类纯标签/纯符号不算歌词。"""
    return bool(re.search(r"[^\W\d_]", text or ""))


def is_credit_line(text: str, title: str = "", artist: str = "",
                   first_lines: bool = False) -> bool:
    """判断一行歌词文本是否为制作信息/版权行。

    title/artist 传入时，前几行中『歌名 - 歌手』样式的行也算制作信息。
    """
    text = (text or "").strip()
    if not text:
        return False
    if not has_word_text(text):
        return True
    if _CREDIT_CONTAINS_RE.search(text):
        return True
    if first_lines and _has_title_artist(text, title, artist):
        return True
    # 长职员行（中英混排、超 60 字）靠岗位词识别；其余短行规则再往下走
    if _looks_credit_role(text):
        return True
    if len(text) > 60:
        return False
    # 中文关键词前缀 + 22 字符内出现冒号（兼容『制作人 Producer：xxx』『词Lyricist：xxx』混排）
    head = text[:22]
    if "：" in head or ":" in head:
        for kw in _CREDIT_KEYWORDS:
            if text.startswith(kw):
                return True
    if _CREDIT_EN_RE.match(text):
        return True
    if _looks_role_line(text):
        return True
    return False


def mark_credit_lines(timeline: dict, title: str = "", artist: str = ""):
    """给时间轴中制作信息行打 credit 标记（就地修改）。

    歌名行只在前 4 行内识别，避免误伤正文中提到歌名/歌手的句子。
    """
    lines = timeline.get("lines") or []
    meta = timeline.get("meta") or {}
    if not isinstance(lines, list):
        return timeline
    if not isinstance(meta, dict):
        meta = {}
    title = title or meta.get("ti") or ""
    artist = artist or meta.get("ar") or ""
    for i, ln in enumerate(lines):
        if not isinstance(ln, dict):
            continue
        ln["credit"] = is_credit_line(ln.get("text") or "", title, artist,
                                      first_lines=i < 4)
    return timeline

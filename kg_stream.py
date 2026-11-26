# -*- coding: utf-8 -*-
"""歌曲播放流：多 CDN 节点并行竞速 + 断点续传 + 失效链接刷新 + 音质回退。

对齐听歌软件的行为：
- 酷狗同一档音质下发多条 CDN 直链，并行连接、谁先响应走谁，坏节点不再拖慢起播；
- 建连与正文读超时分离，国内慢节点不误杀，真卡死时切节点续传；
- 严格遵守有界 Range（bytes=start-end），不会把超出请求区间的字节写进响应；
- 最高档（如 flac）全部节点不可达时自动回退到 320k / 128k，确保能播；
- 直链分钟级过期，遇 401/403/404/410 刷新一次链接再竞速；
- 正文完整且 magic 正确才落盘缓存（kg_playback.AudioCache 负责）。
"""

import re
import threading
import time
import urllib.parse
import urllib.request
from http.client import HTTPException
from urllib.error import HTTPError

import kg_api
import kg_playback

CONNECT_TIMEOUT = 10
READ_TIMEOUT = 15
MAX_RESUMES = 6
SLOW_WINDOW_SECONDS = 6.0
SLOW_MIN_BPS = 64 * 1024
SLOW_MIN_REMAINING = 512 * 1024
_FALLBACK_QUALITIES = tuple(kg_api.KugouClient.PLAY_QUALITY_CHAIN[1:])
_CONTENT_RANGE = re.compile(r"bytes (\d+)-(\d+)/(\d+)")
_EXPIRED_CODES = (401, 403, 404, 410)
_BAD_CONTENT_TYPES = ("text/", "application/json", "application/xml", "application/xhtml")


class StreamUnavailable(Exception):
    """拿不到可用音频流，message 可直接展示给用户。"""

    def __init__(self, message, *, expired=False, not_found=False):
        super().__init__(message)
        self.expired = expired
        self.not_found = not_found


def _content_range_parts(response):
    """206 响应的 (起始偏移, 结束偏移含, 总长)；非 206 或头不合法返回 None。"""
    if response.status == 206:
        matched = _CONTENT_RANGE.fullmatch(response.headers.get("Content-Range", ""))
        if matched:
            start, end, total = int(matched.group(1)), int(matched.group(2)), int(matched.group(3))
            if 0 <= start <= end < total:
                return start, end, total
    return None


def range_of(response):
    """206 响应的 (起始偏移, 总长)；非 206 或头不合法返回 None。"""
    parts = _content_range_parts(response)
    return (parts[0], parts[2]) if parts else None


def end_of(response):
    """本次响应应当发送到的结束偏移（不含）；未知长度返回 None。"""
    parts = _content_range_parts(response)
    if parts:
        return parts[1] + 1
    if response.status == 200 and not response.headers.get("Transfer-Encoding"):
        declared = response.headers.get("Content-Length", "")
        if re.fullmatch(r"[0-9]{1,9}", declared):
            return int(declared)
    return None


def total_of(response):
    parts = _content_range_parts(response)
    if parts:
        return parts[2]
    if response.status == 200 and not response.headers.get("Transfer-Encoding"):
        declared = response.headers.get("Content-Length", "")
        if re.fullmatch(r"[0-9]{1,9}", declared):
            return int(declared)
    return None


def _is_valid_audio_response(response):
    if response.status == 416:
        return True
    if response.status not in (200, 206):
        return False
    content_type = (response.headers.get("Content-Type") or "").lower().strip()
    if content_type.startswith(_BAD_CONTENT_TYPES):
        return False
    return True


def _apply_read_timeout(response, timeout):
    """建连完成后放宽正文读超时，减少慢链路误触发断流。"""
    try:
        sock = getattr(getattr(response, "fp", None), "raw", None)
        sock = getattr(sock, "_sock", None)
        if sock is not None:
            sock.settimeout(timeout)
    except OSError:
        pass


def _race(urls, headers):
    """并行连接所有候选节点，返回最先成功者的 (response, url)。"""
    lock = threading.Lock()
    state = {"winner": None, "pending": len(urls), "errors": [], "abandoned": False}
    done = threading.Event()

    def attempt(url):
        try:
            response = urllib.request.urlopen(
                urllib.request.Request(url, headers=headers), timeout=CONNECT_TIMEOUT)
        except HTTPError as error:
            if error.code == 416:  # 越界 seek 是合法应答，交给上层回 416
                response = error
            else:
                with lock:
                    state["errors"].append((url, error))
                    state["pending"] -= 1
                    if state["pending"] == 0:
                        done.set()
                return
        except Exception as error:  # noqa: BLE001 - 任何连接层失败都算该节点落选
            with lock:
                state["errors"].append((url, error))
                state["pending"] -= 1
                if state["pending"] == 0:
                    done.set()
            return
        if not _is_valid_audio_response(response):
            response.close()
            with lock:
                state["errors"].append((url, ValueError("非音频响应")))
                state["pending"] -= 1
                if state["pending"] == 0:
                    done.set()
            return
        with lock:
            if state["winner"] is not None or state["abandoned"]:
                response.close()
                return
            _apply_read_timeout(response, min(READ_TIMEOUT, CONNECT_TIMEOUT * 1.5))
            state["winner"] = (response, url)
            done.set()

    for url in urls:
        threading.Thread(target=attempt, args=(url,), daemon=True).start()
    if not done.wait(CONNECT_TIMEOUT + 3):
        with lock:
            state["abandoned"] = True
    with lock:
        winner, errors = state["winner"], list(state["errors"])
    if winner:
        return winner
    expired = False
    for url, error in errors:
        if isinstance(error, HTTPError):
            error.close()
            expired = expired or error.code in _EXPIRED_CODES
        else:
            kg_api.note_unreachable(url)
    if expired:
        raise StreamUnavailable("酷狗播放链接已过期，正在刷新。", expired=True)
    raise StreamUnavailable("暂时连不上酷狗音频服务，请重试。")


def _prioritize_urls(urls):
    """按节点健康度排序，保留全部候选但把近期失败节点排在后面。"""
    now = time.monotonic()
    penalty = getattr(kg_api, "_HOST_PENALTY", {})
    healthy = [u for u in urls
               if penalty.get(urllib.parse.urlsplit(u).hostname or "", 0) <= now]
    return healthy + [u for u in urls if u not in healthy]


class SongStream:
    """一次播放请求的上游流：竞速开流 + 音质回退 + 正文续传迭代器。"""

    def __init__(self, client, source, links, headers):
        self._client = client
        self._source = source
        self._links = links
        self._headers = headers
        self._quality = None
        self._urls = self._resolve()
        if not self._urls:
            raise StreamUnavailable("酷狗暂时未提供这首歌的播放地址。", not_found=True)
        try:
            self.response, self.url = self._open(headers)
        except StreamUnavailable as first_error:
            fallback = self._open_fallback_quality(headers)
            if fallback is None:
                raise first_error
            self.response, self.url = fallback
        parts = _content_range_parts(self.response)
        self.offset = parts[0] if parts else 0
        self.end = end_of(self.response)
        self.total = total_of(self.response)

    def _cache_key(self, quality=None):
        base = (self._source["file_hash"], self._source["mixsongid"],
                self._client.userid, self._client.token)
        return base if quality is None else (*base, quality)

    def _fetch_candidates(self, quality=None):
        if quality is None:
            result = self._client.play_candidates(self._source["file_hash"],
                                                  self._source["mixsongid"])
        else:
            try:
                result = self._client.play_candidates(self._source["file_hash"],
                                                      self._source["mixsongid"],
                                                      qualities=(quality,))
            except TypeError:
                return []
        return result[0] if result else []

    def _resolve(self, stale_url=None, quality=None):
        return self._links.get(
            self._cache_key(quality),
            lambda: self._fetch_candidates(quality),
            stale_url,
        )

    def _open(self, headers, allow_refresh=True, quality=None, exclude_url=None):
        active_quality = self._quality if quality is None else quality
        urls = _prioritize_urls(self._urls)
        preferred = [u for u in urls if u != exclude_url] if exclude_url else urls
        candidates = preferred or urls
        try:
            return _race(candidates, headers)
        except StreamUnavailable as error:
            if exclude_url and preferred and len(preferred) < len(urls):
                try:
                    return _race([exclude_url], headers)
                except StreamUnavailable as retry_error:
                    error = retry_error
            if not (allow_refresh and error.expired):
                raise
        self._urls = self._resolve(stale_url=urls[0], quality=active_quality)
        if not self._urls:
            raise StreamUnavailable("酷狗暂时未提供这首歌的播放地址。", not_found=True)
        return _race(_prioritize_urls(self._urls), headers)

    def _open_fallback_quality(self, headers):
        """最高档（如 flac）全部节点不可达时，按 320 → 128 顺序回退。"""
        tried_urls = set(self._urls or ())
        for quality in _FALLBACK_QUALITIES:
            urls = self._resolve(quality=quality)
            if not urls or set(urls).issubset(tried_urls):
                continue
            tried_urls.update(urls)
            self._quality = quality
            self._urls = urls
            try:
                return self._open(headers, quality=quality)
            except StreamUnavailable:
                continue
        return None

    def _has_healthy_alternative(self):
        now = time.monotonic()
        penalty = getattr(kg_api, "_HOST_PENALTY", {})
        for url in self._urls or ():
            if url == self.url:
                continue
            host = urllib.parse.urlsplit(url).hostname or ""
            if penalty.get(host, 0) <= now:
                return True
        return False

    def chunks(self):
        """正文迭代器；停顿/断流/持续慢速时从断点续传，保证偏移、区间与总长连续。"""
        if self.response.status == 416:
            return
        sent = self.offset
        response = self.response
        resumes = 0
        window_start = time.monotonic()
        window_bytes = 0
        try:
            while True:
                if self.end is not None and sent >= self.end:
                    return
                read_size = kg_playback.CHUNK_SIZE
                if self.end is not None:
                    read_size = min(read_size, self.end - sent)
                try:
                    chunk = response.read1(read_size)
                except (OSError, HTTPException):
                    chunk = b""
                if chunk:
                    if self.end is not None and sent + len(chunk) > self.end:
                        chunk = chunk[:self.end - sent]
                    sent += len(chunk)
                    window_bytes += len(chunk)
                    yield chunk
                    elapsed = time.monotonic() - window_start
                    if elapsed >= SLOW_WINDOW_SECONDS:
                        bps = window_bytes / elapsed
                        remaining = (self.end - sent) if self.end is not None else None
                        window_start = time.monotonic()
                        window_bytes = 0
                        if (bps < SLOW_MIN_BPS and resumes < MAX_RESUMES
                                and (remaining is None or remaining >= SLOW_MIN_REMAINING)
                                and self._has_healthy_alternative()):
                            # 当前节点持续被限速且有健康备选节点：主动切节点续传
                            chunk = b""
                        else:
                            continue
                    else:
                        continue
                target_end = self.end if self.end is not None else self.total
                if target_end is None or sent >= target_end or resumes >= MAX_RESUMES:
                    return
                resumes += 1
                failed_url = self.url
                kg_api.note_unreachable(failed_url)
                response.close()
                retry = dict(self._headers)
                if self.end is not None and self.total is not None and self.end < self.total:
                    retry["Range"] = f"bytes={sent}-{self.end - 1}"
                else:
                    retry["Range"] = f"bytes={sent}-"
                retry.pop("If-Range", None)
                try:
                    response, self.url = self._open(retry, exclude_url=failed_url)
                except StreamUnavailable:
                    return
                parts = _content_range_parts(response)
                # 续传必须落在同一偏移、同一总长上，否则宁可截断也不拼错音质
                if not parts or parts[0] != sent or parts[2] != self.total:
                    response.close()
                    return
                window_start = time.monotonic()
                window_bytes = 0
        finally:
            response.close()

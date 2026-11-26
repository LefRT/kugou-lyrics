"""Short-lived playback links and a bounded cache of complete audio responses."""

import hashlib
import os
import re
import tempfile
import threading
import time
from collections import OrderedDict
from pathlib import Path


CHUNK_SIZE = 64 * 1024
MAX_AUDIO_SIZE = 64 * 1024 * 1024
CACHE_BUDGET = 512 * 1024 * 1024
CACHE_TTL = 7 * 24 * 60 * 60
MAX_ACTIVE_DOWNLOADS = 3
_CACHE_NAME = re.compile(r"[0-9a-f]{64}\.audio")


class PlaybackLinks:
    def __init__(self):
        self._entries = OrderedDict()
        self._lock = threading.Lock()
        self._resolve_locks = [threading.Lock() for _ in range(16)]

    def get(self, key, resolve, stale_url=None):
        # Coalesce concurrent probes for the same source without holding the cache lock over I/O.
        with self._resolve_locks[hash(key) % len(self._resolve_locks)]:
            with self._lock:
                entry = self._entries.get(key)
                if entry and time.monotonic() < entry[0]:
                    cached = entry[1]
                    stale = (stale_url in cached if isinstance(cached, list)
                             else cached == stale_url)
                    if stale_url is None or not stale:
                        self._entries.move_to_end(key)
                        return cached
            url = resolve()
            with self._lock:
                self._entries[key] = (time.monotonic() + (300 if url else 15), url)
                self._entries.move_to_end(key)
                if len(self._entries) > 256:
                    self._entries.popitem(last=False)
            return url


def audio_type(data):
    if data.startswith(b"fLaC"):
        return "audio/flac"
    if data[4:8] == b"ftyp":
        return "audio/mp4"
    if data.startswith(b"OggS"):
        return "audio/ogg"
    if data.startswith(b"RIFF") and data[8:12] == b"WAVE":
        return "audio/wav"
    if data.startswith(b"ID3"):
        return "audio/mpeg"
    if len(data) >= 2 and data[0] == 0xff:
        if data[1] & 0xf6 == 0xf0:
            return "audio/aac"
        if data[1] & 0xe0 == 0xe0 and data[1] & 0x06:
            return "audio/mpeg"
    return None


def complete_length(status, headers):
    length = headers.get("Content-Length", "")
    if (not re.fullmatch(r"[0-9]{1,9}", length) or headers.get("Transfer-Encoding")
            or headers.get("Content-Encoding", "identity").lower() != "identity"):
        return 0
    length = int(length)
    if status == 200 and not headers.get("Content-Range"):
        return length
    if status == 206 and headers.get("Content-Range") == f"bytes 0-{length - 1}/{length}":
        return length
    return 0


class DownloadReader:
    """对正在后台全速下载的临时文件的只读句柄，负责引用计数与按需等待。"""

    def __init__(self, download):
        self._download = download
        self._closed = False

    @property
    def total(self):
        return self._download.total

    @property
    def content_type(self):
        return self._download.content_type

    @property
    def etag(self):
        return self._download.etag

    @property
    def last_modified(self):
        return self._download.last_modified

    def iter_range(self, start, end):
        """按 [start, end]（含两端）顺序读取字节，未落盘部分自动等待后台写入。"""
        download = self._download
        handle = open(download.temporary, "rb")
        try:
            pos = start
            while pos <= end:
                with download._cond:
                    while download.written <= pos and not download.done:
                        download._cond.wait(timeout=1.0)
                    avail = min(download.written, end + 1) - pos
                    if avail <= 0:
                        return
                handle.seek(pos)
                data = handle.read(min(CHUNK_SIZE, avail))
                if not data:
                    return
                pos += len(data)
                yield data
        finally:
            handle.close()

    def close(self):
        if not self._closed:
            self._closed = True
            self._download._release_reader()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()


class _ActiveDownload:
    """后台全速拉取整首歌到 .part，解耦上游下载与浏览器消费速率。"""

    def __init__(self, cache, path, temporary, handle, total, content_type, *, etag=None, last_modified=None):
        self._cache = cache
        self.path = path
        self.temporary = temporary
        self._handle = handle
        self.total = total
        self.content_type = content_type
        self.etag = etag
        self.last_modified = last_modified
        self.written = 0
        self.done = False
        self.valid = False
        self.failed = False
        self._readers = 0
        self._cleaned = False
        self._published = False
        self._cancel = threading.Event()
        self._cond = threading.Condition()

    def start(self, stream):
        threading.Thread(target=self._run, args=(stream,), daemon=True).start()

    def cancel(self):
        self._cancel.set()

    def _run(self, stream):
        handle = self._handle
        self._handle = None
        size = 0
        valid = False
        try:
            with stream.response:
                for chunk in stream.chunks():
                    if self._cancel.is_set():
                        break
                    if not chunk:
                        continue
                    if size + len(chunk) > self.total:
                        break
                    handle.write(chunk)
                    size += len(chunk)
                    with self._cond:
                        self.written = size
                        self._cond.notify_all()
            if not self._cancel.is_set() and size == self.total:
                handle.seek(0)
                kind = audio_type(handle.read(12))
                if os.fstat(handle.fileno()).st_size == self.total and kind:
                    valid = True
                    self.content_type = kind
        except Exception:  # noqa: BLE001 - 后台拉流失败不向上抛出未捕获异常
            valid = False
        finally:
            try:
                handle.close()
            except OSError:
                pass
            with self._cond:
                self.valid = valid
                self.failed = not valid
                self.done = True
                self._cond.notify_all()
            self._maybe_finalize()

    def _release_reader(self):
        with self._cond:
            self._readers = max(0, self._readers - 1)
        self._maybe_finalize()

    def _maybe_finalize(self):
        with self._cache._lock:
            with self._cond:
                if not self.done or self._readers > 0 or self._cleaned:
                    return
                self._cleaned = True
                valid = self.valid and not self._published
            try:
                if valid:
                    os.replace(self.temporary, self.path)
                    self._published = True
                    self._cache._trim()
                else:
                    self.temporary.unlink(missing_ok=True)
            except OSError:
                try:
                    self.temporary.unlink(missing_ok=True)
                except OSError:
                    pass
            if self._cache._downloads.get(self.path) is self:
                self._cache._downloads.pop(self.path, None)


class AudioCache:
    def __init__(self, directory, *, budget=CACHE_BUDGET, ttl=CACHE_TTL):
        self.directory = Path(directory)
        self.budget = budget
        self.ttl = ttl
        self._lock = threading.Lock()
        self._writing = set()
        self._downloads = OrderedDict()

    def path(self, account, file_hash, mixsongid):
        identity = repr((account, file_hash.upper(), str(mixsongid or ""))).encode("utf-8")
        return self.directory / (hashlib.sha256(identity).hexdigest() + ".audio")

    def open(self, path):
        handle = None
        try:
            handle = path.open("rb")
            stat = os.fstat(handle.fileno())
            now = time.time()
            kind = audio_type(handle.read(12))
            if now - stat.st_mtime < self.ttl and 0 < stat.st_size <= MAX_AUDIO_SIZE and kind:
                handle.seek(0)
                if now - stat.st_atime >= 60:
                    try:
                        os.utime(path, (now, stat.st_mtime))
                    except OSError:
                        pass
                return handle, kind
        except OSError:
            pass
        if handle is not None:
            handle.close()
        return None

    def acquire_download(self, path):
        """加入同曲目正在进行的后台下载，返回 DownloadReader；不可加入返回 None。"""
        with self._lock:
            download = self._downloads.get(path)
            if download is None:
                return None
            with download._cond:
                if download._cleaned or download.failed:
                    return None
                download._readers += 1
            return DownloadReader(download)

    def start_download(self, path, stream, length, content_type, *, etag=None, last_modified=None):
        """接管 stream 启动后台全速下载，并立即返回首个 DownloadReader；若无法接管返回 None。"""
        if not (0 < length <= min(MAX_AUDIO_SIZE, self.budget)):
            return None
        with self._lock:
            existing = self._downloads.get(path)
            if existing is not None:
                with existing._cond:
                    if not existing._cleaned and not existing.failed:
                        return None
            if path in self._writing:
                return None
            if len(self._downloads) >= MAX_ACTIVE_DOWNLOADS:
                # 优先回收没有活跃读者的后台下载，避免快速切歌占满槽位
                evicted = False
                for key, item in list(self._downloads.items()):
                    with item._cond:
                        idle = item._readers == 0
                    if idle:
                        item.cancel()
                        evicted = True
                        break
                if not evicted:
                    return None
            try:
                self.directory.mkdir(parents=True, exist_ok=True)
                handle = tempfile.NamedTemporaryFile(dir=self.directory, prefix=".audio-", suffix=".part",
                                                     mode="w+b", buffering=0, delete=False)
                temporary = Path(handle.name)
            except OSError:
                return None
            download = _ActiveDownload(self, path, temporary, handle, length, content_type,
                                       etag=etag, last_modified=last_modified)
            download._readers = 1
            self._downloads[path] = download
            self._downloads.move_to_end(path)
        download.start(stream)
        return DownloadReader(download)

    def capture(self, path, chunks, length):
        """Write-through on a complete response, with at most two simultaneous writers."""
        with self._lock:
            write = (0 < length <= min(MAX_AUDIO_SIZE, self.budget)
                     and path not in self._writing and path not in self._downloads
                     and len(self._writing) < 2)
            if write:
                self._writing.add(path)
        if not write:
            yield from chunks
            return

        temporary = None
        handle = None
        size = 0
        try:
            for chunk in chunks:
                yield chunk
                if size == 0 and chunk:
                    try:
                        self.directory.mkdir(parents=True, exist_ok=True)
                        handle = tempfile.NamedTemporaryFile(dir=self.directory, prefix=".audio-", suffix=".part",
                                                             mode="w+b", buffering=0, delete=False)
                        temporary = Path(handle.name)
                    except OSError:
                        pass
                size += len(chunk)
                if handle is not None:
                    try:
                        if size > length:
                            handle.close()
                            handle = None
                        else:
                            handle.write(chunk)
                    except OSError:
                        handle.close()
                        handle = None
            if handle is not None and size == length:
                try:
                    handle.seek(0)
                    valid = os.fstat(handle.fileno()).st_size == length and audio_type(handle.read(12))
                    handle.close()
                    handle = None
                    if valid:
                        with self._lock:
                            os.replace(temporary, path)
                            self._trim()
                except OSError:
                    pass
        finally:
            try:
                if handle is not None:
                    handle.close()
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            except OSError:
                pass
            with self._lock:
                self._writing.discard(path)

    def _trim(self):
        now = time.time()
        files = []
        active_parts = {d.temporary.name for d in self._downloads.values()}
        for path in self.directory.iterdir():
            try:
                stat = path.stat()
                if _CACHE_NAME.fullmatch(path.name):
                    if now - stat.st_mtime >= self.ttl:
                        path.unlink()
                    else:
                        files.append((max(stat.st_atime, stat.st_mtime), path, stat.st_size))
                elif (path.name.startswith(".audio-") and path.suffix == ".part"
                      and path.name not in active_parts and now - stat.st_mtime >= 86400):
                    path.unlink()
            except OSError:
                continue
        excess = sum(size for _, _, size in files) - self.budget
        for _, path, size in sorted(files):
            if excess <= 0:
                break
            try:
                path.unlink()
            except OSError:
                continue
            excess -= size

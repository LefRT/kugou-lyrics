"""Render an existing mashup to a local MP4 using its browser stage and clip files."""

import base64
import json
import math
import os
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request
import uuid
from contextlib import contextmanager, suppress
from pathlib import Path
from urllib.parse import urlencode

try:
    import websocket
except ImportError:
    websocket = None


WIDTH, HEIGHT = 1920, 1080
SAMPLE_RATE = 48000
OUTPUT_NAME = "export.mp4"
ACTIVE = ("running", "cancelling")
PROCESS_FLAGS = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


class ExportError(Exception):
    pass


class ExportCancelled(Exception):
    pass


def _browser_executable():
    for command in ("msedge", "google-chrome", "chrome", "chromium", "chromium-browser"):
        if path := shutil.which(command):
            return path
    if os.name == "nt":
        for name in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
            if not (root := os.environ.get(name)):
                continue
            for relative in ("Microsoft/Edge/Application/msedge.exe", "Google/Chrome/Application/chrome.exe"):
                path = Path(root) / relative
                if path.is_file():
                    return str(path)
    return None


def _check_cancel(cancel):
    if cancel.is_set():
        raise ExportCancelled()


def _stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


@contextmanager
def _browser(executable, profile, cancel):
    process = subprocess.Popen([
        executable, "--headless=new", "--no-first-run", "--disable-background-networking",
        "--no-proxy-server", "--remote-debugging-port=0", "--disable-frame-rate-limit",
        f"--user-data-dir={profile}", "about:blank",
    ], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=PROCESS_FLAGS)
    socket = None
    sequence = 0

    def call(method, **params):
        nonlocal sequence
        _check_cancel(cancel)
        sequence += 1
        socket.send(json.dumps({"id": sequence, "method": method, "params": params}))
        while True:
            message = json.loads(socket.recv())
            if message.get("id") == sequence:
                if "error" in message:
                    raise ExportError("舞台浏览器命令失败：" + message["error"]["message"])
                return message["result"]

    try:
        deadline = time.monotonic() + 20
        port_file = profile / "DevToolsActivePort"
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        while time.monotonic() < deadline and process.poll() is None:
            _check_cancel(cancel)
            if port_file.is_file():
                try:
                    port = int(port_file.read_text(encoding="ascii").splitlines()[0])
                    with opener.open(f"http://127.0.0.1:{port}/json/list", timeout=3) as response:
                        target = next(target for target in json.load(response) if target["type"] == "page")
                    # recv() already decodes the local browser's JSON text as UTF-8.
                    socket = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=20,
                                                         suppress_origin=True, enable_multithread=False,
                                                         skip_utf8_validation=True)
                    break
                except (OSError, ValueError, IndexError, StopIteration, websocket.WebSocketException):
                    pass
            cancel.wait(.1)
        if socket is None:
            raise ExportError("无法启动本地 Edge 或 Chrome 渲染窗口。")
        yield call
    finally:
        if socket is not None:
            with suppress(OSError, websocket.WebSocketException):
                socket.send(json.dumps({"id": sequence + 1, "method": "Browser.close"}))
                socket.close(timeout=0)
            with suppress(subprocess.TimeoutExpired):
                process.wait(timeout=4)
        _stop(process)


def _evaluate(browser, expression):
    result = browser("Runtime.evaluate", expression=expression, returnByValue=True)
    if "exceptionDetails" in result:
        detail = result["exceptionDetails"]
        raise ExportError(detail.get("exception", {}).get("description") or detail["text"])
    return result["result"].get("value")


def _open_stage(browser, page_url, cancel):
    browser("Emulation.setDeviceMetricsOverride", width=WIDTH, height=HEIGHT,
            deviceScaleFactor=1, mobile=False)
    browser("Emulation.setEmulatedMedia", features=[{"name": "prefers-reduced-motion", "value": "no-preference"}])
    result = browser("Page.navigate", url=page_url)
    if "errorText" in result:
        raise ExportError("本地舞台页面无法打开。")
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        state = _evaluate(browser, "({fps: window.videoStage?.fps, error: window.videoStageError})")
        if state.get("error"):
            raise ExportError(state["error"])
        if state.get("fps") == 30:
            return 30
        cancel.wait(.15)
    raise ExportError("舞台素材载入超时。")


def _clips(work, segments):
    if not isinstance(segments, list) or not segments:
        raise ExportError("这份作品还没有可导出的音频片段。")
    clips = []
    for i, segment in enumerate(segments, 1):
        try:
            source = (work / segment["file"]).resolve()
            duration = segment["duration_ms"]
            if not (source.is_relative_to(work) and source.is_file()
                    and math.isfinite(duration) and duration > 0):
                raise ValueError()
        except (KeyError, TypeError, ValueError, OSError):
            raise ExportError(f"第 {i} 段音频或时长无效，请检查作品文件。") from None
        clips.append((source, duration))
    return clips


@contextmanager
def _encoder(ffmpeg, args, stderr_path, *, pipe=False):
    with stderr_path.open("w+b") as errors:
        process = subprocess.Popen([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", *args],
                                   stdin=subprocess.PIPE if pipe else subprocess.DEVNULL,
                                   stderr=errors, stdout=subprocess.DEVNULL, creationflags=PROCESS_FLAGS)
        try:
            yield process
        except BrokenPipeError:
            errors.seek(0)
            raise ExportError("视频编码中断。" + errors.read().decode("utf-8", "replace").strip()) from None
        finally:
            _stop(process)
            if pipe:
                with suppress(BrokenPipeError):
                    process.stdin.close()
        if process.returncode:
            errors.seek(0)
            raise ExportError("FFmpeg 处理失败。" + errors.read().decode("utf-8", "replace").strip())


def _wait(process, cancel):
    while process.poll() is None:
        _check_cancel(cancel)
        cancel.wait(.12)
    _check_cancel(cancel)


def _record(browser, ffmpeg, directory, fps, clips, update, cancel):
    video = directory / "video.mp4"
    args = ["-f", "image2pipe", "-framerate", str(fps), "-c:v", "mjpeg", "-threads", "2", "-i", "pipe:0",
            "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-threads", "4", str(video)]
    frames_per_clip = [math.ceil(ms * fps / 1000) for _, ms in clips]
    total_audio_frames = sum(frames_per_clip)
    starters = []
    frame = 0
    with _encoder(ffmpeg, args, directory / "encode.log", pipe=True) as process:
        for frame in range(total_audio_frames + len(clips) * fps * 30):
            state = _evaluate(browser, "window.videoStage.frame()")
            if state["ended"]:
                break
            track = state["track"]
            if track == len(starters):
                starters.append(frame)
            picture = browser("Page.captureScreenshot", format="jpeg", quality=94, optimizeForSpeed=True)
            process.stdin.write(base64.b64decode(picture["data"]))
            if frame % fps == 0:
                audio_frames = sum(frames_per_clip[:track]) + min(frame - starters[track], frames_per_clip[track])
                update(min(97, 1 + int(96 * audio_frames / total_audio_frames)))
        else:
            raise ExportError("舞台转场未能结束。")
        if len(starters) != len(clips):
            raise ExportError("舞台未播放全部音频片段。")
        process.stdin.close()
        _wait(process, cancel)
    return video, starters, frame


def _audio_group(ffmpeg, directory, name, clips, starters, ends, fps, cancel):
    args = []
    filters = []
    for i, ((source, duration), start, end) in enumerate(zip(clips, starters, ends, strict=True)):
        args.extend(["-i", str(source)])
        span = (end - start) * (SAMPLE_RATE // fps)
        content = min(span, round(duration * SAMPLE_RATE / 1000))
        # Match the live stage's startup fade and leave silence under each outro.
        filters.append(f"[{i}:a]aresample={SAMPLE_RATE},aformat=channel_layouts=stereo,"
                       f"apad,atrim=end_sample={content},afade=t=in:d=0.6,apad=whole_len={span}[a{i}]")
    inputs = "".join(f"[a{i}]" for i in range(len(clips)))
    filters.append(f"{inputs}concat=n={len(clips)}:v=0:a=1[audio]")
    args.extend(["-filter_complex_threads", "2", "-filter_complex", ";".join(filters),
                 "-map", "[audio]", "-c:a", "pcm_s16le", str(directory / name)])
    with _encoder(ffmpeg, args, directory / "audio.log") as process:
        _wait(process, cancel)


def _mux(ffmpeg, video, directory, clips, starters, frame_count, fps, cancel):
    output = directory / OUTPUT_NAME
    ends = starters[1:] + [frame_count]
    audio_files = []
    # Bound the FFmpeg command line and number of open inputs for long works on Windows.
    group_size = 24
    for start in range(0, len(clips), group_size):
        stop = start + group_size
        name = f"audio-{start}.wav"
        _audio_group(ffmpeg, directory, name, clips[start:stop], starters[start:stop], ends[start:stop], fps, cancel)
        audio_files.append(f"file {name}\n")
    listing = directory / "audio.ffconcat"
    listing.write_text("".join(audio_files), encoding="ascii")
    args = ["-i", str(video), "-f", "concat", "-safe", "1", "-i", str(listing),
            "-map", "0:v", "-map", "1:a", "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(output)]
    with _encoder(ffmpeg, args, directory / "mux.log") as process:
        _wait(process, cancel)
    return output


def _work_revision(path):
    stat = path.stat()
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns


class VideoExports:
    def __init__(self):
        self.lock = threading.RLock()
        self._jobs = {}

    def summary(self, mid, work):
        with self.lock:
            available = (work / OUTPUT_NAME).is_file()
            if pair := self._jobs.get(mid):
                job, _, _ = pair
                return {**job, "available": available}
            if available:
                return {"status": "done", "progress": 100, "available": True}
            return None

    def active(self, mid):
        with self.lock:
            return bool((pair := self._jobs.get(mid)) and pair[0]["status"] in ACTIVE)

    def forget(self, mid):
        with self.lock:
            self._jobs.pop(mid, None)

    def start(self, mid, work, meta, theme, origin):
        with self.lock:
            if self.active(mid):
                return self._jobs[mid][0].copy()
            if any(job["status"] in ACTIVE for job, _, _ in self._jobs.values()):
                raise ExportError("已有作品正在导出，完成后可以导出这一首。")
            if websocket is None:
                raise ExportError("缺少视频导出依赖，请运行 py -3 -m pip install -r requirements-video.txt。")
            executable, ffmpeg = _browser_executable(), shutil.which("ffmpeg")
            if not executable or not ffmpeg:
                raise ExportError("视频导出需要本机安装 Edge 或 Chrome，以及 FFmpeg。")
            work = work.resolve()
            clips = _clips(work, meta.get("segments"))
            revision = _work_revision(work / "meta.json")
            job = {"id": uuid.uuid4().hex, "status": "running", "progress": 0}
            cancel = threading.Event()
            url = origin + "/?" + urlencode({"mashup": mid, "render": "video", "theme": theme})
            thread = threading.Thread(target=self._run,
                                      args=(work, revision, url, job, cancel, executable, ffmpeg, clips), daemon=True)
            self._jobs[mid] = job, cancel, thread
            thread.start()
            return job.copy()

    def _run(self, work, revision, url, job, cancel, executable, ffmpeg, clips):
        def update(progress):
            with self.lock:
                job["progress"] = progress

        try:
            with tempfile.TemporaryDirectory(prefix=".video-export-", dir=work.parent,
                                             ignore_cleanup_errors=True) as temp:
                directory = Path(temp)
                with _browser(executable, directory / "browser", cancel) as browser:
                    fps = _open_stage(browser, url, cancel)
                    video, starts, frames = _record(browser, ffmpeg, directory, fps, clips, update, cancel)
                update(98)
                output = _mux(ffmpeg, video, directory, clips, starts, frames, fps, cancel)
                with self.lock:
                    _check_cancel(cancel)
                    if revision != _work_revision(work / "meta.json"):
                        raise ExportError("作品已发生变化，请重新导出。")
                    os.replace(output, work / OUTPUT_NAME)
                    job.update(status="done", progress=100)
        except ExportCancelled:
            with self.lock:
                job.update(status="cancelled")
        except Exception as error:
            with self.lock:
                job.update(status="cancelled" if cancel.is_set() else "error", error=str(error))

    def cancel(self, mid, job_id):
        with self.lock:
            if not self.active(mid) or self._jobs[mid][0]["id"] != job_id:
                return False
            job, event, _ = self._jobs[mid]
            job["status"] = "cancelling"
            event.set()
            return True

    def shutdown(self):
        with self.lock:
            active = [(event, thread) for job, event, thread in self._jobs.values() if job["status"] in ACTIVE]
            for event, _ in active:
                event.set()
        for _, thread in active:
            thread.join(timeout=25)

import array
import math
import shutil
import subprocess
import tempfile
import threading
import unittest
import wave
from pathlib import Path

import kg_video


@unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg is required for the video mux test")
class VideoExportTest(unittest.TestCase):
    def test_audio_uses_video_frame_boundaries_between_clips(self):
        ffmpeg = shutil.which("ffmpeg")
        rate = kg_video.SAMPLE_RATE
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            video = directory / "video.mp4"
            subprocess.run([ffmpeg, "-loglevel", "error", "-f", "lavfi", "-i",
                            "color=s=64x64:r=30:d=2", "-c:v", "mpeg4", str(video)], check=True)
            clips = []
            for frequency, duration in [(440, 400), (660, 650)]:
                path = directory / f"{frequency}.wav"
                tone = array.array("h", (round(12000 * math.sin(math.tau * frequency * n / rate))
                                         for n in range(rate * duration // 1000)))
                with wave.open(str(path), "wb") as wav:
                    wav.setparams((1, 2, rate, 0, "NONE", ""))
                    wav.writeframes(tone.tobytes())
                clips.append((path, duration))
            result = kg_video._mux(ffmpeg, video, directory, clips, [0, 30], 60, 30, threading.Event())
            decoded = subprocess.check_output([ffmpeg, "-loglevel", "error", "-i", str(result),
                                               "-vn", "-ac", "1", "-ar", str(rate), "-f", "s16le", "-"])
            samples = array.array("h", decoded)

            def peak(start, end):
                return max(map(abs, samples[round(start * rate):round(end * rate)]))

            self.assertGreater(peak(.20, .38), 2000)
            self.assertLess(peak(.48, .98), 64)
            self.assertGreater(peak(1.20, 1.50), 2000)
            self.assertLess(peak(1.72, 1.95), 64)

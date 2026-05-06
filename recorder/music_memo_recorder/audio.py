from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import signal
import subprocess
import time

from .config import RecorderConfig
from .wav import make_sine_wav, read_wav_info


@dataclass(frozen=True)
class CaptureResult:
    duration_seconds: float
    audio_path: Path


class MockAudioRecorder:
    def __init__(self, sample_rate: int, channel_count: int) -> None:
        self.sample_rate = sample_rate
        self.channel_count = channel_count
        self._started_at: float | None = None
        self._target_path: Path | None = None

    def start(self, target_path: Path) -> None:
        self._started_at = time.monotonic()
        self._target_path = target_path

    def stop(self) -> CaptureResult:
        if self._started_at is None or self._target_path is None:
            raise RuntimeError("mock recorder was not started")
        duration = max(0.25, time.monotonic() - self._started_at)
        self._target_path.parent.mkdir(parents=True, exist_ok=True)
        self._target_path.write_bytes(
            make_sine_wav(
                duration_seconds=duration,
                sample_rate=self.sample_rate,
                channel_count=self.channel_count,
            )
        )
        result = CaptureResult(duration_seconds=duration, audio_path=self._target_path)
        self._started_at = None
        self._target_path = None
        return result


class ArecordAudioRecorder:
    def __init__(self, sample_rate: int, channel_count: int) -> None:
        self.sample_rate = sample_rate
        self.channel_count = channel_count
        self._process: subprocess.Popen[bytes] | None = None
        self._started_at: float | None = None
        self._target_path: Path | None = None

    def start(self, target_path: Path) -> None:
        if self._process is not None:
            raise RuntimeError("arecord is already running")
        target_path.parent.mkdir(parents=True, exist_ok=True)
        self._target_path = target_path
        self._started_at = time.monotonic()
        self._process = subprocess.Popen(
            [
                "arecord",
                "-q",
                "-f",
                "S16_LE",
                "-r",
                str(self.sample_rate),
                "-c",
                str(self.channel_count),
                "-t",
                "wav",
                str(target_path),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

    def stop(self) -> CaptureResult:
        if self._process is None or self._target_path is None or self._started_at is None:
            raise RuntimeError("arecord was not started")
        process = self._process
        target_path = self._target_path
        started_at = self._started_at
        process.send_signal(signal.SIGINT)
        try:
            _stdout, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            _stdout, stderr = process.communicate(timeout=5)
        finally:
            self._process = None
            self._target_path = None
            self._started_at = None

        if process.returncode not in {0, -2}:
            message = stderr.decode("utf8", errors="replace").strip()
            raise RuntimeError(message or f"arecord failed with {process.returncode}")

        data = target_path.read_bytes()
        info = read_wav_info(data)
        return CaptureResult(
            duration_seconds=max(info.duration_seconds, time.monotonic() - started_at),
            audio_path=target_path,
        )


def create_audio_recorder(config: RecorderConfig) -> MockAudioRecorder | ArecordAudioRecorder:
    backend = config.audio_backend.lower()
    if backend == "mock":
        return MockAudioRecorder(config.sample_rate, config.channel_count)
    if backend == "arecord":
        return ArecordAudioRecorder(config.sample_rate, config.channel_count)
    raise ValueError(f"unknown audio backend: {config.audio_backend}")

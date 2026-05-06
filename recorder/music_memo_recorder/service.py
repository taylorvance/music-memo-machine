from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import time

from .audio import create_audio_recorder
from .config import RecorderConfig
from .spool import RecorderSpool, SpoolRecord
from .sync import SyncClient, SyncOutcome, sync_ready_sessions


class StatusLight:
    def set(self, state: str) -> None:
        raise NotImplementedError


class ConsoleStatusLight(StatusLight):
    def set(self, state: str) -> None:
        print(f"status={state}", flush=True)


class RecorderService:
    def __init__(
        self,
        config: RecorderConfig,
        spool: RecorderSpool | None = None,
        status_light: StatusLight | None = None,
        sync_client: SyncClient | None = None,
    ) -> None:
        self.config = config
        self.spool = spool or RecorderSpool(config.spool_dir)
        self.status_light = status_light or ConsoleStatusLight()
        self.sync_client = sync_client
        self.audio = create_audio_recorder(config)
        self.current_record: SpoolRecord | None = None
        self.recording_started_monotonic: float | None = None

    @property
    def is_recording(self) -> bool:
        return self.current_record is not None

    def start_recording(self) -> SpoolRecord:
        if self.current_record is not None:
            raise RuntimeError("recording is already active")
        record = self.spool.begin_session(self.config.device_name)
        self.audio.start(record.audio_path)
        self.current_record = record
        self.recording_started_monotonic = time.monotonic()
        self.status_light.set("recording")
        return record

    def add_bookmark(self, note: str = "") -> None:
        if self.current_record is None or self.recording_started_monotonic is None:
            return
        elapsed = time.monotonic() - self.recording_started_monotonic
        self.spool.add_bookmark(
            self.current_record,
            timestamp_seconds=elapsed,
            created_at=datetime.now(timezone.utc),
            note=note,
        )
        self.status_light.set("bookmark")
        self.status_light.set("recording")

    def stop_recording(self) -> SpoolRecord:
        if self.current_record is None:
            raise RuntimeError("no recording is active")
        record = self.current_record
        self.audio.stop()
        ready = self.spool.finalize_recording(record)
        self.current_record = None
        self.recording_started_monotonic = None
        self.status_light.set("ready")
        return ready

    def toggle_recording(self) -> None:
        if self.is_recording:
            self.stop_recording()
        else:
            self.start_recording()

    def record_for_duration(
        self,
        duration_seconds: float,
        bookmarks: list[tuple[float, str]] | None = None,
    ) -> SpoolRecord:
        record = self.start_recording()
        started_at = self.recording_started_monotonic
        if started_at is None:
            raise RuntimeError("recording did not start")
        for timestamp, note in sorted(bookmarks or [], key=lambda item: item[0]):
            if timestamp > duration_seconds:
                continue
            time.sleep(max(0.0, timestamp - (time.monotonic() - started_at)))
            self.add_bookmark(note)
        remaining = duration_seconds - (time.monotonic() - started_at)
        if remaining > 0:
            time.sleep(remaining)
        return self.stop_recording()

    def sync_once(self) -> list[SyncOutcome]:
        self.status_light.set("syncing")
        outcomes = sync_ready_sessions(self.spool, self.config, self.sync_client)
        if any(
            outcome.status in {"failed", "conflict", "retry_later"}
            for outcome in outcomes
        ):
            self.status_light.set("failed")
        else:
            self.status_light.set("synced")
        return outcomes


def run_gpio_service(config: RecorderConfig) -> None:
    from .gpio import run_gpio_loop

    service = RecorderService(config)
    run_gpio_loop(config, service)

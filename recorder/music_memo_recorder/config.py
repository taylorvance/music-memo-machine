from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True)
class RecorderConfig:
    spool_dir: Path
    manager_url: str
    device_name: str
    audio_backend: str
    gpio_backend: str
    sample_rate: int
    channel_count: int
    sync_attempts: int
    retry_delay_seconds: float
    sync_interval_seconds: float
    status_visibility_seconds: float
    delete_after_ack: bool
    record_button_pin: int
    bookmark_button_pin: int
    led_pin: int


def _env_bool(env: dict[str, str], name: str, default: bool) -> bool:
    value = env.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(env: dict[str, str], name: str, default: int) -> int:
    value = env.get(name)
    if value is None or value.strip() == "":
        return default
    return int(value)


def _env_float(env: dict[str, str], name: str, default: float) -> float:
    value = env.get(name)
    if value is None or value.strip() == "":
        return default
    return float(value)


def load_config(env: dict[str, str] | None = None) -> RecorderConfig:
    source = os.environ if env is None else env
    return RecorderConfig(
        spool_dir=Path(
            source.get(
                "RECORDER_SPOOL_DIR",
                source.get("MUSIC_MEMO_RECORDER_SPOOL_DIR", "library/recorder-spool"),
            )
        ),
        manager_url=source.get(
            "MANAGER_URL",
            source.get("RECORDER_MANAGER_URL", "http://127.0.0.1:3001"),
        ),
        device_name=source.get("DEVICE_NAME", "music-memo-recorder-1"),
        audio_backend=source.get("RECORDER_AUDIO_BACKEND", "mock"),
        gpio_backend=source.get("RECORDER_GPIO_BACKEND", "mock"),
        sample_rate=_env_int(source, "RECORDER_SAMPLE_RATE", 16_000),
        channel_count=_env_int(source, "RECORDER_CHANNEL_COUNT", 1),
        sync_attempts=_env_int(source, "RECORDER_SYNC_ATTEMPTS", 3),
        retry_delay_seconds=_env_float(source, "RECORDER_RETRY_DELAY_SECONDS", 2.0),
        sync_interval_seconds=_env_float(source, "RECORDER_SYNC_INTERVAL_SECONDS", 30.0),
        status_visibility_seconds=_env_float(
            source, "RECORDER_STATUS_VISIBILITY_SECONDS", 30.0
        ),
        delete_after_ack=_env_bool(source, "RECORDER_DELETE_AFTER_ACK", False),
        record_button_pin=_env_int(source, "RECORDER_RECORD_BUTTON_PIN", 17),
        bookmark_button_pin=_env_int(source, "RECORDER_BOOKMARK_BUTTON_PIN", 27),
        led_pin=_env_int(source, "RECORDER_LED_PIN", 22),
    )

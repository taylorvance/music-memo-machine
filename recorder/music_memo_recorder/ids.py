from __future__ import annotations

from datetime import datetime, timezone
import re
import secrets


_SAFE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")


def safe_id_segment(value: str) -> str:
    safe = re.sub(r"[^a-z0-9._-]+", "-", value.lower()).strip("-")
    return safe[:48] or "music-memo-recorder"


def validate_session_id(value: str) -> str:
    session_id = value.strip()
    if not _SAFE_ID_PATTERN.match(session_id) or session_id in {".", ".."}:
        raise ValueError(
            "session id must use only letters, numbers, dot, underscore, or dash"
        )
    return session_id


def create_session_id(device_name: str, now: datetime | None = None) -> str:
    timestamp = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    stamp = timestamp.strftime("%Y%m%d-%H%M%S")
    suffix = secrets.token_hex(3)
    return validate_session_id(f"{safe_id_segment(device_name)}-{stamp}-{suffix}")

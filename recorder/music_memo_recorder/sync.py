from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from uuid import uuid4

from .config import RecorderConfig
from .spool import RecorderSpool, SpoolRecord


@dataclass(frozen=True)
class SyncOutcome:
    session_id: str
    status: str
    http_status: int | None = None
    acknowledged: bool = False
    duplicate: bool = False
    attempt: int = 0
    error: str | None = None


class SyncClient:
    def __init__(self, manager_url: str, timeout_seconds: float = 30.0) -> None:
        self.manager_url = manager_url.rstrip("/") + "/"
        self.timeout_seconds = timeout_seconds

    def post_session(self, metadata: dict, audio_path: Path) -> tuple[int, dict]:
        boundary = f"music-memo-{uuid4().hex}"
        body, content_length = multipart_body(metadata, audio_path, boundary)
        request = Request(
            urljoin(self.manager_url, "api/ingest/sessions"),
            data=body,
            method="POST",
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Content-Length": str(content_length),
                "Accept": "application/json",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                response_body = response.read().decode("utf8")
                return response.status, json.loads(response_body or "{}")
        except HTTPError as error:
            response_body = error.read().decode("utf8", errors="replace")
            try:
                parsed = json.loads(response_body or "{}")
            except json.JSONDecodeError:
                parsed = {"raw": response_body}
            raise SyncHTTPError(error.code, parsed) from error
        except URLError as error:
            raise SyncNetworkError(str(error.reason)) from error


class SyncHTTPError(Exception):
    def __init__(self, status: int, body: dict) -> None:
        super().__init__(body.get("error") or f"manager rejected import: {status}")
        self.status = status
        self.body = body


class SyncNetworkError(Exception):
    pass


def multipart_body(metadata: dict, audio_path: Path, boundary: str):
    metadata_json = json.dumps(metadata, separators=(",", ":")).encode("utf8")
    metadata_part = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="metadata"\r\n'
        "Content-Type: application/json\r\n\r\n"
    ).encode("utf8") + metadata_json + b"\r\n"
    audio_header = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="audio"; filename="source.wav"\r\n'
        "Content-Type: audio/wav\r\n\r\n"
    ).encode("utf8")
    closing = f"\r\n--{boundary}--\r\n".encode("utf8")
    audio_size = audio_path.stat().st_size
    content_length = len(metadata_part) + len(audio_header) + audio_size + len(closing)

    def chunks():
        yield metadata_part
        yield audio_header
        with audio_path.open("rb") as audio_file:
            while True:
                chunk = audio_file.read(1024 * 1024)
                if not chunk:
                    break
                yield chunk
        yield closing

    return chunks(), content_length


def sync_record(
    spool: RecorderSpool,
    record: SpoolRecord,
    client: SyncClient,
    config: RecorderConfig,
) -> SyncOutcome:
    metadata = spool.build_metadata(record)
    last_error: Exception | None = None

    for attempt in range(1, config.sync_attempts + 1):
        try:
            status, body = client.post_session(metadata, record.audio_path)
            acknowledged = body.get("acknowledged") is True
            if not acknowledged:
                raise SyncHTTPError(status, body)
            spool.mark_synced(record, body, delete_audio=config.delete_after_ack)
            return SyncOutcome(
                session_id=record.session_id,
                status="synced",
                http_status=status,
                acknowledged=True,
                duplicate=body.get("duplicate") is True,
                attempt=attempt,
            )
        except SyncHTTPError as error:
            last_error = error
            details = {
                "status": error.status,
                "error": str(error),
                "body": error.body,
                "attempt": attempt,
            }
            if error.status == 409:
                spool.mark_conflict(record, details)
                return SyncOutcome(
                    session_id=record.session_id,
                    status="conflict",
                    http_status=error.status,
                    attempt=attempt,
                    error=str(error),
                )
            if error.status < 500:
                spool.mark_failed(record, details)
                return SyncOutcome(
                    session_id=record.session_id,
                    status="failed",
                    http_status=error.status,
                    attempt=attempt,
                    error=str(error),
                )
            spool.write_last_error(record, details)
        except SyncNetworkError as error:
            last_error = error
            spool.write_last_error(
                record,
                {
                    "error": str(error),
                    "attempt": attempt,
                },
            )

        if attempt < config.sync_attempts:
            time.sleep(config.retry_delay_seconds)

    return SyncOutcome(
        session_id=record.session_id,
        status="retry_later",
        attempt=config.sync_attempts,
        error=str(last_error) if last_error else "sync failed",
    )


def sync_ready_sessions(
    spool: RecorderSpool,
    config: RecorderConfig,
    client: SyncClient | None = None,
) -> list[SyncOutcome]:
    sync_client = client or SyncClient(config.manager_url)
    return [
        sync_record(spool, record, sync_client, config)
        for record in spool.iter_ready()
    ]

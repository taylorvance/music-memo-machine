from __future__ import annotations

from dataclasses import dataclass
import json
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

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

    def post_session(self, payload: dict) -> tuple[int, dict]:
        body = json.dumps(payload).encode("utf8")
        request = Request(
            urljoin(self.manager_url, "api/ingest/sessions"),
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
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


def sync_record(
    spool: RecorderSpool,
    record: SpoolRecord,
    client: SyncClient,
    config: RecorderConfig,
) -> SyncOutcome:
    payload = spool.build_payload(record)
    last_error: Exception | None = None

    for attempt in range(1, config.sync_attempts + 1):
        try:
            status, body = client.post_session(payload)
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

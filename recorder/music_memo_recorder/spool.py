from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import base64
import json
import shutil

from .ids import create_session_id, validate_session_id
from .wav import read_wav_info


@dataclass(frozen=True)
class SpoolRecord:
    session_id: str
    state: str
    path: Path
    manifest_path: Path
    audio_path: Path


class RecorderSpool:
    states = ("recording", "ready", "synced", "failed", "conflict")

    def __init__(self, root: Path) -> None:
        self.root = root

    def ensure(self) -> None:
        for state in self.states:
            (self.root / state).mkdir(parents=True, exist_ok=True)

    def state_dir(self, state: str) -> Path:
        if state not in self.states:
            raise ValueError(f"unknown spool state: {state}")
        return self.root / state

    def begin_session(
        self,
        device_name: str,
        session_id: str | None = None,
        now: datetime | None = None,
        title: str = "",
        notes: str = "",
    ) -> SpoolRecord:
        self.ensure()
        created_at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        safe_session_id = validate_session_id(
            session_id or create_session_id(device_name, created_at)
        )
        session_dir = self.state_dir("recording") / safe_session_id
        session_dir.mkdir(parents=False, exist_ok=False)
        manifest = {
            "id": safe_session_id,
            "device_name": device_name,
            "created_at": created_at.isoformat().replace("+00:00", "Z"),
            "title": title,
            "notes": notes,
            "audio_path": "source.wav",
            "bookmarks": [],
        }
        self._write_json(session_dir / "manifest.json", manifest)
        return self._record_for("recording", safe_session_id)

    def add_bookmark(
        self,
        record: SpoolRecord,
        timestamp_seconds: float,
        created_at: datetime | None = None,
        note: str = "",
    ) -> None:
        if record.state != "recording":
            raise ValueError("bookmarks can only be added to recording sessions")
        manifest = self.read_manifest(record)
        index = len(manifest.get("bookmarks", [])) + 1
        created = (created_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
        manifest.setdefault("bookmarks", []).append(
            {
                "id": f"bookmark-{index:03d}",
                "timestamp_seconds": round(max(0.0, timestamp_seconds), 3),
                "created_at": created.isoformat().replace("+00:00", "Z"),
                "state": "unresolved",
                "note": note,
            }
        )
        self._write_json(record.manifest_path, manifest)

    def finalize_recording(self, record: SpoolRecord) -> SpoolRecord:
        if record.state != "recording":
            raise ValueError("only recording sessions can be finalized")
        read_wav_info(record.audio_path.read_bytes())
        return self._move(record, "ready")

    def iter_ready(self) -> list[SpoolRecord]:
        self.ensure()
        records = []
        for child in sorted(self.state_dir("ready").iterdir()):
            if child.is_dir() and (child / "manifest.json").exists():
                records.append(self._record_for("ready", child.name))
        return records

    def read_manifest(self, record: SpoolRecord) -> dict:
        return json.loads(record.manifest_path.read_text(encoding="utf8"))

    def build_payload(self, record: SpoolRecord) -> dict:
        manifest = self.read_manifest(record)
        audio = record.audio_path.read_bytes()
        read_wav_info(audio)
        return {
            "id": manifest["id"],
            "device_name": manifest.get("device_name", ""),
            "created_at": manifest["created_at"],
            "title": manifest.get("title", ""),
            "notes": manifest.get("notes", ""),
            "audio": {
                "data_base64": base64.b64encode(audio).decode("ascii"),
            },
            "bookmarks": manifest.get("bookmarks", []),
        }

    def mark_synced(self, record: SpoolRecord, ack: dict, delete_audio: bool) -> None:
        if delete_audio:
            target = self.state_dir("synced") / record.session_id
            target.mkdir(parents=True, exist_ok=True)
            self._write_json(target / "ack.json", ack)
            shutil.rmtree(record.path)
            return

        synced = self._move(record, "synced")
        self._write_json(synced.path / "ack.json", ack)

    def mark_failed(self, record: SpoolRecord, error: dict) -> None:
        failed = self._move(record, "failed")
        self._write_json(failed.path / "error.json", error)

    def mark_conflict(self, record: SpoolRecord, error: dict) -> None:
        conflict = self._move(record, "conflict")
        self._write_json(conflict.path / "error.json", error)

    def write_last_error(self, record: SpoolRecord, error: dict) -> None:
        self._write_json(record.path / "last_error.json", error)

    def _record_for(self, state: str, session_id: str) -> SpoolRecord:
        session_dir = self.state_dir(state) / session_id
        return SpoolRecord(
            session_id=session_id,
            state=state,
            path=session_dir,
            manifest_path=session_dir / "manifest.json",
            audio_path=session_dir / "source.wav",
        )

    def _move(self, record: SpoolRecord, target_state: str) -> SpoolRecord:
        self.ensure()
        target = self.state_dir(target_state) / record.session_id
        if target.exists():
            shutil.rmtree(target)
        shutil.move(str(record.path), str(target))
        return self._record_for(target_state, record.session_id)

    @staticmethod
    def _write_json(path: Path, data: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            f"{json.dumps(data, indent=2, sort_keys=True)}\n",
            encoding="utf8",
        )

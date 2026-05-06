from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .config import RecorderConfig, load_config
from .service import RecorderService, run_gpio_service
from .spool import RecorderSpool
from .sync import SyncClient, sync_ready_sessions


def _parse_bookmark(value: str) -> tuple[float, str]:
    timestamp_raw, separator, note = value.partition(":")
    try:
        timestamp = float(timestamp_raw)
    except ValueError as error:
        raise argparse.ArgumentTypeError("bookmark timestamp must be a number") from error
    if timestamp < 0:
        raise argparse.ArgumentTypeError("bookmark timestamp must be non-negative")
    return timestamp, note if separator else ""


def _with_overrides(args: argparse.Namespace) -> RecorderConfig:
    config = load_config()
    updates = {}
    for attr in (
        "spool_dir",
        "manager_url",
        "device_name",
        "audio_backend",
        "gpio_backend",
        "delete_after_ack",
    ):
        value = getattr(args, attr, None)
        if value is not None:
            updates[attr] = value
    if "spool_dir" in updates:
        updates["spool_dir"] = Path(updates["spool_dir"])
    return RecorderConfig(**{**config.__dict__, **updates})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="music-memo-recorder")
    parser.add_argument("--spool-dir")
    parser.add_argument("--manager-url")
    parser.add_argument("--device-name")
    parser.add_argument("--audio-backend", choices=["mock", "arecord"])
    parser.add_argument("--gpio-backend", choices=["mock", "gpiozero"])
    parser.add_argument("--delete-after-ack", action="store_true", default=None)

    subparsers = parser.add_subparsers(dest="command", required=True)

    record_once = subparsers.add_parser("record-once")
    record_once.add_argument("--duration", type=float, default=3.0)
    record_once.add_argument("--bookmark", action="append", type=_parse_bookmark, default=[])
    record_once.add_argument("--sync", action="store_true")
    record_once.add_argument("--json", action="store_true")

    sync_once = subparsers.add_parser("sync-once")
    sync_once.add_argument("--json", action="store_true")

    service = subparsers.add_parser("service")
    service.add_argument("--sync-at-start", action="store_true")

    return parser


def _print_outcomes(outcomes) -> None:
    for outcome in outcomes:
        print(
            f"{outcome.session_id}: {outcome.status}"
            + (f" ({outcome.http_status})" if outcome.http_status else "")
        )


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    config = _with_overrides(args)
    spool = RecorderSpool(config.spool_dir)

    try:
        if args.command == "record-once":
            service = RecorderService(config, spool=spool)
            record = service.record_for_duration(args.duration, args.bookmark)
            result = {
                "session_id": record.session_id,
                "state": record.state,
                "path": str(record.path),
            }
            if args.sync:
                result["sync"] = [
                    outcome.__dict__ for outcome in service.sync_once()
                ]
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                print(f"ready: {record.session_id} ({record.path})")
            return 0

        if args.command == "sync-once":
            outcomes = sync_ready_sessions(spool, config, SyncClient(config.manager_url))
            if args.json:
                print(json.dumps([outcome.__dict__ for outcome in outcomes], indent=2))
            else:
                _print_outcomes(outcomes)
            return 1 if any(
                outcome.status in {"failed", "conflict", "retry_later"}
                for outcome in outcomes
            ) else 0

        if args.command == "service":
            if args.sync_at_start:
                _print_outcomes(sync_ready_sessions(spool, config))
            run_gpio_service(config)
            return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1

    parser.error(f"unknown command: {args.command}")
    return 2

from datetime import datetime, timezone
import base64
import json
from pathlib import Path
import tempfile
import unittest

from music_memo_recorder.spool import RecorderSpool
from music_memo_recorder.wav import make_sine_wav, read_wav_info


class SpoolTests(unittest.TestCase):
    def test_recording_finalizes_to_ready_and_builds_ingest_payload(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            spool = RecorderSpool(Path(temp_dir))
            record = spool.begin_session(
                "recorder test",
                session_id="recorder-test-001",
                now=datetime(2026, 5, 5, 12, 0, tzinfo=timezone.utc),
                title="Test take",
            )
            record.audio_path.write_bytes(make_sine_wav(0.5, sample_rate=8000))
            spool.add_bookmark(
                record,
                0.25,
                created_at=datetime(2026, 5, 5, 12, 0, 1, tzinfo=timezone.utc),
                note="main idea",
            )

            ready = spool.finalize_recording(record)
            payload = spool.build_payload(ready)

            self.assertEqual(ready.state, "ready")
            self.assertFalse(record.path.exists())
            self.assertEqual(payload["id"], "recorder-test-001")
            self.assertEqual(payload["device_name"], "recorder test")
            self.assertEqual(payload["title"], "Test take")
            self.assertEqual(payload["bookmarks"][0]["note"], "main idea")
            self.assertEqual(payload["bookmarks"][0]["timestamp_seconds"], 0.25)
            audio = base64.b64decode(payload["audio"]["data_base64"])
            self.assertEqual(read_wav_info(audio).duration_seconds, 0.5)

    def test_mark_synced_can_keep_or_delete_audio(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            spool = RecorderSpool(Path(temp_dir))
            record = spool.begin_session("recorder", session_id="keep-audio")
            record.audio_path.write_bytes(make_sine_wav(0.25))
            ready = spool.finalize_recording(record)

            spool.mark_synced(ready, {"acknowledged": True}, delete_audio=False)

            synced_dir = Path(temp_dir) / "synced" / "keep-audio"
            self.assertTrue((synced_dir / "source.wav").exists())
            self.assertEqual(
                json.loads((synced_dir / "ack.json").read_text())["acknowledged"],
                True,
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            spool = RecorderSpool(Path(temp_dir))
            record = spool.begin_session("recorder", session_id="delete-audio")
            record.audio_path.write_bytes(make_sine_wav(0.25))
            ready = spool.finalize_recording(record)

            spool.mark_synced(ready, {"acknowledged": True}, delete_audio=True)

            self.assertFalse(ready.path.exists())
            self.assertFalse((Path(temp_dir) / "synced" / "delete-audio" / "source.wav").exists())
            self.assertTrue((Path(temp_dir) / "synced" / "delete-audio" / "ack.json").exists())


if __name__ == "__main__":
    unittest.main()

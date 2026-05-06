from pathlib import Path
import tempfile
import unittest

from music_memo_recorder.config import load_config
from music_memo_recorder.spool import RecorderSpool
from music_memo_recorder.sync import (
    SyncHTTPError,
    SyncNetworkError,
    multipart_body,
    sync_ready_sessions,
)
from music_memo_recorder.wav import make_sine_wav


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.posts = []

    def post_session(self, metadata, audio_path):
        self.posts.append((metadata, audio_path))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def make_ready_spool(temp_dir: str, session_id: str = "sync-test-001"):
    spool = RecorderSpool(Path(temp_dir))
    record = spool.begin_session("recorder", session_id=session_id)
    record.audio_path.write_bytes(make_sine_wav(0.25))
    return spool, spool.finalize_recording(record)


class SyncTests(unittest.TestCase):
    def test_acknowledged_import_marks_session_synced(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            spool, _record = make_ready_spool(temp_dir)
            config = load_config(
                {
                    "RECORDER_SPOOL_DIR": temp_dir,
                    "RECORDER_SYNC_ATTEMPTS": "1",
                }
            )
            client = FakeClient(
                [
                    (
                        201,
                        {
                            "acknowledged": True,
                            "duplicate": False,
                            "session_id": "sync-test-001",
                        },
                    )
                ]
            )

            outcomes = sync_ready_sessions(spool, config, client)

            self.assertEqual(outcomes[0].status, "synced")
            self.assertTrue((Path(temp_dir) / "synced" / "sync-test-001").exists())
            self.assertEqual(client.posts[0][0]["id"], "sync-test-001")
            self.assertTrue(client.posts[0][1].name.endswith(".wav"))

    def test_multipart_body_streams_metadata_and_audio(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = Path(temp_dir) / "source.wav"
            audio = make_sine_wav(0.25)
            audio_path.write_bytes(audio)
            metadata = {
                "id": "stream-test-001",
                "created_at": "2026-05-05T12:00:00Z",
                "bookmarks": [],
            }

            body, content_length = multipart_body(metadata, audio_path, "test-boundary")
            payload = b"".join(body)

            self.assertEqual(content_length, len(payload))
            self.assertIn(b'name="metadata"', payload)
            self.assertIn(b'"id":"stream-test-001"', payload)
            self.assertIn(b'name="audio"; filename="source.wav"', payload)
            self.assertIn(audio, payload)

    def test_conflict_moves_session_out_of_retry_queue(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            spool, _record = make_ready_spool(temp_dir, "sync-conflict-001")
            config = load_config(
                {
                    "RECORDER_SPOOL_DIR": temp_dir,
                    "RECORDER_SYNC_ATTEMPTS": "3",
                }
            )
            client = FakeClient(
                [
                    SyncHTTPError(
                        409,
                        {"error": "Session id already exists with different audio"},
                    )
                ]
            )

            outcomes = sync_ready_sessions(spool, config, client)

            self.assertEqual(outcomes[0].status, "conflict")
            self.assertFalse((Path(temp_dir) / "ready" / "sync-conflict-001").exists())
            self.assertTrue((Path(temp_dir) / "conflict" / "sync-conflict-001" / "source.wav").exists())
            self.assertTrue((Path(temp_dir) / "conflict" / "sync-conflict-001" / "error.json").exists())

    def test_network_failure_stays_ready_for_later_retry(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            spool, _record = make_ready_spool(temp_dir, "retry-later-001")
            config = load_config(
                {
                    "RECORDER_SPOOL_DIR": temp_dir,
                    "RECORDER_SYNC_ATTEMPTS": "1",
                    "RECORDER_RETRY_DELAY_SECONDS": "0",
                }
            )
            client = FakeClient([SyncNetworkError("connection refused")])

            outcomes = sync_ready_sessions(spool, config, client)

            self.assertEqual(outcomes[0].status, "retry_later")
            self.assertTrue((Path(temp_dir) / "ready" / "retry-later-001").exists())
            self.assertTrue((Path(temp_dir) / "ready" / "retry-later-001" / "last_error.json").exists())


if __name__ == "__main__":
    unittest.main()

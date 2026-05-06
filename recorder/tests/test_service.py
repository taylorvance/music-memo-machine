from pathlib import Path
import tempfile
import unittest

from music_memo_recorder.config import load_config
from music_memo_recorder.service import RecorderService, StatusLight
from music_memo_recorder.spool import RecorderSpool


class RecordingLight(StatusLight):
    def __init__(self) -> None:
        self.states = []

    def set(self, state: str) -> None:
        self.states.append(state)


class ServiceTests(unittest.TestCase):
    def test_mock_audio_record_once_creates_ready_session_with_bookmark(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = load_config(
                {
                    "RECORDER_SPOOL_DIR": temp_dir,
                    "DEVICE_NAME": "unit-test-recorder",
                    "RECORDER_AUDIO_BACKEND": "mock",
                }
            )
            light = RecordingLight()
            service = RecorderService(
                config,
                spool=RecorderSpool(Path(temp_dir)),
                status_light=light,
            )

            ready = service.record_for_duration(0.3, [(0.1, "remember this")])

            manifest = service.spool.read_manifest(ready)
            self.assertEqual(ready.state, "ready")
            self.assertTrue(ready.audio_path.exists())
            self.assertEqual(manifest["device_name"], "unit-test-recorder")
            self.assertEqual(manifest["bookmarks"][0]["note"], "remember this")
            self.assertIn("recording", light.states)
            self.assertEqual(light.states[-1], "ready")


if __name__ == "__main__":
    unittest.main()

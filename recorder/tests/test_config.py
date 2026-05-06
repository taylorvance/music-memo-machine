from pathlib import Path
import unittest

from music_memo_recorder.config import load_config


class ConfigTests(unittest.TestCase):
    def test_load_config_uses_defaults(self) -> None:
        config = load_config({})

        self.assertEqual(config.spool_dir, Path("library/recorder-spool"))
        self.assertEqual(config.manager_url, "http://127.0.0.1:3001")
        self.assertEqual(config.device_name, "music-memo-recorder-1")
        self.assertEqual(config.audio_backend, "mock")
        self.assertEqual(config.gpio_backend, "mock")
        self.assertEqual(config.sync_interval_seconds, 30.0)
        self.assertFalse(config.delete_after_ack)

    def test_load_config_reads_pi_environment(self) -> None:
        config = load_config(
            {
                "RECORDER_SPOOL_DIR": "/var/lib/music-memo-machine/recorder-spool",
                "MANAGER_URL": "http://manager.local:3001",
                "DEVICE_NAME": "practice-room",
                "RECORDER_AUDIO_BACKEND": "arecord",
                "RECORDER_GPIO_BACKEND": "gpiozero",
                "RECORDER_SYNC_ATTEMPTS": "5",
                "RECORDER_RETRY_DELAY_SECONDS": "0.25",
                "RECORDER_SYNC_INTERVAL_SECONDS": "10",
                "RECORDER_DELETE_AFTER_ACK": "true",
                "RECORDER_RECORD_BUTTON_PIN": "5",
                "RECORDER_BOOKMARK_BUTTON_PIN": "6",
                "RECORDER_LED_PIN": "13",
            }
        )

        self.assertEqual(
            config.spool_dir, Path("/var/lib/music-memo-machine/recorder-spool")
        )
        self.assertEqual(config.manager_url, "http://manager.local:3001")
        self.assertEqual(config.device_name, "practice-room")
        self.assertEqual(config.audio_backend, "arecord")
        self.assertEqual(config.gpio_backend, "gpiozero")
        self.assertEqual(config.sync_attempts, 5)
        self.assertEqual(config.retry_delay_seconds, 0.25)
        self.assertEqual(config.sync_interval_seconds, 10.0)
        self.assertTrue(config.delete_after_ack)
        self.assertEqual(config.record_button_pin, 5)
        self.assertEqual(config.bookmark_button_pin, 6)
        self.assertEqual(config.led_pin, 13)


if __name__ == "__main__":
    unittest.main()

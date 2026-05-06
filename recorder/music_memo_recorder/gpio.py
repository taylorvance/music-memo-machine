from __future__ import annotations

from signal import pause
import threading
import time

from .config import RecorderConfig
from .service import RecorderService, StatusLight


class GPIOZeroStatusLight(StatusLight):
    def __init__(self, pin: int) -> None:
        from gpiozero import LED

        self.led = LED(pin)

    def set(self, state: str) -> None:
        if state in {"recording", "bookmark", "syncing"}:
            self.led.on()
        else:
            self.led.off()


def run_gpio_loop(config: RecorderConfig, service: RecorderService) -> None:
    if config.gpio_backend.lower() != "gpiozero":
        raise ValueError("service mode requires RECORDER_GPIO_BACKEND=gpiozero on the Pi")

    from gpiozero import Button

    service.status_light = GPIOZeroStatusLight(config.led_pin)
    record_button = Button(config.record_button_pin, bounce_time=0.08)
    bookmark_button = Button(config.bookmark_button_pin, bounce_time=0.08)
    def toggle_and_sync() -> None:
        was_recording = service.is_recording
        service.toggle_recording()
        if was_recording:
            service.sync_once()

    record_button.when_pressed = toggle_and_sync
    bookmark_button.when_pressed = service.add_bookmark

    def periodic_sync() -> None:
        while True:
            time.sleep(max(1.0, config.sync_interval_seconds))
            if not service.is_recording:
                try:
                    service.sync_once()
                except Exception as error:
                    print(f"periodic sync failed: {error}", flush=True)
                    service.status_light.set("failed")

    sync_thread = threading.Thread(target=periodic_sync, daemon=True)
    sync_thread.start()
    service.status_light.set("idle")
    pause()

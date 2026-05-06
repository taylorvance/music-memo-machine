from __future__ import annotations

from signal import pause
import threading
import time
from typing import cast

from .config import RecorderConfig
from .service import RecorderService, StatusLight


class GPIOZeroStatusLight(StatusLight):
    def __init__(self, pin: int, visibility_seconds: float) -> None:
        from gpiozero import LED

        self.led = LED(pin)
        self.visibility_seconds = visibility_seconds
        self.state = "idle"
        self._wake_timer: threading.Timer | None = None

    def _cancel_wake_timer(self) -> None:
        if self._wake_timer is not None:
            self._wake_timer.cancel()
            self._wake_timer = None

    def _apply_state(self, state: str) -> None:
        if state in {"recording", "bookmark", "syncing"}:
            self.led.on()
        else:
            self.led.off()

    def set(self, state: str) -> None:
        self.state = state
        self._cancel_wake_timer()
        self._apply_state(state)

    def wake(self) -> None:
        self._cancel_wake_timer()
        self.led.on()
        if self.visibility_seconds <= 0:
            self._apply_state(self.state)
            return

        def restore() -> None:
            self._wake_timer = None
            self._apply_state(self.state)

        self._wake_timer = threading.Timer(self.visibility_seconds, restore)
        self._wake_timer.daemon = True
        self._wake_timer.start()


def run_gpio_loop(config: RecorderConfig, service: RecorderService) -> None:
    if config.gpio_backend.lower() != "gpiozero":
        raise ValueError("service mode requires RECORDER_GPIO_BACKEND=gpiozero on the Pi")

    from gpiozero import Button

    service.status_light = GPIOZeroStatusLight(
        config.led_pin,
        config.status_visibility_seconds,
    )
    gpio_status_light = cast(GPIOZeroStatusLight, service.status_light)
    record_button = Button(config.record_button_pin, bounce_time=0.08)
    bookmark_button = Button(config.bookmark_button_pin, bounce_time=0.08)
    sync_in_progress = threading.Event()

    def perform_sync() -> None:
        if sync_in_progress.is_set():
            return
        sync_in_progress.set()
        try:
            service.sync_once()
        finally:
            sync_in_progress.clear()

    def toggle_and_sync() -> None:
        was_recording = service.is_recording
        if not was_recording:
            if sync_in_progress.is_set():
                gpio_status_light.wake()
                return
            gpio_status_light.wake()
            service.toggle_recording()
            return
        service.stop_recording()
        if was_recording:
            perform_sync()

    record_button.when_pressed = toggle_and_sync

    def bookmark_pressed() -> None:
        if service.is_recording:
            service.add_bookmark()
            return
        gpio_status_light.wake()
        service.add_bookmark()

    bookmark_button.when_pressed = bookmark_pressed

    def periodic_sync() -> None:
        while True:
            time.sleep(max(1.0, config.sync_interval_seconds))
            if service.is_recording or sync_in_progress.is_set():
                continue
            try:
                perform_sync()
            except Exception as error:
                print(f"periodic sync failed: {error}", flush=True)
                service.status_light.set("failed")

    sync_thread = threading.Thread(target=periodic_sync, daemon=True)
    sync_thread.start()
    service.status_light.set("idle")
    pause()

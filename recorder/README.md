# Pi Recorder

This package contains the Raspberry Pi recorder service. It is intentionally
small and testable without Pi hardware: GPIO and audio capture are adapters,
while session IDs, spool state, multipart manager sync, and compatibility
payload creation are plain Python.

Run the local tests from the repo root:

```bash
PYTHONPATH=recorder python3 -m unittest discover recorder/tests
```

Create a mock recording and leave it in the local spool:

```bash
PYTHONPATH=recorder python3 -m music_memo_recorder record-once --duration 3 --bookmark 1.2:test
```

Sync ready sessions to a running manager:

```bash
PYTHONPATH=recorder MANAGER_URL=http://127.0.0.1:3001 python3 -m music_memo_recorder sync-once
```

On a Pi, the systemd service should run with:

```bash
RECORDER_AUDIO_BACKEND=arecord
RECORDER_GPIO_BACKEND=gpiozero
```

See `docs/deployment.md` for bootstrap and service installation details.

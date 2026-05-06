# Recorder Emulator

The recorder emulator is a browser surface inside the management app. It is meant to feel like the planned hardware recorder before the Pi service exists.

## Browser Emulator

Start the manager and web app:

```bash
npm run dev
```

Open the Vite URL, usually `http://127.0.0.1:5173`, then choose `Emulator` in the top navigation.

Current behavior:

- Captures audio from the browser microphone.
- Uses icon-only record/stop/bookmark buttons that feel closer to hardware.
- Shows virtual red and blue status LEDs that follow the planned hardware
  contract: red for recording/failure bursts, blue for sync/server state.
  The blue light stays bright while the recorder is active, then sleeps after
  the visibility timeout so idle glare does not carry the signal.
- Pressing bookmark while idle only wakes the status LEDs; it does not create
  a bookmark unless recording is already active.
- Encodes the captured microphone audio as a WAV in the browser.
- Automatically submits the WAV and metadata as multipart form data through
  `POST /api/ingest/sessions` after recording stops.
- Refreshes the library after sync and provides a direct review action.

Browser microphone access requires a secure context. Localhost works for normal development.

## CLI Harness

The CLI harness remains useful for deterministic sync tests, payload replay, and duplicate acknowledgement checks. Generated or replayed sessions are submitted to the manager as multipart form data. Saved payload files remain JSON/base64 so they can be inspected and replayed.

Generate and submit a short fake recording:

```bash
npm run emulator:cli -- --duration 8 --bookmark 2.5 --bookmark 6:ending
```

Use an existing WAV:

```bash
npm run emulator:cli -- --audio ./take.wav --bookmark 12 --title "Morning idea"
```

Write a payload without syncing:

```bash
npm run emulator:cli -- --dry-run --write-payload library/recorder-spool/demo.json
```

Replay that exact payload later:

```bash
npm run emulator:cli -- --payload library/recorder-spool/demo.json
```

Submit the same payload twice to exercise idempotent acknowledgement:

```bash
npm run emulator:cli -- --duration 4 --bookmark 1.2 --submit-count 2
```

Run `npm run emulator:cli -- --help` for the full option list.

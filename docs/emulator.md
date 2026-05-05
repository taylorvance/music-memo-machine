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
- Uses record/stop/bookmark buttons.
- Shows a virtual status light for idle, arming, recording, ready to sync, syncing, synced, and failed states.
- Encodes the captured microphone audio as a WAV in the browser.
- Submits through `POST /api/ingest/sessions`.
- Refreshes the library after sync and provides a direct review action.

Browser microphone access requires a secure context. Localhost works for normal development.

## CLI Harness

The CLI harness remains useful for deterministic sync tests, payload replay, and duplicate acknowledgement checks.

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

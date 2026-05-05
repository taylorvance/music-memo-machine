# Recorder Emulator

The recorder emulator is a scriptable stand-in for the future Pi recorder. It generates or replays complete recorder sessions and submits them through the same manager ingestion endpoint the hardware recorder will use.

## Basic Use

Start the manager first:

```bash
npm run dev
```

Generate and submit a short fake recording:

```bash
npm run emulator -- --duration 8 --bookmark 2.5 --bookmark 6:ending
```

Use an existing WAV instead of generated audio:

```bash
npm run emulator -- --audio ./take.wav --bookmark 12 --title "Morning idea"
```

Target a different manager:

```bash
npm run emulator -- --manager-url http://music-memo-manager:3001
```

## Retry And Duplicate Scenarios

Write a payload without syncing:

```bash
npm run emulator -- --dry-run --write-payload library/recorder-spool/demo.json
```

Replay that exact payload later:

```bash
npm run emulator -- --payload library/recorder-spool/demo.json
```

Submit the same payload twice to exercise idempotent acknowledgement:

```bash
npm run emulator -- --duration 4 --bookmark 1.2 --submit-count 2
```

The first submit should import the session. The second submit should return a duplicate acknowledgement without overwriting manager-side edits.

## Useful Options

- `--id <id>`: use a stable session ID.
- `--device-name <name>`: set recorder identity. Defaults to `DEVICE_NAME` or `recorder-emulator`.
- `--duration <seconds>`: generated recording duration. Defaults to `6`.
- `--bookmark <sec[:note]>`: add a bookmark. Repeat for multiple bookmarks.
- `--payload <path>`: submit an existing ingest payload JSON.
- `--write-payload <path>`: save the generated ingest payload before syncing.
- `--dry-run`: build/write payload only.
- `--submit-count <count>`: submit the same payload multiple times.
- `--sync-attempts <count>`: retry transient sync failures for each submit.
- `--json`: print machine-readable output.

Run `npm run emulator -- --help` for the full option list.

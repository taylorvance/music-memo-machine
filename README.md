# Music Memo Machine

Music Memo Machine is a low-friction system for capturing rough music ideas and turning the useful parts into saved memos. The intended product is a small always-available recorder near an instrument, paired with a local web app for review, trimming, storage management, and cleanup.

This repo currently contains the management/review prototype, a browser-based recorder emulator, and the first Python Raspberry Pi recorder service. The recorder service is testable without Pi hardware and uses adapters for GPIO and audio capture.

## Current Status

- React/Vite review UI for sessions, bookmarks, clips, trash, storage pressure simulation, and timeline transport hotkeys.
- Browser recorder emulator with microphone capture, icon-only record/stop/bookmark controls, scoped record/bookmark hotkeys, virtual red/blue status LEDs, WAV encoding, and automatic manager sync.
- Express API for session metadata, clip creation, trash/restore, and storage actions.
- Manager-side multipart ingestion endpoint for recorder/emulator WAV imports, with JSON/base64 compatibility for small saved payloads.
- CLI recorder test harness for generated WAV sessions, payload replay, and duplicate-submit testing.
- Python Pi recorder service with mock and `arecord` audio backends, optional `gpiozero` button/LED wiring, local spool state, sync retries, and unit tests.
- Pi bootstrap/service installer scripts and a checked-in systemd unit template.
- Local library layout with session WAVs, clip WAVs, manager-generated waveform caches, JSON sidecars, and SQLite metadata.
- Fixture generator for realistic prototype data.
- Node integration tests for API behavior and metadata persistence.
- Shared `tv-shared` dev conventions for linting, formatting, TypeScript baselines, and CI verification.

Not built yet:

- Hardware smoke-tested Pi wiring and microphone capture.
- Silence auto-stop.
- Manager deploy script and richer health checks.
- Recorder-side storage policy for deleting acknowledged local audio.

## Quick Start

Requirements:

- Node.js with `node:sqlite` support. This project is currently tested locally with Node `v25.x`.
- npm.
- Python 3.11+ for recorder service tests and local recorder commands.

Install dependencies:

```bash
npm ci
```

Seed the local fixture library:

```bash
npm run seed
```

Run the API and web app in development:

```bash
npm run dev
```

The API listens on `http://127.0.0.1:3001`. Vite prints the web URL, usually `http://127.0.0.1:5173`.

Run tests:

```bash
npm test
```

Run only the Python recorder tests:

```bash
npm run test:recorder
```

Open the recorder emulator from the top navigation in the web app. The browser may prompt for microphone access.

Run the full local quality gate:

```bash
npm run verify
```

Build and run the production server locally:

```bash
npm run build
NODE_ENV=production node server/index.js
```

By default, the library lives in `library/`, which is intentionally gitignored. Set `LIBRARY_DIR` to store data elsewhere:

```bash
LIBRARY_DIR=/var/lib/music-memo-machine/library npm run dev
```

Recorder/emulator session ingestion prefers multipart WAV upload with a default `512mb` file limit. Set `AUDIO_UPLOAD_LIMIT_BYTES` if longer local recordings need more room:

```bash
AUDIO_UPLOAD_LIMIT_BYTES=1073741824 npm run dev
```

The compatibility JSON/base64 path still exists for small saved payloads and defaults to a `32mb` request limit. Set `JSON_BODY_LIMIT` if local test payloads need more room:

```bash
JSON_BODY_LIMIT=64mb npm run dev
```

## Scripts

- `npm run dev`: start the API and Vite dev server on localhost.
- `npm run dev:lan`: start both servers bound to `0.0.0.0` for LAN testing.
- `npm run lint`: run ESLint with the shared `tv-shared` React app config plus local Node overrides.
- `npm run test`: run Node integration tests and Python recorder unit tests.
- `npm run test:node`: run only Node integration tests.
- `npm run test:recorder`: run only Python recorder unit tests.
- `npm run test:watch`: run Node integration tests in watch mode.
- `npm run build`: typecheck and build the web UI into `dist/`.
- `npm run verify`: run lint, tests, and build.
- `npm run clean`: remove installed dependencies and reproducible build/cache artifacts.
- `npm run preview`: run the Express server in production mode.
- `npm run seed` / `npm run reset`: regenerate fixture sessions and clips.
- `npm run emulator:cli`: generate or replay recorder payloads through the manager ingestion endpoint.

Pi deployment helpers:

- `scripts/bootstrap-pi.sh`: first-boot Raspberry Pi setup for packages, service user, data directories, repo checkout, and recorder service installation. Use `--install-node-deps` when the Pi also needs manager dependencies installed.
- `scripts/install-recorder-service.sh`: install or update the recorder systemd service from an existing checkout.

## Repo Layout

- `SPEC.md`: product spec and design notes.
- `docs/ROADMAP.md`: implementation priorities and active planning context.
- `docs/deployment.md`: intended Pi/manager deployment strategy.
- `docs/emulator.md`: recorder emulator usage and sync/idempotency scenarios.
- `docs/ingestion.md`: manager session import contract for the emulator and recorder.
- `server/`: Express API and metadata store.
- `src/`: React review UI.
- `scripts/`: fixture, emulator, bootstrap, and service installation scripts.
- `recorder/`: Python Raspberry Pi recorder service, adapters, spool/sync logic, CLI, and tests.
- `systemd/`: service unit templates for Pi deployment.
- `tests/`: Node integration tests.
- `.github/workflows/`: thin wrappers around reusable `tv-shared` workflow logic.
- `library/`: local generated media/metadata data, ignored by git.

## Architecture Direction

The project is expected to split into three cooperating surfaces:

- Management app: durable library, review UI, clipping, trash, storage policy, and sync acknowledgement.
- Recorder app: Pi-side capture service with record/stop, bookmark, LED state, silence auto-stop, local spool, and safe automatic sync to the manager.
- Recorder emulator: local test tool that produces recorder-like sessions without physical hardware, so sync and review workflows can be iterated quickly.

See `docs/ROADMAP.md` and `docs/deployment.md` before making architecture or deployment changes.

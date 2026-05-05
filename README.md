# Music Memo Machine

Music Memo Machine is a low-friction system for capturing rough music ideas and turning the useful parts into saved memos. The intended product is a small always-available recorder near an instrument, paired with a local web app for review, trimming, storage management, and cleanup.

This repo currently contains the management/review prototype. The physical recorder, recorder emulator, deployment scripts, and sync lifecycle are still roadmap items.

## Current Status

- React/Vite review UI for sessions, bookmarks, clips, trash, and storage pressure simulation.
- Express API for session metadata, clip creation, trash/restore, and storage actions.
- Local library layout with session WAVs, clip WAVs, waveform caches, JSON sidecars, and SQLite metadata.
- Fixture generator for realistic prototype data.
- Node integration tests for API behavior and metadata persistence.
- Shared `tv-shared` dev conventions for linting, formatting, TypeScript baselines, and CI verification.

Not built yet:

- Raspberry Pi recorder service.
- Minimal recorder emulator app for testing capture/sync without hardware.
- Real microphone capture, GPIO buttons, status LED, and silence auto-stop.
- Automated Pi bootstrap/deploy scripts.
- Durable recorder-to-manager sync and post-ack deletion policy.

## Quick Start

Requirements:

- Node.js with `node:sqlite` support. This project is currently tested locally with Node `v25.x`.
- npm.

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

## Scripts

- `npm run dev`: start the API and Vite dev server on localhost.
- `npm run dev:lan`: start both servers bound to `0.0.0.0` for LAN testing.
- `npm run lint`: run ESLint with the shared `tv-shared` React app config plus local Node overrides.
- `npm run test`: run Node integration tests.
- `npm run test:watch`: run Node integration tests in watch mode.
- `npm run build`: typecheck and build the web UI into `dist/`.
- `npm run verify`: run lint, tests, and build.
- `npm run clean`: remove installed dependencies and reproducible build/cache artifacts.
- `npm run preview`: run the Express server in production mode.
- `npm run seed` / `npm run reset`: regenerate fixture sessions and clips.

## Repo Layout

- `SPEC.md`: product spec and design notes.
- `docs/ROADMAP.md`: implementation priorities and active planning context.
- `docs/deployment.md`: intended Pi/manager deployment strategy.
- `server/`: Express API and metadata store.
- `src/`: React review UI.
- `scripts/`: fixture and future automation scripts.
- `tests/`: Node integration tests.
- `.github/workflows/`: thin wrappers around reusable `tv-shared` workflow logic.
- `library/`: local generated media/metadata data, ignored by git.

## Architecture Direction

The project is expected to split into three cooperating surfaces:

- Management app: durable library, review UI, clipping, trash, storage policy, and sync acknowledgement.
- Recorder app: Pi-side capture service with record/stop, bookmark, LED state, silence auto-stop, local spool, and safe sync to the manager.
- Recorder emulator: local test tool that produces recorder-like sessions without physical hardware, so sync and review workflows can be iterated quickly.

See `docs/ROADMAP.md` and `docs/deployment.md` before making architecture or deployment changes.

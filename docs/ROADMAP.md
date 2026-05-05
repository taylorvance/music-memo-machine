# Roadmap

This file is the working memory for implementation priorities. Update it when project direction, near-term sequencing, or deployment assumptions change.

## Product Principles

- Capture should be thoughtless: one action to start/stop, one action to bookmark.
- Review should be fast enough that long recordings do not become a chore.
- The recorder must protect unsynced or durable material before freeing local space.
- The first useful system should be simple and scriptable before it is polished.
- Flashing a Pi SD card should be a rare one-time setup step; iteration after first boot should happen through deploy scripts.

## Current Baseline

The management/review prototype exists:

- Fixture-backed sessions and clips.
- Review UI with waveform, bookmarks, range selection, clip saving, metadata edits, trash/restore, and storage simulation.
- Express API with SQLite metadata plus sidecar JSON files.
- Manager ingestion endpoint for complete recorder/emulator WAV session imports with idempotent acknowledgement.
- Integration tests for important API behavior.
- Shared `tv-shared` lint, formatting, TypeScript, and CI verification conventions.

The recorder side does not exist yet. Real capture, GPIO controls, LED state, silence auto-stop, recorder-side sync retries, post-ack deletion, and deployment automation are still open.

## Near-Term Priorities

1. Keep the management app useful as the canonical review target.
   - Stabilize the session and clip metadata contract.
   - Make library paths and production startup predictable.
   - Keep the JSON/base64 import endpoint aligned with `docs/ingestion.md`.
   - Add multipart upload or a spool watcher if longer recordings outgrow JSON import.
   - Keep tests around metadata persistence, trimming, trash, and storage safety.

2. Add a minimal recorder emulator app for testing.
   - Simulate record/stop/bookmark without Pi hardware.
   - Generate short WAV sessions or accept a local audio file.
   - Submit sessions through `POST /api/ingest/sessions`.
   - Exercise bookmark timing, sync retries, idempotency, and manager ingestion.
   - Keep it intentionally small so it can be used during normal development.

3. Define and automate deployment.
   - Add a fresh-device bootstrap script for a Raspberry Pi or similar host.
   - Add an iterative deploy script that pulls the repo, installs dependencies, builds, restarts services, and checks health.
   - Run the management app as a systemd service with data outside the git checkout.
   - Use Tailscale or another private network so the manager and recorder can reach each other reliably.

4. Build the real recorder app after the ingestion contract is stable.
   - Record/stop toggle.
   - Bookmark button.
   - Recording LED state.
   - Local session spool.
   - Silence auto-stop.
   - Durable sync to the management app.
   - Deletion only after manager acknowledgement.

## Later Work

- Rolling pre-buffer once the explicit-recording workflow is proven.
- Real compression jobs for archival and throwaway recordings.
- Storage policy backed by actual disk stats instead of simulation.
- Optional all-in-one recorder/reviewer deployment.
- Better hardware enclosure and status display.
- Optional phone-friendly recorder flow if it can stay as frictionless as the appliance.

## Open Decisions

- When to replace or supplement JSON/base64 ingestion with multipart upload, spool directory import, rsync-style sync, or a hybrid.
- Whether the manager runs primarily on a Mac mini, a Pi, or either.
- Audio capture stack for the Pi recorder.
- Node version target for Pi deployment.
- How much metadata the recorder owns before manager acknowledgement.
- How the emulator should be exposed: CLI, tiny web app, or both.

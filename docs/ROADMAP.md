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
- Browser recorder emulator with microphone capture, record/stop/bookmark controls, a virtual status light, WAV encoding, and manager sync.
- Express API with SQLite metadata plus sidecar JSON files.
- Manager ingestion endpoint for complete recorder/emulator WAV session imports with multipart upload, idempotent acknowledgement, and manager-generated waveform caches.
- CLI recorder test harness that can generate WAV sessions, add bookmarks, save/replay payloads, and submit duplicate retries.
- Python Pi recorder service with mock and `arecord` audio adapters, optional `gpiozero` button/LED wiring, local spool state, idempotent sync retries, and unit tests.
- Initial Pi bootstrap/service installer scripts plus a systemd unit template.
- Integration tests for important API behavior.
- Shared `tv-shared` lint, formatting, TypeScript, and CI verification conventions.

The recorder side now has a testable first implementation. Hardware smoke testing, exact pin/microphone validation, silence auto-stop, storage-aware post-ack deletion, and richer deployment health checks are still open.

## Near-Term Priorities

1. Keep the management app useful as the canonical review target.
   - Stabilize the session and clip metadata contract.
   - Make library paths and production startup predictable.
   - Keep the multipart import endpoint aligned with `docs/ingestion.md`.
   - Keep JSON/base64 import as a small-payload compatibility path only.
   - Add a spool watcher if later deployments need direct filesystem import.
   - Keep tests around metadata persistence, trimming, trash, and storage safety.

2. Use the recorder emulator to harden recorder-to-manager behavior.
   - Keep the web emulator close to the planned hardware flow: record, bookmark, status light, sync, then review.
   - Keep the CLI harness intentionally small for repeatable sync/idempotency scenarios.
   - Add scenarios only when they clarify the real recorder contract.
   - Use saved payload replay and `--submit-count 2` in the CLI harness to test sync retry and idempotency behavior.

3. Harden deployment automation.
   - Validate `scripts/bootstrap-pi.sh` and `scripts/install-recorder-service.sh` on a fresh Raspberry Pi OS Lite image.
   - Add an iterative deploy script that pulls the repo, installs dependencies, builds, restarts services, and checks health.
   - Run the management app as a systemd service with data outside the git checkout.
   - Use Tailscale or another private network so the manager and recorder can reach each other reliably.

4. Harden the real recorder app.
   - Hardware smoke-test record/stop, bookmark, and LED behavior on the selected Pi.
   - Confirm `arecord` device selection and sample format with the real microphone.
   - Add silence auto-stop.
   - Add a storage-aware policy for deleting acknowledged local audio.
   - Keep durable sync retries and conflict preservation covered by tests.

## Later Work

- Rolling pre-buffer once the explicit-recording workflow is proven.
- Real compression jobs for archival and throwaway recordings.
- Storage policy backed by actual disk stats instead of simulation.
- Optional all-in-one recorder/reviewer deployment.
- Better hardware enclosure and status display.
- Optional phone-friendly recorder flow if it can stay as frictionless as the appliance.

## Open Decisions

- Whether multipart ingest is enough for deployed recorders or should be supplemented with spool-directory import, rsync-style sync, or a hybrid.
- Whether the manager runs primarily on a Mac mini, a Pi, or either.
- Whether the first `arecord` capture path is enough or should move to a richer ALSA/PipeWire/Python audio stack.
- Node version target for Pi deployment.
- How much metadata the recorder owns before manager acknowledgement.
- Whether the browser emulator should add silence auto-stop before hardware work.

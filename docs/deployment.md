# Deployment Strategy

The deployment goal is repeatable iteration after a small amount of one-time device setup. Avoid custom SD card images until fresh-device rebuilds become common enough to justify that extra machinery.

## Target Shape

- Management app runs on a stable host, likely a Mac mini or Raspberry Pi, reachable over Tailscale or LAN.
- Recorder app runs as a Python service on a Raspberry Pi near the instrument.
- Recorder writes session audio and metadata to a local spool first.
- Manager ingests complete session payloads through `POST /api/ingest/sessions` and durably acknowledges them.
- Recorder keeps local copies by default. It can delete local audio only after the manager has acknowledged transfer, and a storage-aware deletion policy is still a later hardening step.

## One-Time Pi Setup

Use Raspberry Pi Imager for the first boot:

- Raspberry Pi OS Lite.
- User account configured.
- SSH enabled.
- Wi-Fi configured if not using Ethernet.
- Hostname set, for example `music-memo-recorder-1`.

After first boot:

- Install Tailscale and join the tailnet.
- Install Node.js, npm, git, Python, and audio/GPIO system packages.
- Clone `https://github.com/taylorvance/music-memo-machine.git` into a deploy-only checkout such as `/opt/music-memo-machine`.
- Create persistent data directories outside the checkout:
  - `/var/lib/music-memo-machine/library`
  - `/var/lib/music-memo-machine/recorder-spool`
- Create environment files under `/etc/music-memo-machine/`.

The initial version is `scripts/bootstrap-pi.sh`. It installs Node/npm, Python, `alsa-utils`, `python3-gpiozero`, `python3-lgpio`, creates the `musicmemo` service user, creates persistent directories, writes a starter recorder environment file, clones the repo, and installs the recorder service. Pass `--install-node-deps` if the same Pi also needs the Node manager dependencies installed during bootstrap.

## Management Service

Run the management app with systemd in production mode after `npm run build`.

Example environment file:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
LIBRARY_DIR=/var/lib/music-memo-machine/library
TRASH_RETENTION_DAYS=14
```

Example service shape:

```ini
[Unit]
Description=Music Memo Machine manager
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/music-memo-machine
EnvironmentFile=/etc/music-memo-machine/manager.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
User=musicmemo
Group=musicmemo

[Install]
WantedBy=multi-user.target
```

The production server serves API routes and, when `dist/` exists, the built web UI.

## Iterative Deploy

The common edit/test/deploy loop should be a script, not a checklist. The first deploy script should target a deploy-only checkout and do roughly this:

1. SSH to the host.
2. Move to `/opt/music-memo-machine`.
3. Pull the configured branch with `git pull --ff-only`.
4. Run `npm ci`.
5. Run `npm run build`.
6. Restart the relevant systemd service.
7. Check `/api/health`.

This should become `scripts/deploy-pi.sh <host>` for the manager. A recorder deploy script can share most of the same mechanics once the recorder service exists.

## Recorder Service

The recorder service lives in `recorder/` and runs as its own systemd service. The checked-in template is `systemd/music-memo-recorder.service`; install it with:

```bash
scripts/install-recorder-service.sh --install-dir /opt/music-memo-machine
```

The service uses a local spool directory and this environment shape:

```dotenv
RECORDER_SPOOL_DIR=/var/lib/music-memo-machine/recorder-spool
MANAGER_URL=http://music-memo-manager:3001
DEVICE_NAME=music-memo-recorder-1
RECORDER_AUDIO_BACKEND=arecord
RECORDER_GPIO_BACKEND=gpiozero
RECORDER_SYNC_INTERVAL_SECONDS=30
RECORDER_DELETE_AFTER_ACK=false
RECORDER_RECORD_BUTTON_PIN=17
RECORDER_BOOKMARK_BUTTON_PIN=27
RECORDER_LED_PIN=22
```

Current responsibilities:

- Own microphone capture through `arecord`.
- Own GPIO button and LED state through `gpiozero`.
- Write complete session artifacts locally before attempting sync.
- Retry `POST /api/ingest/sessions` safely until the manager acknowledges import or an exact duplicate.
- Track manager acknowledgement.
- Preserve conflicts and failed imports in the spool for inspection.
- Never delete local audio before manager acknowledgement. By default, acknowledged audio is also kept unless `RECORDER_DELETE_AFTER_ACK=true`.

Run the recorder unit tests without hardware:

```bash
npm run test:recorder
```

## Recorder Emulator

The browser emulator is available from the web app top navigation. It gives the manager app realistic input without flashing a Pi or wiring hardware.

Current behavior:

- Record from the browser microphone.
- Use record/stop/bookmark controls and a virtual status light.
- Encode the captured audio as WAV.
- Submit that session through `POST /api/ingest/sessions`.
- Jump directly into review after manager acknowledgement.

The CLI harness remains available as `npm run emulator:cli` for saved payload replay and duplicate-submit testing.

See `docs/emulator.md` for usage.

## When to Add Heavier Tooling

Use shell scripts first. Move to Ansible, cloud-init, or custom image generation only when one-time setup repeats often enough that the scripts are no longer sufficient.

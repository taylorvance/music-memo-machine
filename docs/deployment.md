# Deployment Strategy

The deployment goal is repeatable iteration after a small amount of one-time device setup. Avoid custom SD card images until fresh-device rebuilds become common enough to justify that extra machinery.

## Target Shape

- Management app runs on a stable host, likely a Mac mini or Raspberry Pi, reachable over Tailscale or LAN.
- Recorder app runs on a Raspberry Pi near the instrument.
- Recorder writes session audio and metadata to a local spool first.
- Manager ingests sessions and durably acknowledges them.
- Recorder deletes local copies only after the manager has acknowledged transfer and storage policy allows it.

## One-Time Pi Setup

Use Raspberry Pi Imager for the first boot:

- Raspberry Pi OS Lite.
- User account configured.
- SSH enabled.
- Wi-Fi configured if not using Ethernet.
- Hostname set, for example `music-memo-recorder-1`.

After first boot:

- Install Tailscale and join the tailnet.
- Install Node.js, npm, git, and audio/GPIO system packages.
- Clone `https://github.com/taylorvance/music-memo-machine.git` into a deploy-only checkout such as `/opt/music-memo-machine`.
- Create persistent data directories outside the checkout:
  - `/var/lib/music-memo-machine/library`
  - `/var/lib/music-memo-machine/recorder-spool`
- Create environment files under `/etc/music-memo-machine/`.

This should become `scripts/bootstrap-pi.sh` once the exact package list is known.

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

The recorder service is not built yet. It should eventually run as its own systemd service and use a local spool directory:

```dotenv
RECORDER_SPOOL_DIR=/var/lib/music-memo-machine/recorder-spool
MANAGER_URL=http://music-memo-manager:3001
DEVICE_NAME=music-memo-recorder-1
```

Expected responsibilities:

- Own microphone capture.
- Own GPIO button and LED state.
- Write complete session artifacts locally before attempting sync.
- Retry sync safely.
- Track manager acknowledgement.
- Never delete unsynced or acknowledged-durable material accidentally.

## Recorder Emulator

The emulator should arrive before the hardware recorder. It gives the manager app realistic input without flashing a Pi or wiring hardware.

Minimum useful behavior:

- Start/stop a fake recording.
- Add bookmarks during the fake recording.
- Generate a short WAV file and session metadata.
- Submit or import that session through the same path the real recorder will use.
- Support repeatable test scenarios for sync failure and duplicate submission.

## When to Add Heavier Tooling

Use shell scripts first. Move to Ansible, cloud-init, or custom image generation only when one-time setup repeats often enough that the scripts are no longer sufficient.

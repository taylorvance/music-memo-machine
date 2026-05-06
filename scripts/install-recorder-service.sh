#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/music-memo-machine}"
SERVICE_USER="${SERVICE_USER:-musicmemo}"
START_SERVICE=1
DRY_RUN=0

usage() {
  cat <<'USAGE'
Install or update the Music Memo Machine recorder systemd service.

Usage:
  scripts/install-recorder-service.sh [--dry-run] [--install-dir PATH] [--user NAME] [--no-start]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --user)
      SERVICE_USER="$2"
      shift 2
      ;;
    --no-start)
      START_SERVICE=0
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '+'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

run_root() {
  if [[ "$EUID" -eq 0 ]]; then
    run "$@"
  else
    run sudo "$@"
  fi
}

write_default_env() {
  local env_path="/etc/music-memo-machine/recorder.env"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "+ create $env_path if missing"
    return
  fi
  if [[ -f "$env_path" ]]; then
    return
  fi
  if [[ "$EUID" -eq 0 ]]; then
    cat >"$env_path" <<'ENV'
RECORDER_SPOOL_DIR=/var/lib/music-memo-machine/recorder-spool
MANAGER_URL=http://music-memo-manager:3001
DEVICE_NAME=music-memo-recorder-1
RECORDER_AUDIO_BACKEND=arecord
RECORDER_GPIO_BACKEND=gpiozero
RECORDER_SYNC_INTERVAL_SECONDS=30
RECORDER_STATUS_VISIBILITY_SECONDS=30
RECORDER_DELETE_AFTER_ACK=false
RECORDER_RECORD_BUTTON_PIN=17
RECORDER_BOOKMARK_BUTTON_PIN=27
RECORDER_LED_PIN=22
ENV
  else
    sudo tee "$env_path" >/dev/null <<'ENV'
RECORDER_SPOOL_DIR=/var/lib/music-memo-machine/recorder-spool
MANAGER_URL=http://music-memo-manager:3001
DEVICE_NAME=music-memo-recorder-1
RECORDER_AUDIO_BACKEND=arecord
RECORDER_GPIO_BACKEND=gpiozero
RECORDER_SYNC_INTERVAL_SECONDS=30
RECORDER_STATUS_VISIBILITY_SECONDS=30
RECORDER_DELETE_AFTER_ACK=false
RECORDER_RECORD_BUTTON_PIN=17
RECORDER_BOOKMARK_BUTTON_PIN=27
RECORDER_LED_PIN=22
ENV
  fi
}

if [[ ! -f "$INSTALL_DIR/systemd/music-memo-recorder.service" ]]; then
  echo "Missing service template: $INSTALL_DIR/systemd/music-memo-recorder.service" >&2
  exit 1
fi

run_root mkdir -p /etc/music-memo-machine
run_root mkdir -p /var/lib/music-memo-machine/recorder-spool
run_root chown -R "$SERVICE_USER:$SERVICE_USER" /var/lib/music-memo-machine
write_default_env

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "+ install /etc/systemd/system/music-memo-recorder.service from template"
else
  if [[ "$EUID" -eq 0 ]]; then
    sed \
      -e "s#/opt/music-memo-machine#$INSTALL_DIR#g" \
      -e "s#User=musicmemo#User=$SERVICE_USER#g" \
      -e "s#Group=musicmemo#Group=$SERVICE_USER#g" \
      "$INSTALL_DIR/systemd/music-memo-recorder.service" \
      >/etc/systemd/system/music-memo-recorder.service
  else
    sed \
      -e "s#/opt/music-memo-machine#$INSTALL_DIR#g" \
      -e "s#User=musicmemo#User=$SERVICE_USER#g" \
      -e "s#Group=musicmemo#Group=$SERVICE_USER#g" \
      "$INSTALL_DIR/systemd/music-memo-recorder.service" \
      | sudo tee /etc/systemd/system/music-memo-recorder.service >/dev/null
  fi
fi

run_root systemctl daemon-reload
run_root systemctl enable music-memo-recorder.service
if [[ "$START_SERVICE" -eq 1 ]]; then
  run_root systemctl restart music-memo-recorder.service
fi
run_root systemctl status --no-pager music-memo-recorder.service

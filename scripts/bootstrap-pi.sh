#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/taylorvance/music-memo-machine.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/music-memo-machine}"
SERVICE_USER="${SERVICE_USER:-musicmemo}"
INSTALL_NODE_DEPS=0
DRY_RUN=0

usage() {
  cat <<'USAGE'
Bootstrap a Raspberry Pi for Music Memo Machine.

Usage:
  scripts/bootstrap-pi.sh [--dry-run] [--repo-url URL] [--install-dir PATH] [--user NAME] [--install-node-deps]

Environment overrides:
  REPO_URL, INSTALL_DIR, SERVICE_USER
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --repo-url)
      REPO_URL="$2"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --user)
      SERVICE_USER="$2"
      shift 2
      ;;
    --install-node-deps)
      INSTALL_NODE_DEPS=1
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

run_service_user() {
  local current_user
  current_user="$(id -un)"
  if [[ "$current_user" == "$SERVICE_USER" ]]; then
    run "$@"
  else
    run sudo -u "$SERVICE_USER" "$@"
  fi
}

write_env_file() {
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
RECORDER_DELETE_AFTER_ACK=false
RECORDER_RECORD_BUTTON_PIN=17
RECORDER_BOOKMARK_BUTTON_PIN=27
RECORDER_LED_PIN=22
ENV
  fi
}

run_root apt-get update
run_root apt-get install -y \
  alsa-utils \
  git \
  libgpiod2 \
  nodejs \
  npm \
  python3 \
  python3-gpiozero \
  python3-lgpio \
  python3-pip \
  python3-venv

if id "$SERVICE_USER" >/dev/null 2>&1; then
  run_root usermod -a -G audio,gpio "$SERVICE_USER"
else
  run_root useradd --system --create-home --groups audio,gpio --shell /usr/sbin/nologin "$SERVICE_USER"
fi

run_root mkdir -p /etc/music-memo-machine
run_root mkdir -p /var/lib/music-memo-machine/library
run_root mkdir -p /var/lib/music-memo-machine/recorder-spool
run_root chown -R "$SERVICE_USER:$SERVICE_USER" /var/lib/music-memo-machine
write_env_file

if [[ -d "$INSTALL_DIR/.git" ]]; then
  run_service_user git -C "$INSTALL_DIR" pull --ff-only
else
  run_root git clone "$REPO_URL" "$INSTALL_DIR"
  run_root chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
fi

if [[ "$INSTALL_NODE_DEPS" -eq 1 ]]; then
  run_service_user npm ci --prefix "$INSTALL_DIR"
fi
run "$INSTALL_DIR/scripts/install-recorder-service.sh" --install-dir "$INSTALL_DIR" --user "$SERVICE_USER"

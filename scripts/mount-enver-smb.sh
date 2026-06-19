#!/usr/bin/env bash
# Монтує SMB-шари KDTsaw та Log з NAS 192.168.1.203 на Linux-хості.
# Викликається з deploy.sh перед docker compose up.
#
# У /opt/enver/.env:
#   SMB_HOST=192.168.1.203
#   SMB_USER=crm
#   SMB_PASSWORD=...
#   KDT_LOG_MOUNT=/mnt/kdtsaw
#   ENVER_LOG_MOUNT=/mnt/enver-log

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-/opt/enver/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
elif [[ -f "$SCRIPT_DIR/../.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/../.env"
  set +a
fi

SMB_HOST="${SMB_HOST:-192.168.1.203}"
SMB_USER="${SMB_USER:-crm}"
SMB_PASSWORD="${SMB_PASSWORD:-}"
KDT_MOUNT="${KDT_LOG_MOUNT:-/mnt/kdtsaw}"
LOG_MOUNT="${ENVER_LOG_MOUNT:-/mnt/enver-log}"

if [[ -z "$SMB_PASSWORD" ]]; then
  echo "⚠ SMB_PASSWORD не задано в .env — пропуск монтування"
  exit 0
fi

if ! command -v mount.cifs >/dev/null 2>&1; then
  echo "⚠ mount.cifs не знайдено. Встановіть: apt install cifs-utils"
  exit 0
fi

CRED_FILE="${CRED_FILE:-/etc/enver/smb.credentials}"
sudo mkdir -p /etc/enver
if [[ ! -f "$CRED_FILE" ]] || ! sudo grep -q "username=$SMB_USER" "$CRED_FILE" 2>/dev/null; then
  printf 'username=%s\npassword=%s\n' "$SMB_USER" "$SMB_PASSWORD" | sudo tee "$CRED_FILE" >/dev/null
  sudo chmod 600 "$CRED_FILE"
fi

mount_share() {
  local share="$1"
  local mountpoint="$2"
  sudo mkdir -p "$mountpoint"
  if mountpoint -q "$mountpoint" 2>/dev/null; then
    echo "✓ вже змонтовано: $mountpoint"
    return 0
  fi
  sudo mount -t cifs "//${SMB_HOST}/${share}" "$mountpoint" \
    -o "credentials=$CRED_FILE,vers=3.0,uid=0,gid=0,file_mode=0644,dir_mode=0755,noperm"
  echo "✓ змонтовано //${SMB_HOST}/${share} → $mountpoint"
}

mount_share "KDTsaw" "$KDT_MOUNT"
mount_share "Log" "$LOG_MOUNT"

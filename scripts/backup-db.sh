#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="$ROOT/server/data/enver.db"
BACKUP_DIR="$ROOT/server/data/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ ! -f "$DB" ]]; then
  echo "База не знайдена: $DB"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
cp "$DB" "$BACKUP_DIR/enver-$STAMP.db"
echo "Резервна копія: $BACKUP_DIR/enver-$STAMP.db"

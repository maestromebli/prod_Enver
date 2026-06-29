#!/bin/sh
set -e

UPLOADS="${UPLOADS_DIR:-/data/uploads}"
mkdir -p "$UPLOADS"
# Docker volume часто root:root — без chown запис файлів падає з EACCES.
chown -R enver:enver "$UPLOADS" 2>/dev/null || true

exec su-exec enver "$@"

#!/usr/bin/env bash
# Деплой на staging-сервер. Каталог: $ENVER_STAGING_DIR або ~/enver-staging (fallback /opt/enver-staging).
set -euo pipefail

export IMAGE_REPO="${1:?IMAGE_REPO}"
export IMAGE_TAG="${2:-staging}"

STAGING_DIR="${ENVER_STAGING_DIR:-}"
if [ -z "$STAGING_DIR" ]; then
  if [ -d /opt/enver-staging ] && [ -w /opt/enver-staging ]; then
    STAGING_DIR=/opt/enver-staging
  else
    STAGING_DIR="${HOME}/enver-staging"
  fi
fi
mkdir -p "$STAGING_DIR"
cd "$STAGING_DIR"
chmod +x deploy-staging.sh 2>/dev/null || true

if [ -f docker-compose.staging.yml ]; then
  COMPOSE_FILE="docker-compose.staging.yml"
elif [ -f docker-compose.yml ]; then
  COMPOSE_FILE="docker-compose.yml"
else
  echo "✗ немає docker-compose.staging.yml або docker-compose.yml у /opt/enver-staging"
  exit 1
fi
PREV_TAG_FILE=".previous-staging-tag"

save_previous_tag() {
  if docker compose -f "$COMPOSE_FILE" ps -q enver 2>/dev/null | grep -q .; then
    current_image=$(docker inspect enver-staging --format '{{.Config.Image}}' 2>/dev/null || true)
    if [[ -n "$current_image" && "$current_image" == *:* ]]; then
      echo "${current_image##*:}" >"$PREV_TAG_FILE"
    fi
  fi
}

check_health() {
  if ! docker compose -f "$COMPOSE_FILE" ps -q enver 2>/dev/null | grep -q .; then
    return 1
  fi
  local state
  state=$(docker inspect enver-staging --format '{{.State.Status}}' 2>/dev/null || echo "missing")
  if [[ "$state" != "running" ]]; then
    return 1
  fi
  docker compose -f "$COMPOSE_FILE" exec -T enver node -e "
    fetch('http://127.0.0.1:3000/api/health')
      .then((r) => r.json())
      .then((d) => process.exit(d.ok === true ? 0 : 1))
      .catch(() => process.exit(1));
  "
}

dump_deploy_diagnostics() {
  echo "── staging: діагностика enver-staging ──"
  docker compose -f "$COMPOSE_FILE" ps enver 2>/dev/null || true
  docker inspect enver-staging --format 'status={{.State.Status}} exit={{.State.ExitCode}}' 2>/dev/null || true
  docker compose -f "$COMPOSE_FILE" logs enver --tail 80 2>/dev/null || true
}

save_previous_tag
echo "→ staging pull ${IMAGE_REPO}:${IMAGE_TAG}"
docker compose -f "$COMPOSE_FILE" pull
docker compose -f "$COMPOSE_FILE" up -d

for attempt in $(seq 1 30); do
  if check_health; then
    echo "✓ staging ${IMAGE_REPO}:${IMAGE_TAG} (health ok)"
    echo "$IMAGE_TAG" >"$PREV_TAG_FILE"
    exit 0
  fi
  if (( attempt % 5 == 0 )); then
    echo "  … спроба ${attempt}/30"
    dump_deploy_diagnostics
  fi
  sleep 2
done

echo "✗ staging health check failed"
dump_deploy_diagnostics
exit 1

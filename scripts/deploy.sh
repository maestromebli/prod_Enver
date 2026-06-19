#!/usr/bin/env bash
# Викликається з CI по SSH. CI передає обидва аргументи з github.repository / github.sha.
# Передумови на сервері:
#   - Docker + docker compose v2
#   - /opt/enver/.env з DATABASE_URL, DOMAIN, OPENAI_API_KEY, SESSION_SECRET, AGENT_TOKEN
#   - docker login ghcr.io (PAT з read:packages)

set -euo pipefail

export IMAGE_REPO="${1:?Перший аргумент IMAGE_REPO необхідний (напр. ghcr.io/owner/enver)}"
export IMAGE_TAG="${2:-latest}"

cd /opt/enver
chmod +x deploy.sh mount-enver-smb.sh 2>/dev/null || true
PREV_TAG_FILE=".previous-image-tag"

save_previous_tag() {
  if docker compose ps -q enver 2>/dev/null | grep -q .; then
    current_image=$(docker inspect enver --format '{{.Config.Image}}' 2>/dev/null || true)
    if [[ -n "$current_image" && "$current_image" == *:* ]]; then
      echo "${current_image##*:}" >"$PREV_TAG_FILE"
      echo "  збережено попередній тег: $(cat "$PREV_TAG_FILE")"
    fi
  fi
}

check_health() {
  docker compose exec -T enver node -e "
    fetch('http://127.0.0.1:3000/api/health')
      .then((r) => r.json())
      .then((d) => process.exit(d.ok === true && d.data?.database?.connected === true ? 0 : 1))
      .catch(() => process.exit(1));
  "
}

rollback() {
  if [[ ! -f "$PREV_TAG_FILE" ]]; then
    echo "✗ rollback неможливий: немає збереженого попереднього тегу"
    return 1
  fi
  local prev
  prev=$(cat "$PREV_TAG_FILE")
  echo "↩ rollback до ${IMAGE_REPO}:${prev}"
  export IMAGE_TAG="$prev"
  docker compose pull
  docker compose up -d
  sleep 3
  if check_health; then
    echo "✓ rollback успішний"
    return 0
  fi
  echo "✗ rollback не відновив health"
  return 1
}

save_previous_tag

if [[ -x "./mount-enver-smb.sh" ]]; then
  echo "→ монтування SMB-шар KDTsaw / Log"
  bash ./mount-enver-smb.sh || echo "⚠ SMB mount пропущено або не вдався"
fi

echo "→ pull ${IMAGE_REPO}:${IMAGE_TAG}"
docker compose pull

echo "→ підіймаю стек (enver + caddy)"
docker compose up -d

echo "→ чекаю на health check"
for attempt in $(seq 1 30); do
  if check_health; then
    echo "✓ ${IMAGE_REPO}:${IMAGE_TAG} запущено (health ok)"
    echo "$IMAGE_TAG" >"$PREV_TAG_FILE"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done

echo "✗ health check провалився після деплою"
rollback || true
exit 1

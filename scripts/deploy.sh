#!/usr/bin/env bash
# Викликається з CI по SSH. CI передає обидва аргументи з github.repository / github.sha.
# Передумови на сервері:
#   - Docker + docker compose v2
#   - /opt/enver/.env з DATABASE_URL, DOMAIN, OPENAI_API_KEY, SESSION_SECRET
#   - docker login ghcr.io (PAT з read:packages)

set -euo pipefail

export IMAGE_REPO="${1:?Перший аргумент IMAGE_REPO необхідний (напр. ghcr.io/owner/enver)}"
export IMAGE_TAG="${2:-latest}"

cd /opt/enver

echo "→ pull ${IMAGE_REPO}:${IMAGE_TAG}"
docker compose pull

echo "→ підіймаю стек (enver + caddy)"
docker compose up -d

echo "→ чищу старі образи"
docker image prune -f >/dev/null

echo "✓ ${IMAGE_REPO}:${IMAGE_TAG} запущено"

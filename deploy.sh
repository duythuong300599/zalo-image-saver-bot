#!/usr/bin/env bash
# Chạy trên server sau khi docker-compose.yml/Caddyfile đã được scp lên: đăng
# nhập GHCR, pull image mới nhất, restart container qua docker compose. Yêu
# cầu env: GHCR_USER, GHCR_TOKEN (được GitHub Actions truyền vào qua SSH).
set -euo pipefail

cd "$(dirname "$0")"

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
docker compose pull
docker compose up -d
docker image prune -f

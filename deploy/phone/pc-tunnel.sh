#!/usr/bin/env bash
set -euo pipefail
CF="${CLOUDFLARED:-/tmp/cloudflared-amd64}"
PORT="${SCALP_PORT:-4173}"
adb forward "tcp:${PORT}" "tcp:${PORT}"
exec "$CF" tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate --protocol http2

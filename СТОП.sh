#!/usr/bin/env bash
# Stop sCalp local server.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${SCALP_PORT:-4173}"
PID_FILE="$ROOT/.scalp-server.pid"

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 0.2
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

fuser -k "${PORT}/tcp" 2>/dev/null || true
echo "sCalp stopped (port $PORT)"

if command -v notify-send >/dev/null 2>&1; then
  notify-send "sCalp" "Сервер остановлен" 2>/dev/null || true
fi

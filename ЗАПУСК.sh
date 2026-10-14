#!/usr/bin/env bash
# One-click start: HTTP server + open launcher in browser.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${SCALP_PORT:-4173}"
PID_FILE="$ROOT/.scalp-server.pid"
LOG_FILE="$ROOT/.scalp-server.log"
URL="http://127.0.0.1:${PORT}/"
LOCAL_URL="http://127.0.0.1:${PORT}/local/"
ANDROID_URL="http://127.0.0.1:${PORT}/local-android/"

lan_urls() {
  # IPv4 addresses for phone / Termux on same network or USB tether
  local ips
  ips="$(hostname -I 2>/dev/null || true)"
  if [[ -z "${ips// }" ]]; then
    ips="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | tr '\n' ' ')"
  fi
  for ip in $ips; do
    case "$ip" in
      127.*|169.254.*) continue ;;
    esac
    echo "  Android UI    → http://${ip}:${PORT}/local-android/"
  done
}

cd "$ROOT"

is_up() {
  curl -sf -o /dev/null --max-time 1 "$URL" 2>/dev/null
}

if is_up; then
  echo "sCalp already running → $URL"
  echo "  desktop UI     → $LOCAL_URL"
  echo "  Android UI     → $ANDROID_URL"
  lan_urls
else
  # free port / old pid
  if [[ -f "$PID_FILE" ]]; then
    old="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${old:-}" ]] && kill -0 "$old" 2>/dev/null; then
      kill "$old" 2>/dev/null || true
      sleep 0.3
    fi
    rm -f "$PID_FILE"
  fi
  fuser -k "${PORT}/tcp" 2>/dev/null || true
  sleep 0.2

  nohup python3 "$ROOT/local/serve.py" >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"

  for _ in $(seq 1 40); do
    if is_up; then
      break
    fi
    sleep 0.15
  done

  if ! is_up; then
    echo "ERROR: server did not start. See $LOG_FILE" >&2
    tail -n 30 "$LOG_FILE" >&2 || true
    exit 1
  fi
  echo "sCalp started → $URL (pid $(cat "$PID_FILE"))"
  echo "  desktop UI     → $LOCAL_URL"
  echo "  Android UI     → $ANDROID_URL"
  lan_urls
fi

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
elif command -v sensible-browser >/dev/null 2>&1; then
  sensible-browser "$URL" >/dev/null 2>&1 || true
fi

if command -v notify-send >/dev/null 2>&1; then
  notify-send "sCalp" "Сервер запущен: $URL" 2>/dev/null || true
fi

#!/data/data/com.termux/files/usr/bin/bash
# Cloudflare quick tunnel ON the phone (no PC needed after start)
set -euo pipefail

SRC="${SCALP_SRC:-$HOME/storage/shared/Download/sCalp}"
[[ -d "$SRC/bin" ]] || SRC="/sdcard/Download/sCalp"
DST="${SCALP_HOME:-$HOME/sCalp}"
PORT="${SCALP_PORT:-4173}"
LOG="$DST/cloudflared.log"
PIDF="$DST/cloudflared.pid"
URLF="$DST/public-url.txt"
URL_SHARED="/sdcard/Download/sCalp/public-url.txt"

mkdir -p "$DST/bin"
cp -f "$SRC/bin/cloudflared" "$DST/bin/cloudflared"
chmod +x "$DST/bin/cloudflared"
CF="$DST/bin/cloudflared"

if ! curl -sf -o /dev/null --max-time 1 "http://127.0.0.1:${PORT}/local-android/"; then
  echo "[tunnel] starting local server…"
  bash "$SRC/termux-start.sh"
  sleep 1
fi

if [[ -f "$PIDF" ]]; then
  old=$(cat "$PIDF" 2>/dev/null || true)
  if [[ -n "${old:-}" ]] && kill -0 "$old" 2>/dev/null; then
    kill "$old" 2>/dev/null || true
    sleep 0.4
  fi
fi

rm -f "$LOG"
echo "[tunnel] cloudflared → http://127.0.0.1:${PORT}"
nohup "$CF" tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate --protocol http2 >"$LOG" 2>&1 &
echo $! >"$PIDF"

url=""
for i in $(seq 1 60); do
  # exclude api.trycloudflare.com
  url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | grep -v 'api\.trycloudflare' | head -1 || true)
  [[ -n "$url" ]] && break
  sleep 0.5
done

if [[ -z "$url" ]]; then
  echo "ERROR: no public URL. log:" >&2
  tail -n 40 "$LOG" >&2 || true
  exit 1
fi

page="${url}/local-android/"
echo "$page" | tee "$URLF" "$URL_SHARED"
echo ""
echo "PUBLIC (any phone):"
echo "  $page"

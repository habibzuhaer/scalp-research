#!/data/data/com.termux/files/usr/bin/bash
# Run sCalp Android UI on the phone.
set -euo pipefail

SRC="${SCALP_SRC:-$HOME/storage/shared/Download/sCalp}"
if [[ ! -d "$SRC/local-android" ]]; then
  SRC="/sdcard/Download/sCalp"
fi
DST="${SCALP_HOME:-$HOME/sCalp}"
PORT="${SCALP_PORT:-4173}"

echo "[sCalp] source: $SRC"
echo "[sCalp] install: $DST"

if [[ ! -d "$SRC/local-android" || ! -f "$SRC/local/serve.py" ]]; then
  echo "ERROR: package not found at $SRC" >&2
  exit 1
fi

mkdir -p "$DST/local" "$DST/local-android"
cp -a "$SRC/local/serve.py" "$DST/local/serve.py"
cp -a "$SRC/local-android/." "$DST/local-android/"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[sCalp] installing python…"
  pkg update -y
  pkg install -y python
fi

if [[ ! -d "$HOME/storage/shared" ]]; then
  termux-setup-storage || true
  sleep 1
fi

cd "$DST"
export SCALP_PORT="$PORT"
if [[ -f .scalp-server.pid ]]; then
  old=$(cat .scalp-server.pid 2>/dev/null || true)
  if [[ -n "${old:-}" ]] && kill -0 "$old" 2>/dev/null; then
    kill "$old" 2>/dev/null || true
    sleep 0.3
  fi
fi

echo "[sCalp] starting on 0.0.0.0:${PORT} …"
nohup python3 local/serve.py >"$DST/.scalp-server.log" 2>&1 &
echo $! >"$DST/.scalp-server.pid"
sleep 0.6

echo ""
echo "На ЭТОМ телефоне:"
echo "  http://127.0.0.1:${PORT}/local-android/"
echo ""
echo "С ДРУГОГО телефона (тот же Wi‑Fi):"
ips=$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1)
if [[ -z "${ips}" ]]; then
  ips=$(ifconfig 2>/dev/null | awk '/inet / && $2!="127.0.0.1"{print $2}')
fi
for ip in $ips; do
  case "$ip" in 127.*|169.254.*) continue ;; esac
  echo "  http://${ip}:${PORT}/local-android/"
done
echo ""
echo "Если другой телефон в LTE / другом Wi‑Fi — LAN не достучится,"
echo "нужен туннель (cloudflared/ngrok) или раздай точку доступа с этого телефона."
echo "log: $DST/.scalp-server.log  pid: $(cat "$DST/.scalp-server.pid")"

if command -v termux-open-url >/dev/null 2>&1; then
  termux-open-url "http://127.0.0.1:${PORT}/local-android/" || true
fi

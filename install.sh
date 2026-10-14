#!/usr/bin/env bash
# Установка sCalp после распаковки архива.
# Usage: ./install.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "=== sCalp install ==="
echo "Папка: $ROOT"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: не найдено «$1». Установи и повтори." >&2
    exit 1
  fi
}

need python3
need curl

chmod +x ЗАПУСК.sh СТОП.sh open.sh install.sh 2>/dev/null || true
chmod +x панель.py 2>/dev/null || true
chmod +x sCalp.desktop sCalp-Panel.desktop 2>/dev/null || true

# Починить пути в .desktop под текущую папку
if [[ -f sCalp.desktop ]]; then
  sed -i "s|^Exec=.*|Exec=/bin/bash \"$ROOT/ЗАПУСК.sh\"|" sCalp.desktop
  sed -i "s|^Path=.*|Path=$ROOT|" sCalp.desktop
  sed -i "s|^Icon=.*|Icon=$ROOT/public/favicon.svg|" sCalp.desktop
fi
if [[ -f sCalp-Panel.desktop ]]; then
  sed -i "s|^Exec=.*|Exec=/usr/bin/python3 \"$ROOT/панель.py\"|" sCalp-Panel.desktop
  sed -i "s|^Path=.*|Path=$ROOT|" sCalp-Panel.desktop
  sed -i "s|^Icon=.*|Icon=$ROOT/public/favicon.svg|" sCalp-Panel.desktop
fi

# React — опционально
if [[ "${SCALP_WITH_REACT:-0}" == "1" ]]; then
  need npm
  echo "npm install (React)…"
  npm install
else
  echo "React пропущен (для терминала local/ не нужен)."
  echo "  Нужен React позже: SCALP_WITH_REACT=1 ./install.sh"
fi

mkdir -p logs
echo
echo "OK. Запуск:"
echo "  ./ЗАПУСК.sh"
echo "  → http://127.0.0.1:4173/"
echo

if [[ "${SCALP_AUTOSTART:-1}" == "1" ]]; then
  exec ./ЗАПУСК.sh
fi

#!/usr/bin/env bash
# Open a target page. Starts server if needed.
# Usage: ./open.sh [hub|terminal|docs|tv|react|agents|api]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${SCALP_PORT:-4173}"
TARGET="${1:-hub}"

case "$TARGET" in
  hub|home|"" ) PATH_URL="/" ;;
  terminal|local|trade ) PATH_URL="/local/" ;;
  docs ) PATH_URL="/docs/" ;;
  tv ) PATH_URL="/local/tv-redirect.html" ;;
  react ) PATH_URL="/react.html" ;;
  agents ) PATH_URL="/docs/agents.html" ;;
  api ) PATH_URL="/docs/api.html" ;;
  architecture ) PATH_URL="/docs/architecture.html" ;;
  dom ) PATH_URL="/docs/dom.html" ;;
  events ) PATH_URL="/docs/events.html" ;;
  * ) PATH_URL="/${TARGET#/}" ;;
esac

"$ROOT/ЗАПУСК.sh" >/dev/null
URL="http://127.0.0.1:${PORT}${PATH_URL}"
xdg-open "$URL" >/dev/null 2>&1 || true
echo "$URL"

#!/usr/bin/env bash
# Film the city: scripted, frame-perfect camera shots -> build/film/maastricht-blox.mp4 + stills/*.png.
# Usage: scripts/film.sh [site=build/site_city] [out=build/film] [extra tools/film.mjs args, e.g. --quick --only city]
set -euo pipefail
cd "$(dirname "$0")/.."
site=$(cd "${1:-build/site_city}" && pwd); out=$(mkdir -p "${2:-build/film}" && cd "${2:-build/film}" && pwd)
shift $(( $# >= 2 ? 2 : $# ))
cd viewer
[ -d node_modules ] || npm ci --no-audit --no-fund
command -v ffmpeg >/dev/null || [ -d node_modules/ffmpeg-static ] || npm i --no-save --no-audit --no-fund ffmpeg-static
node tools/film.mjs --site "$site" "$out" "$@"

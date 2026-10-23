#!/usr/bin/env bash
# Regenerate the look-test world and capture viewer screenshots into build/shots/.
# Usage: scripts/shots.sh [views...]   (default: hero facade gallery; plus a night hero shot)
set -euo pipefail
cd "$(dirname "$0")/.."
views="${*:-hero facade gallery}"
(cd pipeline && uv run python -m blox_pipeline.models && uv run python -m blox_pipeline.testscene --out ../build/testscene)
cd viewer
[ -d node_modules ] || npm ci --no-audit --no-fund
node build.mjs ../build/testscene
for v in $views; do node screenshot.mjs ../build/shots "$v"; done
node screenshot.mjs ../build/shots hero t=20.5
echo "screenshots in build/shots/"

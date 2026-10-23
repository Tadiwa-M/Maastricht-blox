#!/usr/bin/env bash
# Headless Unity automation (Linux/macOS workstation). Windows: scripts/unity.ps1.
#   scripts/unity.sh setup   # compile + Blox/Setup Project + Look Test scene  (compile errors fail here)
#   scripts/unity.sh test    # EditMode tests -> build/unity/editmode.xml
#   scripts/unity.sh build   # standalone player -> unity/Builds/<target>/
#   scripts/unity.sh shot    # run the player once, save build/shots/unity_hero.png
#   scripts/unity.sh all     # setup, test, build, shot
# Unity is found via $UNITY_EXE, else the newest 6000.* in the default Unity Hub folder.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd); LOGS="$ROOT/build/unity"; mkdir -p "$LOGS" "$ROOT/build/shots"

find_unity() {
  if [ -n "${UNITY_EXE:-}" ]; then echo "$UNITY_EXE"; return; fi
  local d
  for d in "$HOME/Unity/Hub/Editor" "/Applications/Unity/Hub/Editor"; do
    [ -d "$d" ] || continue
    local v; v=$(ls "$d" | grep '^6000\.' | sort -V | tail -1)
    [ -n "$v" ] || continue
    [ -x "$d/$v/Editor/Unity" ] && { echo "$d/$v/Editor/Unity"; return; }
    [ -x "$d/$v/Unity.app/Contents/MacOS/Unity" ] && { echo "$d/$v/Unity.app/Contents/MacOS/Unity"; return; }
  done
  echo "Unity 6 not found: set UNITY_EXE" >&2; exit 2
}
UNITY=$(find_unity)
unity() { local log=$1; shift; echo "> Unity $* (log: $log)"; "$UNITY" -batchmode -projectPath "$ROOT/unity" -logFile "$log" "$@"; }

setup() { unity "$LOGS/setup.log" -executeMethod Blox.Editor.BatchMode.SetupAndScene; }
tests() { unity "$LOGS/editmode.log" -runTests -testPlatform EditMode -testResults "$LOGS/editmode.xml"; }
build() { unity "$LOGS/build.log" -executeMethod Blox.Editor.BatchMode.BuildPlayer; }
shot() {
  [ -f "$ROOT/build/testscene/manifest.json" ] || (cd pipeline && uv run python -m blox_pipeline.testscene --out ../build/testscene)
  local exe; exe=$(find "$ROOT/unity/Builds" -maxdepth 2 -type f -name 'MaastrichtBlox*' -perm -u+x | head -1)
  [ -n "$exe" ] || { echo "no player build: run 'scripts/unity.sh build' first" >&2; exit 2; }
  "$exe" -screen-width 1920 -screen-height 1080 -screen-fullscreen 0 -logFile "$LOGS/player.log" \
    -bloxWorld "$ROOT/build/testscene" -bloxShot "$ROOT/build/shots/unity_hero.png"
  echo "saved build/shots/unity_hero.png"
}

case "${1:-all}" in
  setup) setup ;; test) tests ;; build) build ;; shot) shot ;;
  all) setup && tests && build && shot ;;
  *) echo "usage: $0 setup|test|build|shot|all" >&2; exit 2 ;;
esac

#!/usr/bin/env bash
# One-command quality gate: every test suite in the repo. Run before each push; CI runs the same.
# Usage: scripts/check.sh [pipeline|proxy|dotnet|viewer|relay ...]   (default: all)
set -euo pipefail
cd "$(dirname "$0")/.."
targets=("${@:-pipeline proxy dotnet viewer relay}")
read -ra targets <<< "${targets[*]}"
fail=0

run() {  # run <name> <dir> <command...>
  local name=$1 dir=$2; shift 2
  echo "=== $name ==="
  if (cd "$dir" && "$@"); then echo "--- $name: OK"; else echo "--- $name: FAILED"; fail=1; fi
}

for t in "${targets[@]}"; do
  case $t in
    pipeline) run pipeline pipeline uv run pytest -q ;;
    proxy)    run proxy proxy uv run pytest -q ;;
    dotnet)
      run dotnet-core dotnet dotnet test Blox.sln --nologo -v q
      if [ -d "unity/Assets/Blox/Editor/PureTests~" ]; then
        run dotnet-look "unity/Assets/Blox/Editor/PureTests~" dotnet test Blox.LookTests.csproj --nologo -v q
      fi ;;
    viewer)
      [ -d viewer/node_modules ] || (cd viewer && npm ci --no-audit --no-fund)
      run viewer viewer npm test --silent ;;
    relay)    run relay relay npm test --silent ;;
    *) echo "unknown target: $t"; exit 2 ;;
  esac
done

[ $fail -eq 0 ] && echo "ALL CHECKS PASSED" || { echo "SOME CHECKS FAILED"; exit 1; }

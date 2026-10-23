#!/usr/bin/env bash
# One-time setup of a Linux/macOS workstation for Maastricht Blox. Safe to re-run.
# Install manually if missing: git, Unity Hub + Unity 6 LTS, .NET 8 SDK, Node.js 22.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
for c in git dotnet node npm; do command -v $c >/dev/null && echo "ok  $c" || echo "MISSING $c"; done
(cd pipeline && uv sync) && (cd proxy && uv sync) && (cd viewer && npm ci --no-audit --no-fund)
dotnet restore dotnet/Blox.sln
command -v nvidia-smi >/dev/null && nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv || echo "no nvidia-smi"
echo; echo "Next: scripts/check.sh · (cd pipeline && uv run blox fetch) · scripts/unity.sh all"

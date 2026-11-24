#!/usr/bin/env bash
# Update ONLY the game's code on the published site (owner: a full site rebuild and publish copies
# 30,000 world files for a code change). Builds the viewer bundle and its small files, then adds
# one normal commit with them to the site repo; the world data there is untouched. The next full
# publish.sh replaces everything with a fresh single commit as usual.
# Usage: scripts/update-viewer.sh [repo-url] [branch]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
repo="${1:-https://github.com/Tadiwa-M/Maastricht_larper.git}"; branch="${2:-main}"
out="$(mktemp -d)"; work="$(mktemp -d)"
trap 'rm -rf "$out" "$work"' EXIT
[ -d "$root/viewer/node_modules" ] || (cd "$root/viewer" && npm ci --no-audit --no-fund)
(cd "$root/viewer" && node build.mjs --viewer-only "$out")
code="$(git -C "$root" rev-parse --short HEAD)"
# a blobless, shallow clone without a checkout: only the file list, none of the 30,000 files
git clone -q --depth 1 --filter=blob:none --no-checkout --branch "$branch" "$repo" "$work"
cd "$work"
git read-tree HEAD   # the index holds the site as it is
cp -R "$out"/. "$work"/
git add -A -- $(cd "$out" && find . -type f | sed 's|^\./||')   # only the files this build made
if git diff --cached --quiet; then echo "nothing changed: the site already has this viewer"; exit 0; fi
git -c user.name="${GIT_AUTHOR_NAME:-$(git -C "$root" config user.name || echo blox)}" -c user.email="${GIT_AUTHOR_EMAIL:-$(git -C "$root" config user.email || echo blox@users.noreply.github.com)}" \
  commit -q -m "Viewer update from Maastricht-blox $code"
git push -q origin "$branch"
echo "viewer updated: $(git diff --stat HEAD~1 HEAD | tail -1)"

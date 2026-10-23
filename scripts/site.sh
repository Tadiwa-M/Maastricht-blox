#!/usr/bin/env bash
# Build the playable web city as a static site: viewer bundle + world files + baked far meshes.
# Usage: scripts/site.sh [worldDir=build/world] [outDir=build/site] [--serve [port]]
# Then serve outDir with any static file server (it streams files over HTTP; file:// won't do).
set -euo pipefail
cd "$(dirname "$0")/.."
world="build/world"; out="build/site"; serve=""; port=8000
args=()
while [ $# -gt 0 ]; do
  case $1 in
    --serve) serve=1; if [ $# -gt 1 ] && [[ $2 =~ ^[0-9]+$ ]]; then port=$2; shift; fi ;;
    *) args+=("$1") ;;
  esac
  shift
done
[ ${#args[@]} -ge 1 ] && world=${args[0]}
[ ${#args[@]} -ge 2 ] && out=${args[1]}
[ -f "$world/manifest.json" ] || { echo "no world at $world (build one: cd pipeline && uv run blox build, or use samples/markt_v3)"; exit 2; }
world=$(cd "$world" && pwd)
mkdir -p "$out"; out=$(cd "$out" && pwd)
cd viewer
[ -d node_modules ] || npm ci --no-audit --no-fund
node build.mjs "$world" --site "$out"
du -sh "$out" | awk '{print "site size: " $1}'
cat <<MSG

Serve it locally (any static server works):
  python3 -m http.server $port --directory "$out"     then open http://localhost:$port/
  (or: scripts/site.sh $world $out --serve $port)

Publish (static hosting, no server code):
  GitHub Pages: put the contents of $out on a gh-pages branch, e.g.
    git worktree add /tmp/gh-pages gh-pages   (first time: git worktree add -b gh-pages /tmp/gh-pages)
    rsync -a --delete --exclude .git "$out"/ /tmp/gh-pages/ && touch /tmp/gh-pages/.nojekyll
    (cd /tmp/gh-pages && git add -A && git commit -m "site" && git push origin gh-pages)
  then enable Pages for the gh-pages branch in the repository settings.
  Any other static host (Netlify, Cloudflare Pages, S3) works the same: upload $out.
  Note: GitHub Pages has a 1 GB site limit and files must stay under 100 MB (the full city is ~100 MB in ~6,500 files).
MSG
if [ -n "$serve" ]; then
  echo; echo "serving $out at http://localhost:$port/ (Ctrl+C stops)"
  exec python3 -m http.server "$port" --directory "$out"
fi

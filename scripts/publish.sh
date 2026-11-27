#!/usr/bin/env bash
# Publish a built site (scripts/site.sh output) to the GitHub Pages repo as ONE fresh commit.
# The site repo holds no history: each publish force-pushes a single commit, so the 250+ MB of
# city files never pile up and the code repo stays small.
# Usage: scripts/publish.sh [site=build/site_city] [repo=https://github.com/Tadiwa-M/Maastricht_larper.git] [branch=main]
set -euo pipefail
cd "$(dirname "$0")/.."
site=${1:-build/site_city}
repo=${2:-https://github.com/Tadiwa-M/Maastricht_larper.git}
branch=${3:-main}
[ -f "$site/index.html" ] || { echo "no site at $site (build one: scripts/site.sh <world> $site)"; exit 2; }
code=$(git rev-parse --short HEAD)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -R "$site"/. "$work"/
touch "$work/.nojekyll"
cat > "$work/README.md" <<MD
# Maastricht Blox: play

The playable build of [Maastricht Blox](https://github.com/Tadiwa-M/Maastricht-blox), a
brick-built miniature of Maastricht made from open data, running in the browser.

**Play:** https://tadiwa-m.github.io/Maastricht_larper/

This repository only holds the generated static site (one commit per release, built from
code commit \`$code\`). The source, pipeline and docs live in the main repository.

Data: (c) OpenStreetMap contributors (ODbL; the city files here are a derived database under
the ODbL), 3D BAG by TU Delft 3D geoinformation (CC BY 4.0), AHN (AHN.nl), OVapi GTFS.
Not affiliated with, endorsed or sponsored by the LEGO Group.
MD
cd "$work"
git init -q -b "$branch"
git add -A
git commit -q -m "Site build from Maastricht-blox $code"
echo "pushing $(find . -type f -not -path './.git/*' | wc -l) files to $repo ($branch), this can take a few minutes..."
git push -q -f "$repo" "$branch"
owner_name=${repo%.git}; name=${owner_name##*/}; owner=${owner_name%/*}; owner=${owner##*/}
echo
echo "published. First time only: on GitHub open $name -> Settings -> Pages -> 'Deploy from a branch' -> $branch / (root) -> Save."
echo "live in a few minutes at https://$(echo "$owner" | tr A-Z a-z).github.io/$name/"

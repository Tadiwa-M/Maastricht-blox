# Build the playable web city as a static site: viewer bundle + world files + baked far meshes.
# Usage:
#   .\scripts\site.ps1                                  # build\world -> build\site
#   .\scripts\site.ps1 samples\markt_v3 build\site_markt -Serve
#   .\scripts\site.ps1 -Serve -Port 8080
# Serving binds to 127.0.0.1 only: no Windows firewall prompt (no admin needed), not reachable from other machines.
# Then serve the output folder with any static file server (it streams files over HTTP; file:// won't do).
param([string]$World = '', [string]$Out = '', [switch]$Serve, [int]$Port = 8000)
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
if (-not $World) { $World = Join-Path $Root 'build\world' }
if (-not $Out) { $Out = Join-Path $Root 'build\site' }
if (-not (Test-Path (Join-Path $World 'manifest.json'))) {
    throw "no world at $World (build one: cd pipeline; uv run blox build; or use samples\markt_v3)"
}
$World = (Resolve-Path $World).Path
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path $Out).Path
Push-Location (Join-Path $Root 'viewer')
try {
    if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund }
    node build.mjs $World --site $Out
    if ($LASTEXITCODE) { throw 'site build failed' }
} finally { Pop-Location }
$mb = [math]::Round(((Get-ChildItem $Out -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host "site size: $mb MB"
Write-Host @"

Serve it locally (any static server works):
  python -m http.server $Port --bind 127.0.0.1 --directory "$Out"     then open http://localhost:$Port/
  (or: .\scripts\site.ps1 "$World" "$Out" -Serve -Port $Port)

Publish (static hosting, no server code):
  GitHub Pages: put the contents of $Out on a gh-pages branch, e.g.
    git worktree add -b gh-pages ..\gh-pages        (later: git worktree add ..\gh-pages gh-pages)
    robocopy "$Out" ..\gh-pages /MIR /XD .git ; New-Item ..\gh-pages\.nojekyll -Force
    cd ..\gh-pages ; git add -A ; git commit -m site ; git push origin gh-pages
  then enable Pages for the gh-pages branch in the repository settings.
  Any other static host (Netlify, Cloudflare Pages, S3) works the same: upload $Out.
  Note: GitHub Pages has a 1 GB site limit and files must stay under 100 MB (the full city is ~100 MB in ~6,500 files).
"@
if ($Serve) {
    Write-Host "serving $Out at http://localhost:$Port/ (Ctrl+C stops)"
    python -m http.server $Port --bind 127.0.0.1 --directory $Out
}

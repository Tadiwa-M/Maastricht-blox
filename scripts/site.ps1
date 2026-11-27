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

Publish to GitHub Pages (one fresh commit in the site repo, no history):
  .\scripts\publish.ps1 -Site "$Out"
  Other static hosts work too (upload $Out), but Cloudflare Pages' free plan caps a site at 20,000 files and the full city has ~30,000.
"@
if ($Serve) {
    Write-Host "serving $Out at http://localhost:$Port/ (Ctrl+C stops)"
    python -m http.server $Port --bind 127.0.0.1 --directory $Out
}

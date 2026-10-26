# Film the city: scripted, frame-perfect camera shots -> build\film\maastricht-blox.mp4 + stills\*.png.
# Usage: .\scripts\film.ps1 [-Site build\site_city] [-Out build\film] [-Only city,markt] [-Quick] [-Size 1920x1080]
# A browser window opens and renders on the GPU; leave it alone until it closes. See docs/guide/06-viewer.md.
param(
  [string]$Site = "build\site_city",
  [string]$Out = "build\film",
  [string]$Only = "",
  [string]$Size = "1920x1080",
  [switch]$Quick
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not [IO.Path]::IsPathRooted($Site)) { $Site = Join-Path $root $Site }
if (-not [IO.Path]::IsPathRooted($Out)) { $Out = Join-Path $root $Out }
if (-not (Test-Path (Join-Path $Site "index.html"))) { throw "no site at $Site (build one: .\scripts\site.ps1 <world> $Site)" }
Push-Location (Join-Path $root "viewer")
try {
  if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund }
  if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue) -and -not (Test-Path node_modules\ffmpeg-static)) {
    npm i --no-save --no-audit --no-fund ffmpeg-static
  }
  $a = @("tools/film.mjs", "--site", $Site, $Out, "--size", $Size)
  if ($Only) { $a += @("--only", $Only) }
  if ($Quick) { $a += "--quick" }
  node @a
  if ($LASTEXITCODE -ne 0) { throw "film failed" }
} finally { Pop-Location }

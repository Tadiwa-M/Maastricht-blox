# Update ONLY the game's code on the published site (a full site rebuild and publish copies 30,000
# world files for a code change). Builds the viewer bundle and its small files, then adds one normal
# commit with them to the site repo; the world data there is untouched. The next full
# publish.ps1 replaces everything with a fresh single commit as usual.
# Usage: .\scripts\update-viewer.ps1 [-Repo https://github.com/Tadiwa-M/Maastricht_larper.git] [-Branch main]
param(
  [string]$Repo = "https://github.com/Tadiwa-M/Maastricht_larper.git",
  [string]$Branch = "main"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $env:TEMP "blox-viewer-out"
$work = Join-Path $env:TEMP "blox-viewer-update"
foreach ($d in $out, $work) { if (Test-Path $d) { Remove-Item -Recurse -Force $d } }
New-Item -ItemType Directory $out | Out-Null

Push-Location (Join-Path $root "viewer")
try {
  if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund }
  node build.mjs --viewer-only $out
  if ($LASTEXITCODE) { throw "viewer build failed" }
} finally { Pop-Location }
$code = (git -C $root rev-parse --short HEAD).Trim()

# a blobless, shallow clone without a checkout: only the file list, none of the 30,000 files
git clone -q --depth 1 --filter=blob:none --no-checkout --branch $Branch $Repo $work
if ($LASTEXITCODE) { throw "clone failed" }
Push-Location $work
try {
  git read-tree HEAD   # the index holds the site as it is
  Copy-Item -Recurse -Force (Join-Path $out "*") $work
  $files = Get-ChildItem $out -Recurse -File | ForEach-Object { $_.FullName.Substring($out.Length + 1).Replace("\", "/") }
  git add -- $files
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { Write-Host "nothing changed: the site already has this viewer"; return }
  git commit -q -m "Viewer update from Maastricht-blox $code"
  git push -q origin $Branch
  if ($LASTEXITCODE) { throw "git push failed" }
  Write-Host "viewer updated ($($files.Count) files checked)"
} finally { Pop-Location }

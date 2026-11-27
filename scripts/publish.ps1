# Publish a built site (scripts\site.ps1 output) to the GitHub Pages repo as ONE fresh commit.
# The site repo holds no history: each publish force-pushes a single commit, so the 250+ MB of
# city files never pile up and the code repo stays small.
# Usage: .\scripts\publish.ps1 [-Site build\site_city] [-Repo https://github.com/Tadiwa-M/Maastricht_larper.git]
param(
  [string]$Site = "build\site_city",
  [string]$Repo = "https://github.com/Tadiwa-M/Maastricht_larper.git",
  [string]$Branch = "main"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not [IO.Path]::IsPathRooted($Site)) { $Site = Join-Path $root $Site }
if (-not (Test-Path (Join-Path $Site "index.html"))) { throw "no site at $Site (build one: .\scripts\site.ps1 <world> $Site)" }
$Site = (Resolve-Path $Site).Path
$code = (git -C $root rev-parse --short HEAD).Trim()
$work = Join-Path $env:TEMP "blox-publish"

if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory $work | Out-Null
robocopy $Site $work /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
New-Item -ItemType File (Join-Path $work ".nojekyll") -Force | Out-Null
$readme = @"
# Maastricht Blox: play

The playable build of [Maastricht Blox](https://github.com/Tadiwa-M/Maastricht-blox), a
brick-built miniature of Maastricht made from open data, running in the browser.

**Play:** https://tadiwa-m.github.io/Maastricht_larper/

This repository only holds the generated static site (one commit per release, built from
code commit ``$code``). The source, pipeline and docs live in the main repository.

Data: (c) OpenStreetMap contributors (ODbL; the city files here are a derived database under
the ODbL), 3D BAG by TU Delft 3D geoinformation (CC BY 4.0), AHN (AHN.nl), OVapi GTFS.
Not affiliated with, endorsed or sponsored by the LEGO Group.
"@
Set-Content -Path (Join-Path $work "README.md") -Value $readme -Encoding utf8

Push-Location $work
try {
  git init -q -b $Branch
  git config http.postBuffer 524288000
  git add -A
  git commit -q -m "Site build from Maastricht-blox $code"
  git remote add origin $Repo
  Write-Host "pushing $((Get-ChildItem -Recurse -File | Measure-Object).Count) files to $Repo ($Branch), this can take a few minutes..."
  git push -f origin $Branch
  if ($LASTEXITCODE -ne 0) { throw "git push failed" }
} finally { Pop-Location }

$owner, $name = ($Repo -replace '\.git$', '' -split '/')[-2, -1]
Write-Host ""
Write-Host "published. First time only: on GitHub open $name -> Settings -> Pages -> 'Deploy from a branch' -> $Branch / (root) -> Save."
Write-Host "live in a few minutes at https://$($owner.ToLower()).github.io/$name/"

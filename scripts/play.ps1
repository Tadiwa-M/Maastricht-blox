# Play the web game (title, trailer, loading screen, looks, the whole city) in its own app window,
# served from the local site build: no browser tabs or address bar, works offline. The desktop icon
# "Maastricht Blox" runs this (scripts/desktop-icons.ps1 makes it).
#   .\scripts\play.ps1                              # build\site_maastricht on port 8765
#   .\scripts\play.ps1 -Site build\site -Port 8000
# The server binds to 127.0.0.1 only and stops when the game window is closed.
param([string]$Site = '', [int]$Port = 8765)
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
if (-not $Site) { $Site = Join-Path $Root 'build\site_maastricht' }
if (-not (Test-Path (Join-Path $Site 'index.html'))) { throw "no site at ${Site}: build one with .\scripts\site.ps1" }
$Site = (Resolve-Path $Site).Path
$url = "http://127.0.0.1:$Port/"

function Test-Server {
    try { (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200 } catch { $false }
}

$browser = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
             "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw 'Edge or Chrome not found' }
# A profile of its own: the window is a separate browser process we can wait on, and the game's
# saved settings (looks, controls) stay apart from normal browsing.
$profileDir = Join-Path $env:LOCALAPPDATA 'MaastrichtBlox\browser-profile'
$appArgs = @("--app=$url", "--user-data-dir=`"$profileDir`"", '--start-maximized', '--no-first-run', '--autoplay-policy=no-user-gesture-required')

if (Test-Server) {   # already running (second click): just open another window
    Start-Process $browser -ArgumentList $appArgs
    return
}
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { throw 'python not found (needed for the local file server)' }
$server = Start-Process $python -ArgumentList @('-m', 'http.server', "$Port", '--bind', '127.0.0.1', '--directory', "`"$Site`"") -WindowStyle Hidden -PassThru
try {
    for ($i = 0; $i -lt 50 -and -not (Test-Server); $i++) { Start-Sleep -Milliseconds 200 }
    if (-not (Test-Server)) { throw "the local server did not start on port $Port" }
    Start-Process $browser -ArgumentList $appArgs -Wait
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}

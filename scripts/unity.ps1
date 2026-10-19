# Headless Unity automation (Windows workstation). Linux/macOS: scripts/unity.sh.
#   .\scripts\unity.ps1 setup   # compile + Blox/Setup Project + Look Test scene (compile errors fail here)
#   .\scripts\unity.ps1 test    # EditMode tests -> build\unity\editmode.xml
#   .\scripts\unity.ps1 build   # standalone player -> unity\Builds\StandaloneWindows64\
#   .\scripts\unity.ps1 shot    # run the player once, save build\shots\unity_hero.png
#   .\scripts\unity.ps1 all     # setup, test, build, shot
# Unity is found via $env:UNITY_EXE, else the newest 6000.* under the default Unity Hub folder.
param([ValidateSet('setup', 'test', 'build', 'shot', 'all')][string]$Step = 'all')
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Logs = Join-Path $Root 'build\unity'
New-Item -ItemType Directory -Force -Path $Logs, (Join-Path $Root 'build\shots') | Out-Null

function Find-Unity {
    if ($env:UNITY_EXE) { return $env:UNITY_EXE }
    $hub = 'C:\Program Files\Unity\Hub\Editor'
    $v = Get-ChildItem $hub -Directory -ErrorAction SilentlyContinue | Where-Object Name -like '6000.*' |
        Sort-Object { [version]($_.Name -replace '[a-z].*$', '') } | Select-Object -Last 1
    if (-not $v) { throw 'Unity 6 not found: set $env:UNITY_EXE' }
    return Join-Path $v.FullName 'Editor\Unity.exe'
}
$Unity = Find-Unity

function Invoke-Unity([string]$Log, [string[]]$UnityArgs) {
    Write-Host "> Unity $($UnityArgs -join ' ') (log: $Log)"
    $p = Start-Process -FilePath $Unity -Wait -PassThru -NoNewWindow -ArgumentList (@(
        '-batchmode', '-projectPath', "`"$Root\unity`"", '-logFile', "`"$Log`"") + $UnityArgs)
    if ($p.ExitCode -ne 0) { throw "Unity failed (exit $($p.ExitCode)); see $Log" }
}

function Step-Setup { Invoke-Unity "$Logs\setup.log" @('-executeMethod', 'Blox.Editor.BatchMode.SetupAndScene') }
function Step-Test { Invoke-Unity "$Logs\editmode.log" @('-runTests', '-testPlatform', 'EditMode', '-testResults', "`"$Logs\editmode.xml`"") }
function Step-Build { Invoke-Unity "$Logs\build.log" @('-buildTarget', 'Win64', '-executeMethod', 'Blox.Editor.BatchMode.BuildPlayer') }
function Step-Shot {
    $world = Join-Path $Root 'build\testscene'
    if (-not (Test-Path "$world\manifest.json")) {
        Push-Location (Join-Path $Root 'pipeline'); uv run python -m blox_pipeline.testscene --out ..\build\testscene; Pop-Location
    }
    $exe = Join-Path $Root 'unity\Builds\StandaloneWindows64\MaastrichtBlox.exe'
    if (-not (Test-Path $exe)) { throw "no player build: run '.\scripts\unity.ps1 build' first" }
    $shot = Join-Path $Root 'build\shots\unity_hero.png'
    Start-Process -FilePath $exe -Wait -ArgumentList @('-screen-width', '1920', '-screen-height', '1080',
        '-screen-fullscreen', '0', '-logFile', "`"$Logs\player.log`"", '-bloxWorld', "`"$world`"", '-bloxShot', "`"$shot`"")
    Write-Host "saved $shot"
}

switch ($Step) {
    'setup' { Step-Setup } 'test' { Step-Test } 'build' { Step-Build } 'shot' { Step-Shot }
    'all' { Step-Setup; Step-Test; Step-Build; Step-Shot }
}

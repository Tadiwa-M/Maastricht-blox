# Headless Unity automation (Windows workstation). Linux/macOS: scripts/unity.sh.
#   .\scripts\unity.ps1 setup   # compile + Blox/Setup Project + Look Test scene (compile errors fail here)
#   .\scripts\unity.ps1 test    # EditMode tests -> build\unity\editmode.xml
#   .\scripts\unity.ps1 build   # standalone player -> unity\Builds\StandaloneWindows64\
#   .\scripts\unity.ps1 shot    # run the player once, save build\shots\unity_hero.png
#   .\scripts\unity.ps1 all     # setup, test, build, shot
#   .\scripts\unity.ps1 editorshot -World build\world   # the Editor, not the player: Blox/Open World on <dir>, Play,
#                                save build\shots\<Out>, quit. Close the open Editor first (one instance per project).
# Unity is found via $env:UNITY_EXE, else the newest 6000.* under the default Unity Hub folder.
#   -Out <name.png> -ShotArgs '-bloxCam','x,z,dist','-bloxHour','14'   # shot file name and extra player args
#   -World <dir>               # frame the scene on, and shoot, a real world (e.g. build\world) instead of build\testscene
param([ValidateSet('setup', 'test', 'build', 'shot', 'editorshot', 'all')][string]$Step = 'all', [string]$World = '', [string]$Out = 'unity_hero.png', [string[]]$ShotArgs = @())
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Logs = Join-Path $Root 'build\unity'
New-Item -ItemType Directory -Force -Path $Logs, (Join-Path $Root 'build\shots') | Out-Null

function Find-Unity {
    if ($env:UNITY_EXE) { return $env:UNITY_EXE }
    # 1) Unity Hub's editor folders: default, per-user, and the custom one Hub records.
    $roots = @("$env:ProgramFiles\Unity\Hub\Editor", "$env:LOCALAPPDATA\Unity\Editors", "$env:ProgramFiles\Unity\Editor")
    $custom = Join-Path $env:APPDATA 'UnityHub\secondaryInstallPath.json'
    if (Test-Path $custom) { $p = (Get-Content $custom -Raw | ConvertFrom-Json); if ($p) { $roots = @("$p") + $roots } }
    $found = $roots | Where-Object { $_ -and (Test-Path $_) } | ForEach-Object { Get-ChildItem $_ -Directory } |
        Where-Object Name -like '6000.*' | ForEach-Object { Join-Path $_.FullName 'Editor\Unity.exe' } | Where-Object { Test-Path $_ }
    # 2) Anything else (Unity CLI / custom installs): search the usual install places, newest 6000.* wins.
    if (-not $found) {
        $search = @("$env:ProgramFiles", "$env:LOCALAPPDATA", "$env:LOCALAPPDATA\Programs", "$HOME") | Where-Object { Test-Path $_ }
        $found = $search | ForEach-Object { Get-ChildItem $_ -Recurse -Depth 5 -Filter Unity.exe -ErrorAction SilentlyContinue } |
            Where-Object { $_.FullName -match '6000\.' } | ForEach-Object FullName
    }
    $best = $found | Sort-Object { [version](([regex]::Match($_, '6000\.\d+\.\d+')).Value) } | Select-Object -Last 1
    if (-not $best) { throw 'Unity 6 not found: set $env:UNITY_EXE to the full path of Unity.exe' }
    Write-Host "Unity: $best"
    return $best
}
$Unity = Find-Unity

# Waits for that one process. Not Start-Process -Wait: it waits for every descendant, and Unity leaves
# Unity.ILPP.Trigger.exe helpers running, so a finished run hung the script (2026-11-27). Touching
# .Handle first keeps ExitCode readable after the process is gone.
function Wait-Exit([System.Diagnostics.Process]$p) { $null = $p.Handle; $p.WaitForExit() }

function Invoke-Unity([string]$Log, [string[]]$UnityArgs) {
    Write-Host "> Unity $($UnityArgs -join ' ') (log: $Log)"
    $p = Start-Process -FilePath $Unity -PassThru -NoNewWindow -ArgumentList (@(
        '-batchmode', '-projectPath', "`"$Root\unity`"", '-logFile', "`"$Log`"") + $UnityArgs)
    Wait-Exit $p
    if ($p.ExitCode -ne 0) { throw "Unity failed (exit $($p.ExitCode)); see $Log" }
}

function Ensure-TestWorld {
    if ($World) {
        $w = (Resolve-Path $World).Path
        if (-not (Test-Path "$w\manifest.json")) { throw "no manifest.json in $w" }
        return $w
    }
    $world = Join-Path $Root 'build\testscene'
    if (-not (Test-Path "$world\manifest.json")) {
        Push-Location (Join-Path $Root 'pipeline'); uv run python -m blox_pipeline.testscene --out ..\build\testscene; Pop-Location
    }
    return $world
}

$SceneWorldFile = Join-Path $Logs 'scene_world.txt'   # which world the baked scene's camera is framed on

function Step-Setup {
    $w = Ensure-TestWorld
    Invoke-Unity "$Logs\setup.log" @('-executeMethod', 'Blox.Editor.BatchMode.SetupAndScene', '-bloxWorld', "`"$w`"")
    Set-Content -Path $SceneWorldFile -Value $w -Encoding utf8
}

# Shots are daylight unless an hour is given: the sun follows the real clock, and a shot taken after
# sunset is a near-black frame (2026-11-27: the 65k world shot at 19:38).
function Shot-Args {
    if ($ShotArgs -contains '-bloxHour') { return $ShotArgs }
    return @('-bloxHour', '13') + $ShotArgs
}
function Step-Test { Invoke-Unity "$Logs\editmode.log" @('-runTests', '-testPlatform', 'EditMode', '-testResults', "`"$Logs\editmode.xml`"") }
function Step-Build { Invoke-Unity "$Logs\build.log" @('-buildTarget', 'Win64', '-executeMethod', 'Blox.Editor.BatchMode.BuildPlayer') }
function Step-Shot {
    $world = Ensure-TestWorld
    $exe = Join-Path $Root 'unity\Builds\StandaloneWindows64\MaastrichtBlox.exe'
    if (-not (Test-Path $exe)) { throw "no player build: run '.\scripts\unity.ps1 build' first" }
    $shot = Join-Path $Root "build\shots\$Out"
    $baked = if (Test-Path $SceneWorldFile) { (Get-Content $SceneWorldFile -Raw).Trim() } else { '' }
    if ($baked -ne $world -and -not ($ShotArgs -contains '-bloxCam')) {
        Write-Warning "the player's camera is framed on '$baked', not '$world': run 'setup -World' and 'build' first, or pass -ShotArgs '-bloxCam','x,z,dist'"
    }
    $pl = Start-Process -FilePath $exe -PassThru -ArgumentList (@('-screen-width', '1920', '-screen-height', '1080',
        '-screen-fullscreen', '0', '-logFile', "`"$Logs\player.log`"", '-bloxWorld', "`"$world`"", '-bloxShot', "`"$shot`"") + (Shot-Args))
    Wait-Exit $pl
    Write-Host "saved $shot"
}

function Step-EditorShot {
    $world = Ensure-TestWorld
    $shot = Join-Path $Root "build\shots\$Out"
    $log = "$Logs\editorshot.log"
    # A killed Editor leaves a scene backup; the next Editor then waits on a 'Scene Backup Detected' dialog that
    # nobody sees (2026-11-27). Stop instead: open Unity once and choose, or delete the backup if it is only LookTest.
    if (Get-ChildItem (Join-Path $Root 'unity\Temp\__Backupscenes') -ErrorAction SilentlyContinue) {
        throw "unity\Temp\__Backupscenes has a scene backup: open Unity once and pick Restore or Discard, then retry"
    }
    Write-Host "> Unity Editor: open $world, Play, shot -> $shot (log: $log)"
    $p = Start-Process -FilePath $Unity -PassThru -ArgumentList (@('-projectPath', "`"$Root\unity`"", '-logFile', "`"$log`"",
        '-executeMethod', 'Blox.Editor.EditorPlayShot.Start', '-bloxOpenWorld', "`"$world`"", '-bloxShot', "`"$shot`"") +
        (Shot-Args) + @('-bloxShotDelay', '25'))   # first occurrence wins: a -bloxShotDelay in -ShotArgs overrides 25
    Wait-Exit $p
    if ($p.ExitCode -ne 0) { throw "Editor play shot failed (exit $($p.ExitCode)); see $log" }
    Write-Host "saved $shot"
}

switch ($Step) {
    'setup' { Step-Setup } 'test' { Step-Test } 'build' { Step-Build } 'shot' { Step-Shot } 'editorshot' { Step-EditorShot }
    'all' { Step-Setup; Step-Test; Step-Build; Step-Shot }
}

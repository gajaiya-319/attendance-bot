param(
    [string]$ProjectDir = "C:\Users\hyun yong\Documents\Codex\2026-05-16\require-dotenv-config-const-fssync-require",
    [string]$AppName = "attendance-bot"
)

$ErrorActionPreference = "Stop"
$env:PM2_HOME = Join-Path $env:USERPROFILE ".pm2"
$pm2 = Join-Path $env:APPDATA "npm\pm2.cmd"
if (-not (Test-Path -LiteralPath $pm2)) {
    $pm2 = "pm2.cmd"
}
$scriptPath = Join-Path $ProjectDir "index.js"

Set-Location -LiteralPath $ProjectDir

function Invoke-Pm2 {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & $pm2 @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "pm2 $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Get-Pm2Pid {
    $pidText = (& $pm2 pid $AppName 2>$null | Select-Object -First 1)
    $pidText = ([string]$pidText).Trim()
    if (-not $pidText -or $pidText -eq "N/A") { return 0 }
    $parsed = 0
    if ([int]::TryParse($pidText, [ref]$parsed)) { return $parsed }
    return 0
}

$appPid = Get-Pm2Pid
if ($appPid -le 0 -or -not (Get-Process -Id $appPid -ErrorAction SilentlyContinue)) {
    & $pm2 restart $AppName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Invoke-Pm2 start $scriptPath --name $AppName | Out-Null
    }
    Invoke-Pm2 save | Out-Null
    exit 0
}

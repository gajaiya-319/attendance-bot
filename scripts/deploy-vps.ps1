param(
    [string]$HostName = "ubuntu@168.110.119.223",
    [string]$KeyPath = "C:\Users\hyun yong\Downloads\discord-bot.key",
    [string]$RemotePath = "/home/ubuntu/attendance-bot",
    [string]$AppName = "attendance-bot",
    [switch]$SkipPredeploy,
    [switch]$SkipInstall,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )

    Write-Host ""
    Write-Host ("> " + $FilePath + " " + ($Arguments -join " "))
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

function Invoke-Remote {
    param([string]$Command)
    Invoke-Checked "ssh" @("-i", $KeyPath, $HostName, $Command)
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $repoRoot
try {
    if (-not $SkipPredeploy) {
        Invoke-Checked "npm.cmd" @("run", "predeploy")
    }

    $stamp = Get-Date -Format "yyyyMMddHHmmss"
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "attendance-bot-deploy-$stamp"
    $archive = Join-Path $tempRoot "attendance-bot-$stamp.tgz"
    $staging = Join-Path $tempRoot "staging"
    New-Item -ItemType Directory -Path $tempRoot | Out-Null
    New-Item -ItemType Directory -Path $staging | Out-Null

    $excluded = @(
        '(^|/)node_modules(/|$)',
        '(^|/)\.git(/|$)',
        '(^|/)\.env($|\.)',
        '(^|/)sheet-bot-key\.json$',
        '(^|/).*sheet.*key.*\.json$',
        '(^|/)attendanceData(\..*)?\.json$',
        '(^|/)logs(/|$)',
        '(^|/)backups(/|$)',
        '(^|/)outputs(/|$)',
        '(^|/)\.cursor(/|$)'
    )

    $files = git -c core.quotePath=false ls-files -co --exclude-standard |
        ForEach-Object { $_ -replace '\\', '/' } |
        Where-Object {
            $path = $_
            -not ($excluded | Where-Object { $path -match $_ })
        } |
        Sort-Object -Unique

    if (-not $files) {
        throw "No source files found to deploy."
    }

    foreach ($file in $files) {
        $source = Join-Path $repoRoot ($file -replace '/', [System.IO.Path]::DirectorySeparatorChar)
        $target = Join-Path $staging ($file -replace '/', [System.IO.Path]::DirectorySeparatorChar)
        $targetDir = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir | Out-Null
        }
        Copy-Item -LiteralPath $source -Destination $target -Force
    }

    Invoke-Checked "tar" @("-czf", $archive, "-C", $staging, ".")

    if ($DryRun) {
        Write-Host "Dry run complete. Archive created at $archive"
        return
    }

    $remoteArchive = "/tmp/attendance-bot-$stamp.tgz"
    Invoke-Checked "scp" @("-i", $KeyPath, $archive, "${HostName}:$remoteArchive")

    $installCommand = if ($SkipInstall) { "node -v" } else { "npm ci --omit=dev" }
    $cronLine = "35 18 * * * cd $RemotePath && { npm run ops:external-smoke && npm run ops:security-audit && npm run ops:recovery-drill && npm run dr:backup && npm run dr:verify; npm run ops:evidence; } >> logs/disaster-recovery-cron.log 2>&1 # attendance-bot-dr`n"
    $cronBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cronLine))
    $remoteCommand = @"
set -eE
cd '$RemotePath'
mkdir -p '/home/ubuntu/deploy-backups'
rollback_archive='/home/ubuntu/deploy-backups/attendance-bot-before-$stamp.tgz'
rollback_deploy() {
    exit_code=`$?
    trap - ERR
    echo "[DEPLOY ROLLBACK] Restoring previous release after exit `$exit_code"
    pm2 stop '$AppName' || true
    tar -xzf "`$rollback_archive" -C '$RemotePath'
    npm ci --omit=dev
    pm2 startOrReload ecosystem.config.js --only '$AppName' --update-env
    pm2 save
    exit "`$exit_code"
}
trap rollback_deploy ERR
pm2 stop '$AppName' || true
sleep 2
error_log="/home/ubuntu/.pm2/logs/$AppName-error.log"
if [ -s "`$error_log" ]; then
    mkdir -p '$RemotePath/logs'
    tail -n 200 "`$error_log" > '$RemotePath/logs/predeploy-error-$stamp.log'
    : > "`$error_log"
fi
tar -czf "`$rollback_archive" --exclude='./node_modules' --exclude='./.git' --exclude='./logs' --exclude='./backups' --exclude='./attendanceData.json' --exclude='./attendanceData.json.bak' .
tar -xzf '$remoteArchive' -C '$RemotePath'
rm -f '$remoteArchive'
chmod 600 .env attendanceData.json attendanceData.json.bak
$installCommand
pm2 startOrReload ecosystem.config.js --only '$AppName' --update-env
pm2 save
sleep 10
npm run ops:external-smoke
npm run ops:security-audit
npm run ops:recovery-drill
npm run ops:health -- --allow-end-adena-degraded
npm run dr:backup
npm run dr:verify
node scripts/record-operational-evidence.js --allow-unhealthy
echo '$cronBase64' | base64 -d > /tmp/attendance-bot-dr-cron
(crontab -l 2>/dev/null | grep -v attendance-bot-dr || true; cat /tmp/attendance-bot-dr-cron) | crontab -
rm -f /tmp/attendance-bot-dr-cron
ls -1t /home/ubuntu/deploy-backups/attendance-bot-before-*.tgz 2>/dev/null | tail -n +21 | xargs -r rm -f
trap - ERR
"@
    Invoke-Remote $remoteCommand

    $localDrMirror = Join-Path $repoRoot "outputs\disaster-recovery"
    New-Item -ItemType Directory -Path $localDrMirror -Force | Out-Null
    Invoke-Checked "scp" @(
        "-i",
        $KeyPath,
        "${HostName}:/home/ubuntu/attendance-bot-dr/attendance-bot-dr-*.json.gz",
        $localDrMirror
    )
    $localBundles = Get-ChildItem -LiteralPath $localDrMirror -Filter "attendance-bot-dr-*.json.gz" |
        Sort-Object LastWriteTime -Descending
    $localBundles | Select-Object -Skip 20 | Remove-Item -Force
    $latestLocalBundle = $localBundles | Select-Object -First 1
    if (-not $latestLocalBundle) {
        throw "No local disaster recovery mirror was downloaded."
    }
    Invoke-Checked "node" @("scripts/verify-disaster-recovery-bundle.js", $latestLocalBundle.FullName)
}
finally {
    Pop-Location
}

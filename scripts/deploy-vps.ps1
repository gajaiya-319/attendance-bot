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

    $installCommand = if ($SkipInstall) { "node -v" } else { "npm install" }
    $remoteCommand = @"
set -e
cd '$RemotePath'
mkdir -p '/home/ubuntu/deploy-backups'
tar -czf '/home/ubuntu/deploy-backups/attendance-bot-before-$stamp.tgz' --exclude='./node_modules' --exclude='./.git' --exclude='./logs' --exclude='./backups' --exclude='./attendanceData.json' --exclude='./attendanceData.json.bak' .
tar -xzf '$remoteArchive' -C '$RemotePath'
rm -f '$remoteArchive'
$installCommand
pm2 restart '$AppName' --update-env
pm2 save
sleep 10
npm run ops:health
"@
    Invoke-Remote $remoteCommand
}
finally {
    Pop-Location
}

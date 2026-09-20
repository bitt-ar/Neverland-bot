# ==============================================================================
# Neverland Universal Installer (Windows PowerShell)
# Enterprise Discord Automation & Next.js 15 Web Dashboard
#
# Created by bitt-ar
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host @"

  _   _                     _                 _ 
 | \ | | _____   _____ _ __| | __ _ _ __   __| |
 |  \| |/ _ \ \ / / _ \ '__| |/ _` | '_ \ / _` |
 | |\  |  __/\ V /  __/ |  | | (_| | | | | (_| |
 |_| \_|\___| \_/ \___|_|  |_|\__,_|_| |_|\__,_|
"@ -ForegroundColor Cyan

Write-Host " Neverland Universal Installer for Windows" -ForegroundColor White
Write-Host " Created by bitt-ar | https://github.com/bitt-ar/Neverland-bot" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------`n"

# 1. Determine Installation Target
$InstallDir = $PWD.Path
if (-not (Test-Path "$InstallDir\main.py") -or -not (Test-Path "$InstallDir\dashboard")) {
    $InstallDir = "$HOME\Neverland-bot"
    Write-Host "Installing Neverland to: $InstallDir" -ForegroundColor Yellow
    if (-not (Test-Path $InstallDir)) {
        if (Get-Command git -ErrorAction SilentlyContinue) {
            git clone https://github.com/bitt-ar/Neverland-bot.git "$InstallDir"
        } else {
            Write-Host "Git is required to download Neverland. Please install Git and rerun this script." -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "  Found existing Neverland directory at $InstallDir. Updating..." -ForegroundColor Gray
        Push-Location $InstallDir
        git pull --ff-only 2>$null
        Pop-Location
    }
    Set-Location $InstallDir
}

# 2. Check Python 3.11+
Write-Host "Checking Python 3.11+ installation..." -ForegroundColor Cyan
$PythonExe = $null

$PythonCandidates = @("python", "py -3.12", "py -3.11", "py")
foreach ($cmd in $PythonCandidates) {
    try {
        $ver = & $cmd.Split(' ')[0] $cmd.Split(' ')[1..($cmd.Split(' ').Length-1)] -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        if ($ver) {
            $major = [int]($ver.Split('.')[0])
            $minor = [int]($ver.Split('.')[1])
            if ($major -ge 3 -and $minor -ge 11) {
                $PythonExe = $cmd
                Write-Host "  [OK] Found compatible Python: $cmd ($ver)" -ForegroundColor Green
                break
            }
        }
    } catch {}
}

if (-not $PythonExe) {
    Write-Host "  Python 3.11+ not detected. Attempting to install via winget..." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install -e --id Python.Python.3.11 --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $PythonExe = "python"
    } else {
        Write-Host "Please install Python 3.11 or newer from https://www.python.org/downloads/ and make sure to check 'Add Python to PATH'." -ForegroundColor Red
        exit 1
    }
}

# 3. Check Node.js
Write-Host "Checking Node.js..." -ForegroundColor Cyan
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVer = & node -v
    Write-Host "  [OK] Found Node.js: $nodeVer" -ForegroundColor Green
} else {
    Write-Host "  Node.js not detected. Attempting to install via winget..." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    } else {
        Write-Host "Please install Node.js 18+ from https://nodejs.org/" -ForegroundColor Yellow
    }
}

# 4. Set up Python Virtual Environment
Write-Host "`nSetting up Python virtual environment..." -ForegroundColor Cyan
$VenvDir = Join-Path $InstallDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
    if (Test-Path $VenvDir) {
        Remove-Item -Recurse -Force $VenvDir
    }
    & $PythonExe.Split(' ')[0] $PythonExe.Split(' ')[1..($PythonExe.Split(' ').Length-1)] -m venv $VenvDir
}

if (-not (Test-Path $VenvPython)) {
    Write-Host "Failed to create virtual environment." -ForegroundColor Red
    exit 1
}

Write-Host "Installing Python dependencies..." -ForegroundColor Cyan
& $VenvPython -m pip install --upgrade pip --quiet
& $VenvPython -m pip install -r "$InstallDir\requirements.txt"

# 5. Install Dashboard Dependencies
if (Test-Path "$InstallDir\dashboard\package.json") {
    Write-Host "`nInstalling Web Dashboard dependencies..." -ForegroundColor Cyan
    Set-Location "$InstallDir\dashboard"
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        pnpm install
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
        npm install
    }
    Set-Location $InstallDir
}

# 6. Install Global CLI Command Shim
Write-Host "`nRegistering 'neverland' CLI command..." -ForegroundColor Cyan
$BinDir = Join-Path $HOME ".neverland\bin"
if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
}

$CmdShim = Join-Path $BinDir "neverland.cmd"
$CmdContent = @"
@echo off
cd /d "$InstallDir"
"$VenvPython" -m cli %*
"@
Set-Content -Path $CmdShim -Value $CmdContent -Encoding ASCII

# Ensure User PATH contains $BinDir
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
    $env:Path = "$env:Path;$BinDir"
    Write-Host "  [OK] Added $BinDir to User PATH." -ForegroundColor Green
}

Write-Host "  [OK] 'neverland' command registered successfully." -ForegroundColor Green

# 7. First-Run Trigger: Launch neverland config
Write-Host "`n======================================================================" -ForegroundColor Cyan
Write-Host "Installation complete. Launching the interactive configuration wizard..." -ForegroundColor White
Write-Host "======================================================================`n" -ForegroundColor Cyan

Set-Location $InstallDir
& $VenvPython -m cli config

# 8. Auto-Start Trigger: Start Neverland services
$DevEnv = Join-Path $InstallDir ".neverland\profiles\dev.env"
$ProdEnv = Join-Path $InstallDir ".neverland\profiles\prod.env"

if ((Test-Path $DevEnv) -or (Test-Path $ProdEnv)) {
    Write-Host "`nStarting Neverland services..." -ForegroundColor Green
    & $VenvPython -m cli start
} else {
    Write-Host "`nSetup completed." -ForegroundColor Green
    Write-Host "Run 'neverland config' to configure your bot, then 'neverland start'." -ForegroundColor White
}

# ==============================================================================
# Neverland Universal Installer (Windows PowerShell)
# Enterprise Discord Automation & Next.js 15 Web Dashboard
#
# Created by bitt-ar
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'

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

# 0. Helper Functions
function Exit-WithPrompt {
    param([int]$ExitCode = 1, [string]$Message = "")
    if ($Message) {
        Write-Host $Message -ForegroundColor Red
    }
    try {
        if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
            Write-Host "`nPress Enter to exit..." -ForegroundColor Gray
            [void][Console]::ReadLine()
        }
    } catch {}
    exit $ExitCode
}

# 1. Determine Installation Target
$InstallDir = $PWD.Path
if (-not (Test-Path "$InstallDir\main.py") -or -not (Test-Path "$InstallDir\dashboard")) {
    $InstallDir = "$HOME\Neverland-bot"
    Write-Host "Installing Neverland to: $InstallDir" -ForegroundColor Yellow
    if (-not (Test-Path $InstallDir)) {
        $DownloadOk = $false

        # Strategy A: Clone using Git if available
        if (Get-Command git -ErrorAction SilentlyContinue) {
            Write-Host "Cloning Neverland repository via Git..." -ForegroundColor Cyan
            git clone https://github.com/bitt-ar/Neverland-bot.git "$InstallDir"
            if ($LASTEXITCODE -eq 0 -and (Test-Path "$InstallDir\main.py")) {
                $DownloadOk = $true
            }
        }

        # Strategy B: Try installing Git via winget
        if (-not $DownloadOk -and (Get-Command winget -ErrorAction SilentlyContinue)) {
            Write-Host "Git not found or clone failed. Attempting to install Git via winget..." -ForegroundColor Yellow
            winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            if (Get-Command git -ErrorAction SilentlyContinue) {
                Write-Host "Cloning Neverland repository via newly installed Git..." -ForegroundColor Cyan
                git clone https://github.com/bitt-ar/Neverland-bot.git "$InstallDir"
                if ($LASTEXITCODE -eq 0 -and (Test-Path "$InstallDir\main.py")) {
                    $DownloadOk = $true
                }
            }
        }

        # Strategy C: Zero-Dependency Fallback: Download Neverland archive directly from GitHub
        if (-not $DownloadOk) {
            Write-Host "Git is not installed. Downloading Neverland source package directly from GitHub..." -ForegroundColor Cyan
            $ZipUrl = "https://github.com/bitt-ar/Neverland-bot/archive/refs/heads/main.zip"
            $TempZip = Join-Path ([System.IO.Path]::GetTempPath()) "Neverland-bot-main.zip"
            $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "Neverland-bot-temp-$([System.Guid]::NewGuid().ToString('N'))"
            try {
                [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls13
                Invoke-WebRequest -Uri $ZipUrl -OutFile $TempZip -UseBasicParsing
                Expand-Archive -Path $TempZip -DestinationPath $TempDir -Force
                $Extracted = Join-Path $TempDir "Neverland-bot-main"
                if (-not (Test-Path $Extracted)) {
                    $firstDir = Get-ChildItem -Path $TempDir -Directory | Select-Object -First 1
                    if ($firstDir) { $Extracted = $firstDir.FullName }
                }
                New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
                Copy-Item -Path "$Extracted\*" -Destination $InstallDir -Recurse -Force
                Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
                Remove-Item -Force $TempZip -ErrorAction SilentlyContinue
                if (Test-Path "$InstallDir\main.py") {
                    $DownloadOk = $true
                    Write-Host "  [OK] Successfully downloaded Neverland without Git!" -ForegroundColor Green
                }
            } catch {
                Write-Host "  Direct download failed: $_" -ForegroundColor Red
            }
        }

        if (-not $DownloadOk -or -not (Test-Path "$InstallDir\main.py")) {
            Exit-WithPrompt 1 "Failed to download Neverland repository. Please check your internet connection."
        }
    } else {
        Write-Host "  Found existing Neverland directory at $InstallDir. Updating..." -ForegroundColor Gray
        if (Get-Command git -ErrorAction SilentlyContinue -and (Test-Path "$InstallDir\.git")) {
            Push-Location $InstallDir
            git pull --ff-only 2>$null
            Pop-Location
        } else {
            Write-Host "  [Notice] Found existing Neverland installation. Proceeding with configuration..." -ForegroundColor Gray
        }
    }
    Set-Location $InstallDir
}

# 2. Check Python 3.11+
Write-Host "Checking Python 3.11+ installation..." -ForegroundColor Cyan
$PythonExe = $null

$PythonCandidates = @("python", "python3", "py", "py -3.14", "py -3.13", "py -3.12", "py -3.11")
foreach ($cmd in $PythonCandidates) {
    $parts = $cmd -split '\s+'
    $exe = $parts[0]
    $exeArgs = if ($parts.Length -gt 1) { $parts[1..($parts.Length - 1)] } else { @() }
    try {
        $ver = & $exe @exeArgs -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        if ($ver) {
            $ver = $ver.Trim()
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
        
        $verifyCandidates = @("py -3.11", "python", "python3", "py")
        foreach ($cmd in $verifyCandidates) {
            $parts = $cmd -split '\s+'
            $exe = $parts[0]
            $exeArgs = if ($parts.Length -gt 1) { $parts[1..($parts.Length - 1)] } else { @() }
            try {
                $ver = & $exe @exeArgs -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
                if ($ver) {
                    $ver = $ver.Trim()
                    $major = [int]($ver.Split('.')[0])
                    $minor = [int]($ver.Split('.')[1])
                    if ($major -ge 3 -and $minor -ge 11) {
                        $PythonExe = $cmd
                        Write-Host "  [OK] Python installed successfully: $cmd ($ver)" -ForegroundColor Green
                        break
                    }
                }
            } catch {}
        }
    }
    
    if (-not $PythonExe) {
        Write-Host "  winget unavailable or failed. Downloading official Python 3.11 from python.org..." -ForegroundColor Yellow
        $PyInstaller = Join-Path ([System.IO.Path]::GetTempPath()) "python-3.11.9-amd64.exe"
        try {
            [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls13
            Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe" -OutFile $PyInstaller -UseBasicParsing
            Write-Host "  Installing Python 3.11 silently (this may take a minute)..." -ForegroundColor Cyan
            Start-Process -FilePath $PyInstaller -ArgumentList "/quiet InstallAllUsers=0 PrependPath=1 Include_test=0" -Wait
            Remove-Item -Force $PyInstaller -ErrorAction SilentlyContinue
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

            $verifyCandidates = @("py -3.11", "python", "python3", "py")
            foreach ($cmd in $verifyCandidates) {
                $parts = $cmd -split '\s+'
                $exe = $parts[0]
                $exeArgs = if ($parts.Length -gt 1) { $parts[1..($parts.Length - 1)] } else { @() }
                try {
                    $ver = & $exe @exeArgs -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
                    if ($ver) {
                        $ver = $ver.Trim()
                        $major = [int]($ver.Split('.')[0])
                        $minor = [int]($ver.Split('.')[1])
                        if ($major -ge 3 -and $minor -ge 11) {
                            $PythonExe = $cmd
                            Write-Host "  [OK] Python installed successfully: $cmd ($ver)" -ForegroundColor Green
                            break
                        }
                    }
                } catch {}
            }
        } catch {
            Write-Host "  Direct Python download failed: $_" -ForegroundColor Red
        }
    }
    
    if (-not $PythonExe) {
        Exit-WithPrompt 1 "Please install Python 3.11 or newer from https://www.python.org/downloads/ and make sure to check 'Add Python to PATH'."
    }
}

# 3. Check Node.js (v18.18+ required for Next.js 15)
Write-Host "Checking Node.js..." -ForegroundColor Cyan

$NodeDir = Join-Path $HOME ".neverland\node"
$commonNodeDirs = @(
    $NodeDir,
    "$env:ProgramFiles\nodejs",
    "${env:ProgramFiles(x86)}\nodejs",
    "$env:LOCALAPPDATA\Programs\node"
)
foreach ($nd in $commonNodeDirs) {
    if ((Test-Path "$nd\node.exe") -and ($env:Path -notlike "*$nd*")) {
        $env:Path = "$nd;$env:Path"
    }
}

$NodeOk = $false
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVer = & node -v
    try {
        $nodeMajor = [int]($nodeVer.TrimStart('v').Split('.')[0])
        if ($nodeMajor -ge 18) {
            $NodeOk = $true
            Write-Host "  [OK] Found Node.js: $nodeVer" -ForegroundColor Green
        } else {
            Write-Host "  [WARNING] Found Node.js $nodeVer, but Next.js 15 requires Node.js >= 18.18." -ForegroundColor Yellow
        }
    } catch {
        $NodeOk = $true
        Write-Host "  [OK] Found Node.js: $nodeVer" -ForegroundColor Green
    }
}

if (-not $NodeOk) {
    Write-Host "  Node.js 18+ not found. Downloading standalone portable Node.js LTS (zero-admin)..." -ForegroundColor Cyan
    $NodeZipUrl = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip"
    $TempZip = Join-Path ([System.IO.Path]::GetTempPath()) "node-v20-win-x64.zip"
    $TempExtract = Join-Path ([System.IO.Path]::GetTempPath()) "node-extract-$([System.Guid]::NewGuid().ToString('N'))"
    try {
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls13
        Write-Host "  Downloading portable Node.js v20 LTS archive (~28 MB)..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $NodeZipUrl -OutFile $TempZip -UseBasicParsing
        Write-Host "  Extracting Node.js into $NodeDir..." -ForegroundColor Cyan
        Expand-Archive -Path $TempZip -DestinationPath $TempExtract -Force
        
        $ExtractedNode = (Get-ChildItem -Path $TempExtract -Directory | Select-Object -First 1).FullName
        if (-not (Test-Path $NodeDir)) {
            New-Item -ItemType Directory -Path $NodeDir -Force | Out-Null
        }
        Copy-Item -Path "$ExtractedNode\*" -Destination $NodeDir -Recurse -Force
        
        Remove-Item -Recurse -Force $TempExtract -ErrorAction SilentlyContinue
        Remove-Item -Force $TempZip -ErrorAction SilentlyContinue
        
        $env:Path = "$NodeDir;$env:Path"
        
        try {
            $UserKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
            if ($UserKey) {
                $cur = $UserKey.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
                if ($cur -notlike "*$NodeDir*") {
                    $newP = if ($cur) { "$cur;$NodeDir" } else { $NodeDir }
                    $UserKey.SetValue("Path", $newP, [Microsoft.Win32.RegistryValueKind]::ExpandString)
                }
                $UserKey.Close()
            }
        } catch {}

        if (Test-Path "$NodeDir\node.exe") {
            $nodeVer = & "$NodeDir\node.exe" -v
            $NodeOk = $true
            Write-Host "  [OK] Standalone portable Node.js installed successfully: $nodeVer" -ForegroundColor Green
        }
    } catch {
        Write-Host "  [Notice] Portable Node.js download failed: $_. Trying winget..." -ForegroundColor Yellow
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            if (Get-Command node -ErrorAction SilentlyContinue) {
                $nodeVer = & node -v
                $NodeOk = $true
                Write-Host "  [OK] Node.js installed successfully: $nodeVer" -ForegroundColor Green
            }
        }
    }

    if (-not $NodeOk) {
        Write-Host "  [Notice] Node.js could not be installed automatically. Please install Node.js 18+ from https://nodejs.org/ for the web dashboard." -ForegroundColor Yellow
    }
}

# 3.5 Check & Install FFmpeg (Required for Discord Audio & Radio)
Write-Host "Checking FFmpeg..." -ForegroundColor Cyan
$FfmpegOk = $false
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
    try {
        $ffmpegVer = (& ffmpeg -version | Select-Object -First 1)
        Write-Host "  [OK] Found FFmpeg: $ffmpegVer (skipping installation)" -ForegroundColor Green
        $FfmpegOk = $true
    } catch {
        $FfmpegOk = $false
    }
}

if (-not $FfmpegOk) {
    Write-Host "  FFmpeg not found. Attempting to install via winget..." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
            $FfmpegOk = $true
            Write-Host "  [OK] FFmpeg installed successfully." -ForegroundColor Green
        }
    }
    if (-not $FfmpegOk -and (Get-Command choco -ErrorAction SilentlyContinue)) {
        choco install ffmpeg -y
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
            $FfmpegOk = $true
            Write-Host "  [OK] FFmpeg installed successfully via Chocolatey." -ForegroundColor Green
        }
    }
    if (-not $FfmpegOk) {
        Write-Host "  winget/choco not available. Downloading standalone FFmpeg for Windows..." -ForegroundColor Yellow
        $BinDir = Join-Path $HOME ".neverland\bin"
        if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Path $BinDir -Force | Out-Null }
        $ZipUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
        $TmpZip = Join-Path ([System.IO.Path]::GetTempPath()) "ffmpeg_temp.zip"
        try {
            [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls13
            Invoke-WebRequest -Uri $ZipUrl -OutFile $TmpZip -UseBasicParsing
            $TmpExtract = Join-Path ([System.IO.Path]::GetTempPath()) "ffmpeg_extract_$([System.Guid]::NewGuid().ToString('N'))"
            Expand-Archive -Path $TmpZip -DestinationPath $TmpExtract -Force
            Get-ChildItem -Path $TmpExtract -Recurse -Filter "ffmpeg.exe" | ForEach-Object { Copy-Item -Path $_.FullName -Destination $BinDir -Force }
            Get-ChildItem -Path $TmpExtract -Recurse -Filter "ffprobe.exe" | ForEach-Object { Copy-Item -Path $_.FullName -Destination $BinDir -Force }
            Remove-Item -Recurse -Force $TmpExtract -ErrorAction SilentlyContinue
            Remove-Item -Force $TmpZip -ErrorAction SilentlyContinue
            $env:Path = "$env:Path;$BinDir"
            if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
                $FfmpegOk = $true
                Write-Host "  [OK] Standalone FFmpeg installed successfully." -ForegroundColor Green
            }
        } catch {
            Write-Host "  [Notice] Standalone FFmpeg download skipped: $_" -ForegroundColor Gray
        }
    }
    if (-not $FfmpegOk) {
        Write-Host "  [Notice] FFmpeg can also be checked and installed anytime via 'neverland ffmpeg'." -ForegroundColor Yellow
    }
}

# 4. Set up Python Virtual Environment
Write-Host "`nSetting up Python virtual environment..." -ForegroundColor Cyan
$VenvDir = Join-Path $InstallDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
    if (Test-Path $VenvDir) {
        try {
            Remove-Item -Recurse -Force $VenvDir -ErrorAction Stop
        } catch {
            Write-Host "  [Notice] Existing .venv directory will be overwritten." -ForegroundColor Gray
        }
    }
    $parts = $PythonExe -split '\s+'
    $exe = $parts[0]
    $exeArgs = if ($parts.Length -gt 1) { $parts[1..($parts.Length - 1)] } else { @() }
    & $exe @exeArgs -m venv $VenvDir
}

if (-not (Test-Path $VenvPython)) {
    Exit-WithPrompt 1 "Failed to create virtual environment in $VenvDir."
}

Write-Host "Installing Python dependencies..." -ForegroundColor Cyan
& $VenvPython -m pip install --upgrade pip --quiet
& $VenvPython -m pip install -r "$InstallDir\requirements.txt"

# 5. Install Dashboard Dependencies
if (Test-Path "$InstallDir\dashboard\package.json") {
    Write-Host "`nInstalling Web Dashboard dependencies..." -ForegroundColor Cyan
    Set-Location "$InstallDir\dashboard"
    
    $npmExe = $null
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        $npmExe = "pnpm"
    } elseif (Test-Path "$NodeDir\npm.cmd") {
        $npmExe = "$NodeDir\npm.cmd"
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
        $npmExe = "npm"
    }
    
    if ($npmExe) {
        Write-Host "  Installing packages via $npmExe..." -ForegroundColor Cyan
        & $npmExe install
    } else {
        Write-Host "  [Warning] Neither pnpm nor npm found. Please install Node.js (https://nodejs.org) to build the dashboard." -ForegroundColor Yellow
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
set "PATH=%USERPROFILE%\.neverland\node;%USERPROFILE%\.neverland\bin;%PATH%"
cd /d "$InstallDir"
"$VenvPython" -m cli %*
"@
Set-Content -Path $CmdShim -Value $CmdContent -Encoding UTF8

# Ensure User PATH contains $BinDir safely preserving REG_EXPAND_SZ
try {
    $UserKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
    if ($UserKey) {
        $UserPath = $UserKey.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($UserPath -notlike "*$BinDir*") {
            $NewPath = if ($UserPath) { "$UserPath;$BinDir" } else { $BinDir }
            $UserKey.SetValue("Path", $NewPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
            $env:Path = "$env:Path;$BinDir"
            Write-Host "  [OK] Added $BinDir to User PATH." -ForegroundColor Green
        }
        $UserKey.Close()
    }
} catch {
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($UserPath -notlike "*$BinDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
        $env:Path = "$env:Path;$BinDir"
        Write-Host "  [OK] Added $BinDir to User PATH." -ForegroundColor Green
    }
}

Write-Host "  [OK] 'neverland' command registered successfully." -ForegroundColor Green

# 7. First-Run Trigger: Launch neverland config (with interactive TTY detection)
$IsInteractive = $false
try {
    if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
        $IsInteractive = $true
    }
} catch {
    $IsInteractive = $false
}

Set-Location $InstallDir

if ($IsInteractive) {
    Write-Host "`n======================================================================" -ForegroundColor Cyan
    Write-Host "Installation complete. Launching the interactive configuration wizard..." -ForegroundColor White
    Write-Host "======================================================================`n" -ForegroundColor Cyan

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
} else {
    Write-Host "`n======================================================================" -ForegroundColor Green
    Write-Host "Neverland installed successfully (Pipeline / Non-Interactive Mode)!" -ForegroundColor White
    Write-Host "======================================================================`n" -ForegroundColor Green
    Write-Host "To configure your bot and dashboard interactively, run:" -ForegroundColor White
    Write-Host "  neverland config`n" -ForegroundColor Cyan
    Write-Host "Then start your services with:" -ForegroundColor White
    Write-Host "  neverland start`n" -ForegroundColor Green
    Write-Host "Or check real-time status with:" -ForegroundColor White
    Write-Host "  neverland status`n" -ForegroundColor Cyan
}

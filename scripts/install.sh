#!/usr/bin/env bash
# ==============================================================================
# Neverland Universal Installer (Multi-Distribution Linux & macOS)
# Enterprise Discord Automation & Next.js 15 Web Dashboard
#
# Supported Distributions:
#   Debian, Ubuntu, Linux Mint, Pop!_OS, Elementary OS, Kali Linux, Parrot
#   Fedora, RHEL, CentOS Stream, Rocky Linux, AlmaLinux, Amazon Linux, Oracle Linux
#   Arch Linux, Manjaro, EndeavourOS, Garuda Linux, SteamOS
#   openSUSE Leap, openSUSE Tumbleweed, SUSE Linux Enterprise
#   Alpine Linux (Containers & Lightweight Hosts)
#   Void Linux
#   macOS (Homebrew)
#
# Created by bitt-ar | https://github.com/bitt-ar/Neverland-bot
# ==============================================================================

set -e

# ANSI Colors
C_CYAN='\033[0;36m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[1;33m'
C_RED='\033[0;31m'
C_BOLD='\033[1m'
C_DIM='\033[2m'
C_RESET='\033[0m'

echo -e "${C_CYAN}${C_BOLD}"
cat << "EOF"
  _   _                     _                 _ 
 | \ | | _____   _____ _ __| | __ _ _ __   __| |
 |  \| |/ _ \ \ / / _ \ '__| |/ _` | '_ \ / _` |
 | |\  |  __/\ V /  __/ |  | | (_| | | | | (_| |
 |_| \_|\___| \_/ \___|_|  |_|\__,_|_| |_|\__,_|
EOF
echo -e "${C_RESET}${C_BOLD} Neverland Universal Installer (Linux & macOS)${C_RESET}"
echo -e " Created by bitt-ar | https://github.com/bitt-ar/Neverland-bot"
echo -e "----------------------------------------------------------------------\n"

# ------------------------------------------------------------------------------
# 1. Environment & Distribution Detection
# ------------------------------------------------------------------------------

# Detect Privilege Escalation Tool
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    elif command -v doas >/dev/null 2>&1; then
        SUDO="doas"
    fi
fi

# Detect Operating System & Distribution
detect_os_info() {
    DISTRO_NAME=""
    if [ -f /etc/os-release ]; then
        DISTRO_NAME=$(grep -E '^(PRETTY_NAME|NAME)=' /etc/os-release | head -n 1 | cut -d= -f2 | tr -d '"')
    elif [ -f /etc/redhat-release ]; then
        DISTRO_NAME=$(cat /etc/redhat-release)
    elif [ -f /etc/debian_version ]; then
        DISTRO_NAME="Debian $(cat /etc/debian_version)"
    elif [ "$(uname)" = "Darwin" ]; then
        DISTRO_NAME="macOS $(sw_vers -productVersion 2>/dev/null || echo '')"
    else
        DISTRO_NAME="$(uname -s)"
    fi
    echo "$DISTRO_NAME"
}

# Detect System Package Manager
detect_package_manager() {
    if command -v apt-get >/dev/null 2>&1; then
        echo "apt"
    elif command -v dnf >/dev/null 2>&1; then
        echo "dnf"
    elif command -v yum >/dev/null 2>&1; then
        echo "yum"
    elif command -v pacman >/dev/null 2>&1; then
        echo "pacman"
    elif command -v zypper >/dev/null 2>&1; then
        echo "zypper"
    elif command -v apk >/dev/null 2>&1; then
        echo "apk"
    elif command -v xbps-install >/dev/null 2>&1; then
        echo "xbps"
    elif [ "$(uname)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
        echo "brew"
    else
        echo "unknown"
    fi
}

PKG_MGR=$(detect_package_manager)
SYSTEM_NAME=$(detect_os_info)
ARCH_NAME=$(uname -m)

echo -e "${C_BOLD}Detecting system environment...${C_RESET}"
echo -e "  [OK] System: ${C_CYAN}$SYSTEM_NAME${C_RESET} ($ARCH_NAME)"
echo -e "  [OK] Package Manager: ${C_CYAN}$PKG_MGR${C_RESET}\n"

# Helper to install packages using the detected package manager
install_system_packages() {
    PACKAGES="$@"
    case "$PKG_MGR" in
        apt)
            $SUDO apt-get update -qq 2>/dev/null || true
            $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $PACKAGES 2>/dev/null || \
            $SUDO apt-get install -y $PACKAGES
            ;;
        dnf)
            $SUDO dnf install -y -q $PACKAGES 2>/dev/null || $SUDO dnf install -y $PACKAGES
            ;;
        yum)
            $SUDO yum install -y -q $PACKAGES 2>/dev/null || $SUDO yum install -y $PACKAGES
            ;;
        pacman)
            $SUDO pacman -Sy --noconfirm --needed $PACKAGES
            ;;
        zypper)
            $SUDO zypper --non-interactive in $PACKAGES
            ;;
        apk)
            $SUDO apk update 2>/dev/null || true
            $SUDO apk add --no-cache $PACKAGES
            ;;
        xbps)
            $SUDO xbps-install -S -y $PACKAGES
            ;;
        brew)
            brew install $PACKAGES
            ;;
        *)
            return 1
            ;;
    esac
}

# ------------------------------------------------------------------------------
# 2. Prerequisites: Ensure Git & Core Tools are Present
# ------------------------------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
    echo -e "${C_YELLOW}Git is not installed. Attempting installation via $PKG_MGR...${C_RESET}"
    install_system_packages git || true
fi

# ------------------------------------------------------------------------------
# 3. Detect / Clone Installation Directory
# ------------------------------------------------------------------------------
INSTALL_DIR="$PWD"
if [ ! -f "$INSTALL_DIR/main.py" ] || [ ! -d "$INSTALL_DIR/dashboard" ]; then
    INSTALL_DIR="$HOME/Neverland-bot"
    echo -e "${C_YELLOW}Installing Neverland to: ${C_BOLD}$INSTALL_DIR${C_RESET}"
    if [ ! -d "$INSTALL_DIR" ]; then
        if command -v git >/dev/null 2>&1; then
            git clone https://github.com/bitt-ar/Neverland-bot.git "$INSTALL_DIR"
        else
            echo -e "${C_RED}Error: Git is required to download Neverland. Please install git and retry.${C_RESET}"
            exit 1
        fi
    else
        echo -e "  Found existing Neverland installation at $INSTALL_DIR. Updating repository..."
        (cd "$INSTALL_DIR" && git pull --ff-only 2>/dev/null || true)
    fi
    cd "$INSTALL_DIR"
fi

# ------------------------------------------------------------------------------
# 4. Check & Install Python 3.11+
# ------------------------------------------------------------------------------
echo -e "\n${C_BOLD}Checking Python installation...${C_RESET}"
PYTHON_BIN=""

for cmd in python3.13 python3.12 python3.11 python3 python; do
    if command -v "$cmd" >/dev/null 2>&1; then
        VER=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "0.0")
        MAJOR=$(echo "$VER" | cut -d. -f1)
        MINOR=$(echo "$VER" | cut -d. -f2)
        if [ "$MAJOR" -ge 3 ] && [ "$MINOR" -ge 11 ]; then
            PYTHON_BIN="$cmd"
            echo -e "  [OK] Found compatible Python: $cmd ($VER)"
            break
        fi
    fi
done

if [ -z "$PYTHON_BIN" ]; then
    echo -e "  Python 3.11+ not found. Attempting package manager installation..."
    case "$PKG_MGR" in
        apt)
            install_system_packages python3 python3-pip python3-venv git curl
            PYTHON_BIN="python3"
            ;;
        dnf)
            install_system_packages python3 python3-pip git curl
            PYTHON_BIN="python3"
            ;;
        yum)
            install_system_packages python3 python3-pip git curl
            PYTHON_BIN="python3"
            ;;
        pacman)
            install_system_packages python python-pip git curl
            PYTHON_BIN="python"
            ;;
        zypper)
            install_system_packages python311 python311-pip python311-virtualenv git curl 2>/dev/null || \
            install_system_packages python3 python3-pip git curl
            PYTHON_BIN="python3"
            ;;
        apk)
            install_system_packages python3 py3-pip py3-virtualenv git curl bash
            PYTHON_BIN="python3"
            ;;
        xbps)
            install_system_packages python3 python3-pip git curl
            PYTHON_BIN="python3"
            ;;
        brew)
            brew install python@3.11 git curl
            PYTHON_BIN="python3.11"
            ;;
        *)
            echo -e "${C_RED}Error: Could not install Python 3.11+ automatically.${C_RESET}"
            echo -e "Please install Python 3.11 or newer using your system package manager."
            exit 1
            ;;
    esac
fi

# Ensure distribution-specific venv packages are installed
if [ -n "$PYTHON_BIN" ]; then
    case "$PKG_MGR" in
        apt)
            if ! "$PYTHON_BIN" -c "import ensurepip" >/dev/null 2>&1; then
                echo -e "  Installing system venv packages for $PYTHON_BIN..."
                install_system_packages "${PYTHON_BIN}-venv" python3-venv python3-pip 2>/dev/null || \
                install_system_packages python3-venv python3-pip 2>/dev/null || true
            fi
            ;;
        apk)
            if ! "$PYTHON_BIN" -c "import ensurepip" >/dev/null 2>&1; then
                install_system_packages py3-virtualenv py3-pip 2>/dev/null || true
            fi
            ;;
        zypper)
            if ! "$PYTHON_BIN" -c "import ensurepip" >/dev/null 2>&1; then
                install_system_packages python3-virtualenv 2>/dev/null || true
            fi
            ;;
    esac
fi

# ------------------------------------------------------------------------------
# 5. Check Node.js & Dashboard Prerequisites
# ------------------------------------------------------------------------------
echo -e "\n${C_BOLD}Checking Node.js & Dashboard prerequisites...${C_RESET}"
if ! command -v node >/dev/null 2>&1; then
    echo -e "  Node.js not detected. Attempting to install via $PKG_MGR..."
    case "$PKG_MGR" in
        apt)
            install_system_packages nodejs npm 2>/dev/null || true
            ;;
        dnf)
            install_system_packages nodejs npm 2>/dev/null || true
            ;;
        yum)
            install_system_packages nodejs npm 2>/dev/null || true
            ;;
        pacman)
            install_system_packages nodejs npm 2>/dev/null || true
            ;;
        zypper)
            install_system_packages nodejs npm 2>/dev/null || true
            ;;
        apk)
            install_system_packages nodejs npm 2>/dev/null || true
            ;;
        xbps)
            install_system_packages nodejs 2>/dev/null || true
            ;;
        brew)
            brew install node 2>/dev/null || true
            ;;
    esac
fi

if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v)
    echo -e "  [OK] Found Node.js: $NODE_VER"
else
    echo -e "  ${C_YELLOW}Notice: Node.js 18+ is required to run the Web Dashboard.${C_RESET}"
    echo -e "  ${C_DIM}You can install it later from https://nodejs.org or via your package manager.${C_RESET}"
fi

PKG_RUNNER="npm"
if command -v pnpm >/dev/null 2>&1; then
    PKG_RUNNER="pnpm"
elif command -v npm >/dev/null 2>&1; then
    PKG_RUNNER="npm"
fi

# ------------------------------------------------------------------------------
# 6. Universal Python Virtual Environment Setup & Pip Bootstrap
# ------------------------------------------------------------------------------
echo -e "\n${C_BOLD}Setting up Python environment...${C_RESET}"
VENV_PYTHON="$INSTALL_DIR/.venv/bin/python"

# Clean up broken virtual environments (e.g., failed past runs without executable)
if [ -d ".venv" ] && [ ! -f "$VENV_PYTHON" ]; then
    echo -e "  Cleaning incomplete virtual environment..."
    rm -rf .venv
fi

# Create virtual environment (with universal --without-pip fallback)
if [ ! -f "$VENV_PYTHON" ]; then
    echo -e "  Creating virtual environment with $PYTHON_BIN..."
    if ! "$PYTHON_BIN" -m venv .venv 2>/dev/null; then
        echo -e "  Standard venv creation failed; attempting universal fallback (--without-pip)..."
        rm -rf .venv
        if ! "$PYTHON_BIN" -m venv --without-pip .venv; then
            echo -e "${C_RED}Error: Failed to create Python virtual environment with $PYTHON_BIN.${C_RESET}"
            exit 1
        fi
    fi
fi

# Ensure pip is present inside the virtual environment
if ! "$VENV_PYTHON" -m pip --version >/dev/null 2>&1; then
    echo -e "  Bootstrapping pip inside virtual environment..."
    BOOTSTRAPPED=0

    # Strategy 1: Built-in ensurepip
    if "$VENV_PYTHON" -m ensurepip --upgrade >/dev/null 2>&1; then
        BOOTSTRAPPED=1
        echo -e "  [OK] pip bootstrapped via ensurepip."
    fi

    # Strategy 2: Official get-pip.py via curl
    if [ "$BOOTSTRAPPED" -eq 0 ] && command -v curl >/dev/null 2>&1; then
        echo -e "  Downloading pip bootstrap via curl..."
        if curl -fsSL https://bootstrap.pypa.io/get-pip.py | "$VENV_PYTHON"; then
            BOOTSTRAPPED=1
        fi
    fi

    # Strategy 3: Official get-pip.py via wget
    if [ "$BOOTSTRAPPED" -eq 0 ] && command -v wget >/dev/null 2>&1; then
        echo -e "  Downloading pip bootstrap via wget..."
        if wget -qO- https://bootstrap.pypa.io/get-pip.py | "$VENV_PYTHON"; then
            BOOTSTRAPPED=1
        fi
    fi

    # Strategy 4: Download via Python standard library urllib (zero external tool dependency)
    if [ "$BOOTSTRAPPED" -eq 0 ]; then
        echo -e "  Downloading pip bootstrap via Python standard library..."
        if "$VENV_PYTHON" -c "import urllib.request; urllib.request.urlretrieve('https://bootstrap.pypa.io/get-pip.py', 'get-pip.py')" 2>/dev/null; then
            if "$VENV_PYTHON" get-pip.py; then
                BOOTSTRAPPED=1
            fi
            rm -f get-pip.py
        fi
    fi

    if [ "$BOOTSTRAPPED" -eq 0 ] || ! "$VENV_PYTHON" -m pip --version >/dev/null 2>&1; then
        echo -e "${C_RED}Error: Failed to bootstrap pip inside virtual environment.${C_RESET}"
        echo -e "Please install python3-pip or python3-venv using your system package manager."
        exit 1
    fi
fi

echo -e "  [OK] Python virtual environment ready: $VENV_PYTHON"
echo -e "${C_BOLD}Installing Python dependencies...${C_RESET}"
"$VENV_PYTHON" -m pip install --upgrade pip --quiet
"$VENV_PYTHON" -m pip install -r requirements.txt

# ------------------------------------------------------------------------------
# 7. Install Web Dashboard Dependencies
# ------------------------------------------------------------------------------
if [ -d "dashboard" ] && [ -f "dashboard/package.json" ]; then
    if command -v node >/dev/null 2>&1 && command -v "$PKG_RUNNER" >/dev/null 2>&1; then
        echo -e "\n${C_BOLD}Installing Web Dashboard dependencies with $PKG_RUNNER...${C_RESET}"
        cd dashboard
        $PKG_RUNNER install
        cd "$INSTALL_DIR"
    else
        echo -e "\n${C_YELLOW}Node.js or $PKG_RUNNER not found. Skipping Web Dashboard package installation.${C_RESET}"
        echo -e "${C_DIM}Install Node.js 18+ and run 'neverland start' to complete dashboard setup.${C_RESET}"
    fi
fi

# ------------------------------------------------------------------------------
# 8. Install Global 'neverland' CLI Executable Shim
# ------------------------------------------------------------------------------
echo -e "\n${C_BOLD}Installing 'neverland' CLI command...${C_RESET}"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"

SHIM_FILE="$BIN_DIR/neverland"
cat << EOF > "$SHIM_FILE"
#!/usr/bin/env bash
export NEVERLAND_HOME="$INSTALL_DIR"
cd "$INSTALL_DIR"
exec "$VENV_PYTHON" -m cli "\$@"
EOF
chmod +x "$SHIM_FILE"

# Ensure ~/.local/bin is registered across shell profiles
case ":$PATH:" in
    *":$BIN_DIR:"*)
        ;;
    *)
        for profile in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
            if [ -f "$profile" ]; then
                if ! grep -q "$BIN_DIR" "$profile" 2>/dev/null; then
                    echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$profile"
                fi
            fi
        done
        export PATH="$BIN_DIR:$PATH"
        ;;
esac

echo -e "  [OK] 'neverland' CLI command installed to $SHIM_FILE"

# ------------------------------------------------------------------------------
# 9. Interactive Configuration Wizard Trigger
# ------------------------------------------------------------------------------
echo -e "\n${C_CYAN}${C_BOLD}======================================================================${C_RESET}"
echo -e "${C_BOLD}Installation complete. Launching the interactive configuration wizard...${C_RESET}"
echo -e "${C_CYAN}${C_BOLD}======================================================================${C_RESET}\n"

cd "$INSTALL_DIR"

if [ -t 0 ]; then
    "$VENV_PYTHON" -m cli config || true
elif [ -c /dev/tty ]; then
    "$VENV_PYTHON" -m cli config < /dev/tty || true
else
    echo -e "  Non-interactive shell detected. Skipping interactive configuration."
    echo -e "  Run ${C_BOLD}neverland config${C_RESET} to configure Neverland interactively."
fi

# ------------------------------------------------------------------------------
# 10. Service Auto-Start Trigger
# ------------------------------------------------------------------------------
ACTIVE_MODE=""
if [ -d "$INSTALL_DIR" ]; then
    ACTIVE_MODE=$("$VENV_PYTHON" -c "from cli.neverland import resolve_active_mode; print(resolve_active_mode() or '')" 2>/dev/null || echo "")
fi

if [ -z "$ACTIVE_MODE" ]; then
    if [ -f "$INSTALL_DIR/.neverland/profiles/prod.env" ]; then
        ACTIVE_MODE="prod"
    elif [ -f "$INSTALL_DIR/.neverland/profiles/dev.env" ]; then
        ACTIVE_MODE="dev"
    fi
fi

if [ -n "$ACTIVE_MODE" ] && [ -f "$INSTALL_DIR/.neverland/profiles/${ACTIVE_MODE}.env" ]; then
    echo -e "\n${C_BOLD}Starting Neverland in ${ACTIVE_MODE} mode...${C_RESET}"
    "$VENV_PYTHON" -m cli start --mode "$ACTIVE_MODE"
else
    echo -e "\n${C_BOLD}Setup finished.${C_RESET}"
    echo -e "Run ${C_BOLD}neverland config${C_RESET} to configure your bot, then ${C_BOLD}neverland start${C_RESET}."
fi

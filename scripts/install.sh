#!/usr/bin/env bash
# ==============================================================================
# Neverland Universal Installer (Linux & macOS)
# Enterprise Discord Automation & Next.js 15 Web Dashboard
#
# Created by bitt-ar
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

# 1. Detect Installation Directory
INSTALL_DIR="$PWD"
if [ ! -f "$INSTALL_DIR/main.py" ] || [ ! -d "$INSTALL_DIR/dashboard" ]; then
    INSTALL_DIR="$HOME/Neverland-bot"
    echo -e "${C_YELLOW}Installing Neverland to: ${C_BOLD}$INSTALL_DIR${C_RESET}"
    if [ ! -d "$INSTALL_DIR" ]; then
        if command -v git >/dev/null 2>&1; then
            git clone https://github.com/bitt-ar/Neverland-bot.git "$INSTALL_DIR"
        else
            echo -e "${C_RED}Git is required to download Neverland. Please install git and retry.${C_RESET}"
            exit 1
        fi
    else
        echo -e "  Found existing Neverland directory at $INSTALL_DIR. Updating repository..."
        (cd "$INSTALL_DIR" && git pull --ff-only 2>/dev/null || true)
    fi
    cd "$INSTALL_DIR"
fi

# 2. Check Python 3.11+
echo -e "${C_BOLD}Checking Python installation...${C_RESET}"
PYTHON_BIN=""

for cmd in python3.12 python3.11 python3 python; do
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
    if [ "$(uname)" = "Darwin" ]; then
        if command -v brew >/dev/null 2>&1; then
            brew install python@3.11
            PYTHON_BIN="python3.11"
        else
            echo -e "${C_RED}Homebrew not found. Please install Python 3.11+ manually.${C_RESET}"
            exit 1
        fi
    elif [ -f /etc/debian_version ] || command -v apt-get >/dev/null 2>&1; then
        SUDO_CMD=""
        if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
            SUDO_CMD="sudo"
        fi
        $SUDO_CMD apt-get update && $SUDO_CMD apt-get install -y python3 python3-pip python3-venv
        PYTHON_BIN="python3"
    elif [ -f /etc/redhat-release ]; then
        SUDO_CMD=""
        if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
            SUDO_CMD="sudo"
        fi
        $SUDO_CMD dnf install -y python3 python3-pip
        PYTHON_BIN="python3"
    else
        echo -e "${C_RED}Please install Python 3.11+ using your distribution package manager.${C_RESET}"
        exit 1
    fi
fi

# Ensure Debian/Ubuntu systems have python3-venv support installed for the active Python binary
if [ -f /etc/debian_version ] || command -v apt-get >/dev/null 2>&1; then
    if ! "$PYTHON_BIN" -c "import ensurepip" >/dev/null 2>&1; then
        echo -e "  Missing system venv support for $PYTHON_BIN. Installing packages..."
        SUDO_CMD=""
        if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
            SUDO_CMD="sudo"
        fi
        $SUDO_CMD apt-get update -qq 2>/dev/null || true
        $SUDO_CMD apt-get install -y -qq "${PYTHON_BIN}-venv" python3-venv python3-pip 2>/dev/null || \
        $SUDO_CMD apt-get install -y -qq python3-venv python3-pip 2>/dev/null || true
    fi
fi

# 3. Check Node.js
echo -e "${C_BOLD}Checking Node.js & Dashboard prerequisites...${C_RESET}"
if ! command -v node >/dev/null 2>&1; then
    echo -e "  Node.js not detected. Please install Node.js 18+ to run the web dashboard."
    echo -e "  Reference: https://nodejs.org"
else
    NODE_VER=$(node -v)
    echo -e "  [OK] Found Node.js: $NODE_VER"
fi

PKG_RUNNER="npm"
if command -v pnpm >/dev/null 2>&1; then
    PKG_RUNNER="pnpm"
elif command -v npm >/dev/null 2>&1; then
    PKG_RUNNER="npm"
fi

# 4. Set up Virtual Environment
echo -e "\n${C_BOLD}Setting up Python environment...${C_RESET}"
VENV_PYTHON="$INSTALL_DIR/.venv/bin/python"

# Clean up broken virtual environments
if [ -d ".venv" ] && [ ! -f "$VENV_PYTHON" ]; then
    echo -e "  Cleaning incomplete virtual environment..."
    rm -rf .venv
fi

if [ ! -f "$VENV_PYTHON" ]; then
    echo -e "  Creating virtual environment with $PYTHON_BIN..."
    if ! "$PYTHON_BIN" -m venv .venv 2>/dev/null; then
        echo -e "  Standard venv creation failed; attempting with --without-pip..."
        rm -rf .venv
        if ! "$PYTHON_BIN" -m venv --without-pip .venv; then
            echo -e "${C_RED}Failed to create Python virtual environment.${C_RESET}"
            exit 1
        fi
    fi
fi

# Bootstrap pip if missing from the venv
if ! "$VENV_PYTHON" -m pip --version >/dev/null 2>&1; then
    echo -e "  Bootstrapping pip inside virtual environment..."
    if "$VENV_PYTHON" -m ensurepip --upgrade >/dev/null 2>&1; then
        echo -e "  [OK] pip bootstrapped via ensurepip."
    elif command -v curl >/dev/null 2>&1; then
        echo -e "  Downloading pip via curl..."
        curl -fsSL https://bootstrap.pypa.io/get-pip.py | "$VENV_PYTHON"
    elif command -v wget >/dev/null 2>&1; then
        echo -e "  Downloading pip via wget..."
        wget -qO- https://bootstrap.pypa.io/get-pip.py | "$VENV_PYTHON"
    else
        echo -e "${C_RED}Failed to bootstrap pip. Please install python3-venv or curl.${C_RESET}"
        exit 1
    fi
fi

echo -e "  [OK] Python virtual environment ready."
echo -e "${C_BOLD}Installing Python dependencies...${C_RESET}"
"$VENV_PYTHON" -m pip install --upgrade pip --quiet
"$VENV_PYTHON" -m pip install -r requirements.txt

# 5. Install Dashboard Dependencies
if [ -d "dashboard" ] && [ -f "dashboard/package.json" ]; then
    if command -v node >/dev/null 2>&1; then
        echo -e "\n${C_BOLD}Installing Web Dashboard dependencies with $PKG_RUNNER...${C_RESET}"
        cd dashboard
        $PKG_RUNNER install
        cd "$INSTALL_DIR"
    else
        echo -e "\n${C_YELLOW}Node.js not found. Skipping Web Dashboard package installation.${C_RESET}"
        echo -e "${C_DIM}Install Node.js 18+ later and run: cd dashboard && npm install${C_RESET}"
    fi
fi

# 6. Install Global CLI Command Shim
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

# Ensure ~/.local/bin is in PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    SHELL_PROFILE="$HOME/.bashrc"
    if [ -n "$ZSH_VERSION" ] || [ -f "$HOME/.zshrc" ]; then
        SHELL_PROFILE="$HOME/.zshrc"
    fi
    if [ -f "$SHELL_PROFILE" ]; then
        if ! grep -q "$BIN_DIR" "$SHELL_PROFILE" 2>/dev/null; then
            echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$SHELL_PROFILE"
        fi
    else
        echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$SHELL_PROFILE"
    fi
    export PATH="$BIN_DIR:$PATH"
fi

echo -e "  [OK] 'neverland' CLI command installed to $SHIM_FILE"

# 7. First-Run Trigger: Launch neverland config
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

# 8. Auto-Start Trigger: Start Neverland services if configured
STATE_FILE="$INSTALL_DIR/.neverland/state.json"
ACTIVE_MODE="dev"
if [ -f "$STATE_FILE" ]; then
    ACTIVE_MODE=$("$VENV_PYTHON" -c "import json; print(json.load(open('$STATE_FILE')).get('active_mode', 'dev'))" 2>/dev/null || echo "dev")
fi

if [ -f "$INSTALL_DIR/.neverland/profiles/${ACTIVE_MODE}.env" ]; then
    echo -e "\n${C_BOLD}Starting Neverland (${ACTIVE_MODE} mode)...${C_RESET}"
    "$VENV_PYTHON" -m cli start
else
    echo -e "\n${C_BOLD}Setup finished.${C_RESET}"
    echo -e "Run ${C_BOLD}neverland config${C_RESET} to configure your bot, then ${C_BOLD}neverland start${C_RESET}."
fi

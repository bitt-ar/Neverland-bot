#!/usr/bin/env bash
# ==============================================================================
# Neverland Universal Installer (Linux & macOS)
# Enterprise Discord Automation & Next.js 15 Web Dashboard
#
# Created with by bitt-ar
# ==============================================================================

set -e

# ANSI Colors
C_CYAN='\033[0;36m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[1;33m'
C_RED='\033[0;31m'
C_BOLD='\033[1m'
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
    elif [ -f /etc/debian_version ]; then
        if command -v sudo >/dev/null 2>&1; then
            sudo apt-get update && sudo apt-get install -y python3 python3-pip python3-venv
        else
            apt-get update && apt-get install -y python3 python3-pip python3-venv
        fi
        PYTHON_BIN="python3"
    elif [ -f /etc/redhat-release ]; then
        if command -v sudo >/dev/null 2>&1; then
            sudo dnf install -y python3 python3-pip
        else
            dnf install -y python3 python3-pip
        fi
        PYTHON_BIN="python3"
    else
        echo -e "${C_RED}Please install Python 3.11+ using your distribution package manager.${C_RESET}"
        exit 1
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
if [ ! -d ".venv" ]; then
    "$PYTHON_BIN" -m venv .venv
fi

VENV_PYTHON="$INSTALL_DIR/.venv/bin/python"
VENV_PIP="$INSTALL_DIR/.venv/bin/pip"

"$VENV_PIP" install --upgrade pip
echo -e "${C_BOLD}Installing Python dependencies...${C_RESET}"
"$VENV_PIP" install -r requirements.txt

# 5. Install Dashboard Dependencies
if [ -d "dashboard" ] && [ -f "dashboard/package.json" ]; then
    echo -e "\n${C_BOLD}Installing Web Dashboard dependencies with $PKG_RUNNER...${C_RESET}"
    cd dashboard
    $PKG_RUNNER install
    cd "$INSTALL_DIR"
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
    echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$SHELL_PROFILE"
    export PATH="$BIN_DIR:$PATH"
fi

echo -e "  [OK] 'neverland' CLI command installed to $SHIM_FILE"

# 7. First-Run Trigger: Launch neverland config
echo -e "\n${C_CYAN}${C_BOLD}======================================================================${C_RESET}"
echo -e "${C_BOLD}Installation complete. Launching the interactive configuration wizard...${C_RESET}"
echo -e "${C_CYAN}${C_BOLD}======================================================================${C_RESET}\n"

cd "$INSTALL_DIR"
"$VENV_PYTHON" -m cli config

# 8. Auto-Start Trigger: Start Neverland services
echo -e "\n${C_BOLD}Starting Neverland...${C_RESET}"
"$VENV_PYTHON" -m cli start

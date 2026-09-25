#!/usr/bin/env python3
"""
Neverland Universal CLI
Enterprise-grade Discord Automation & Management Platform

Created by bitt-ar
GitHub: https://github.com/bitt-ar/Neverland-bot
"""

import sys

# Configure UTF-8 encoding for standard streams
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import argparse
import base64
import json
import os
import platform
import re
import secrets
import shutil
import signal
import socket
import subprocess
import tarfile
import time
import urllib.request
import zipfile
from pathlib import Path

# Enable ANSI colors on legacy Windows console (Windows 10+)
if platform.system() == "Windows":
    try:
        os.system("")
    except Exception:
        pass

# Version metadata
try:
    from cli import __version__
except Exception:
    __version__ = "1.0.0"

# Paths
CLI_DIR = Path(__file__).resolve().parent
BASE_DIR = Path(os.environ["NEVERLAND_HOME"]).resolve() if os.environ.get("NEVERLAND_HOME") else CLI_DIR.parent
DASHBOARD_DIR = BASE_DIR / "dashboard"
NEVERLAND_DIR = BASE_DIR / ".neverland"
PROFILES_DIR = NEVERLAND_DIR / "profiles"
LOGS_DIR = NEVERLAND_DIR / "logs"
STATE_FILE = NEVERLAND_DIR / "state.json"
PIDS_FILE = NEVERLAND_DIR / "pids.json"

BOT_ENV_FILE = BASE_DIR / ".env"
DASHBOARD_ENV_FILE = DASHBOARD_DIR / ".env.local"


def get_node_cmd(runner: str, *args: str) -> list[str]:
    """Wrap npm/pnpm/yarn commands with 'cmd /c' on Windows to prevent FileNotFoundError."""
    cmd = [runner, *args]
    if platform.system() == "Windows":
        return ["cmd", "/c"] + cmd
    return cmd


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Check if a TCP port is currently occupied."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            return s.connect_ex((host, port)) == 0
    except Exception:
        return False


def check_mongodb_connection(uri: str, timeout_ms: int = 3000) -> tuple[bool, str]:
    """Proactively test MongoDB reachability with a short timeout to prevent 30s hangs."""
    client = None
    try:
        from pymongo import MongoClient
        client_kwargs = {}
        try:
            import certifi
            client_kwargs["tlsCAFile"] = certifi.where()
        except Exception:
            pass
        client = MongoClient(uri, serverSelectionTimeoutMS=timeout_ms, **client_kwargs)
        client.admin.command("ping")
        return True, ""
    except Exception as e:
        return False, str(e)
    finally:
        if client:
            try:
                client.close()
            except Exception:
                pass

# ANSI Color Codes
class Colors:
    HEADER = "\033[95m"
    MAGENTA = "\033[95m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RESET = "\033[0m"

    @classmethod
    def strip(cls, text: str) -> str:
        return re.sub(r"\033\[[0-9;]*m", "", text)


def print_banner():
    banner = f"""{Colors.CYAN}{Colors.BOLD}
  _   _                     _                 _ 
 | \\ | | _____   _____ _ __| | __ _ _ __   __| |
 |  \\| |/ _ \\ \\ / / _ \\ '__| |/ _` | '_ \\ / _` |
 | |\\  |  __/\\ V /  __/ |  | | (_| | | | | (_| |
 |_| \\_|\\___| \\_/ \\___|_|  |_|\\__,_|_| |_|\\__,_|
{Colors.RESET}{Colors.BOLD} Enterprise Discord Automation & Next.js 15 Web Dashboard{Colors.RESET}
 {Colors.YELLOW}Created by bitt-ar{Colors.RESET} | {Colors.GREEN}https://github.com/bitt-ar/Neverland-bot{Colors.RESET}
----------------------------------------------------------------------"""
    print(banner)


def ensure_directories():
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)


def get_state() -> dict:
    ensure_directories()
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"active_mode": None, "configured_modes": []}


def normalize_mode(mode) -> str:
    """Normalize user input or mode aliases into canonical 'dev' or 'prod'."""
    if not mode:
        return ""
    m = str(mode).strip().lower()
    if m in ("dev", "development", "debug", "d", "1"):
        return "dev"
    if m in ("prod", "production", "publish", "pub", "p", "release", "2"):
        return "prod"
    return ""


def resolve_active_mode(requested_mode=None) -> str:
    """
    Intelligently determine which mode (dev or prod) should be activated:
    1. If user explicitly passed a mode, normalize and validate it.
    2. Check state.json for an 'active_mode' whose profile exists.
    3. Auto-detect from existing profiles in .neverland/profiles:
       - If prod.env exists and dev.env does not: auto-select 'prod'.
       - If dev.env exists and prod.env does not: auto-select 'dev'.
       - If both exist: prefer state.json active_mode, or fallback to 'prod'.
    4. If no profiles exist, return empty string.
    """
    if requested_mode:
        normalized = normalize_mode(requested_mode)
        if normalized:
            return normalized

    state = get_state()
    active_in_state = normalize_mode(state.get("active_mode"))

    prod_exists = (PROFILES_DIR / "prod.env").exists()
    dev_exists = (PROFILES_DIR / "dev.env").exists()

    if active_in_state and (PROFILES_DIR / f"{active_in_state}.env").exists():
        return active_in_state

    if prod_exists and not dev_exists:
        return "prod"
    if dev_exists and not prod_exists:
        return "dev"
    if prod_exists and dev_exists:
        return active_in_state or "prod"

    return ""


def save_state(state: dict):
    ensure_directories()
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def get_pids() -> dict:
    if PIDS_FILE.exists():
        try:
            with open(PIDS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_pids(pids: dict):
    ensure_directories()
    with open(PIDS_FILE, "w", encoding="utf-8") as f:
        json.dump(pids, f, indent=2)


def generate_fernet_key() -> str:
    """Generate 32 url-safe base64-encoded bytes for Fernet encryption."""
    try:
        from cryptography.fernet import Fernet
        return Fernet.generate_key().decode()
    except Exception:
        key_bytes = secrets.token_bytes(32)
        return base64.urlsafe_b64encode(key_bytes).decode()


def load_env_dict(path: Path) -> dict:
    env = {}
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def write_env_file(path: Path, data: dict, header: str = ""):
    path.parent.mkdir(parents=True, exist_ok=True)
    content = ""
    if header:
        content += f"# {header}\n# Generated by Neverland CLI (bitt-ar | https://ko-fi.com/E1E41CVWBU)\n\n"
    for k, v in data.items():
        content += f"{k}={v}\n"

    # Enforce strict permissions (0600) on POSIX to protect secrets
    if os.name == "posix":
        try:
            fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with open(fd, "w", encoding="utf-8") as f:
                f.write(content)
            return
        except Exception:
            pass

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def prompt_input(label: str, default: str = "", secret: bool = False, required: bool = False) -> str:
    if secret and default:
        default_hint = f" [{Colors.DIM}••••••••{Colors.RESET}]"
    elif default:
        default_hint = f" [{Colors.DIM}{default}{Colors.RESET}]"
    else:
        default_hint = ""
    prompt_str = f"  {Colors.BOLD}{label}{Colors.RESET}{default_hint}: "
    
    while True:
        try:
            val = input(prompt_str).strip()
        except (KeyboardInterrupt, EOFError):
            print("\nConfiguration cancelled.")
            sys.exit(1)
            
        if val:
            return val
        if default:
            return default
        if not required:
            return ""
        print(f"    {Colors.RED}This field is required. Please enter a value.{Colors.RESET}")


def prompt_port(label: str, default: str = "3000") -> str:
    while True:
        val = prompt_input(label, default=default, required=True)
        try:
            p = int(val)
            if 1 <= p <= 65535:
                if is_port_in_use(p):
                    print(f"    {Colors.YELLOW}[Notice] Port {p} appears to be in use. Ensure other services are stopped before starting.{Colors.RESET}")
                return str(p)
            print(f"    {Colors.RED}Port must be a number between 1 and 65535.{Colors.RESET}")
        except ValueError:
            print(f"    {Colors.RED}Invalid input. Port must be an integer.{Colors.RESET}")


def activate_profile(mode: str) -> bool:
    """Sync the given mode's profile to .env and dashboard/.env.local without touching the other mode."""
    canon_mode = normalize_mode(mode) or mode
    profile_path = PROFILES_DIR / f"{canon_mode}.env"
    if not profile_path.exists():
        return False

    profile_data = load_env_dict(profile_path)
    
    # Write bot root .env
    write_env_file(BOT_ENV_FILE, profile_data, header=f"Active Profile: {canon_mode.upper()}")
    
    dash_port = str(profile_data.get("PORT", "3000"))
    dash_url = str(profile_data.get("NEXT_PUBLIC_APP_URL") or f"http://localhost:{dash_port}")
    redirect_uri = str(profile_data.get("DISCORD_REDIRECT_URI") or f"{dash_url.rstrip('/')}/api/auth/callback/discord")

    # Note: Bot TOKEN is intentionally omitted here to prevent unnecessary secret exposure to dashboard
    dashboard_data = {
        "DISCORD_CLIENT_ID": profile_data.get("DISCORD_CLIENT_ID", ""),
        "DISCORD_CLIENT_SECRET": profile_data.get("DISCORD_CLIENT_SECRET", ""),
        "DISCORD_REDIRECT_URI": redirect_uri,
        "MONGODB_URI": profile_data.get("MONGODB_URI", "mongodb://localhost:27017"),
        "MONGODB_DB": profile_data.get("MONGODB_DB", "neverland"),
        "CONTROL_PLANE_PORT": profile_data.get("CONTROL_PLANE_PORT", "8800"),
        "CONTROL_PLANE_HOST": profile_data.get("CONTROL_PLANE_HOST", "0.0.0.0"),
        "CONTROL_PLANE_SECRET": profile_data.get("CONTROL_PLANE_SECRET", ""),
        "CONTROL_PLANE_URL": profile_data.get("CONTROL_PLANE_URL") or f"http://127.0.0.1:{profile_data.get('CONTROL_PLANE_PORT', '8800')}",
        "GUILD_ID": profile_data.get("GUILD_ID", ""),
        "NEXT_PUBLIC_APP_URL": dash_url,
        "AUTH_ENABLED": profile_data.get("AUTH_ENABLED", "true" if canon_mode == "prod" else "false"),
        "DASHBOARD_SESSION_SECRET": profile_data.get("DASHBOARD_SESSION_SECRET", ""),
        "OWNER_DISCORD_ID": profile_data.get("OWNER_DISCORD_ID", ""),
        "ADMIN_DISCORD_IDS": profile_data.get("ADMIN_DISCORD_IDS", ""),
        "DEV_USER_ID": profile_data.get("DEV_USER_ID", profile_data.get("OWNER_DISCORD_ID", "")),
        "PORT": dash_port,
        "HOSTNAME": profile_data.get("HOSTNAME", "0.0.0.0"),
    }
    write_env_file(DASHBOARD_ENV_FILE, dashboard_data, header=f"Active Profile: {canon_mode.upper()} for Next.js 15")
    
    # Update state
    state = get_state()
    state["active_mode"] = canon_mode
    save_state(state)
    return True


# =====================================================================
# COMMAND: CONFIG
# =====================================================================

def cmd_config(args):
    print_banner()
    print(f"\n{Colors.BOLD}{Colors.CYAN}--- NEVERLAND INTERACTIVE CONFIGURATION WIZARD ---{Colors.RESET}\n")

    state = get_state()
    current_active = state.get("active_mode") or ("prod" if (PROFILES_DIR / "prod.env").exists() else "dev")

    raw_mode = getattr(args, "mode", None)
    mode = normalize_mode(raw_mode) if raw_mode else ""

    if not mode:
        print(f"{Colors.BOLD}Please select your deployment mode:{Colors.RESET}\n")
        print(f"  {Colors.BOLD}[1] Development Mode (`dev`){Colors.RESET}")
        print(f"      - {Colors.DIM}Ideal for local testing and direct network access{Colors.RESET}")
        print(f"      - {Colors.DIM}Direct dashboard access with dynamic multi-server discovery (no OAuth required){Colors.RESET}")
        print(f"      - {Colors.DIM}Binds to 0.0.0.0 on configurable port for immediate network deployment{Colors.RESET}")
        print(f"      - {Colors.DIM}Auto-generates all cryptographic keys locally{Colors.RESET}\n")
        print(f"  {Colors.BOLD}[2] Publish / Production Mode (`prod` / `publish`){Colors.RESET}")
        print(f"      - {Colors.DIM}Designed for VPS / Cloud Servers with a public domain or IP{Colors.RESET}")
        print(f"      - {Colors.DIM}Full Discord OAuth2 user authentication and role-based permissions{Colors.RESET}")
        print(f"      - {Colors.DIM}Supports custom domains or direct IP (e.g. http://IP:PORT){Colors.RESET}")
        print(f"      - {Colors.DIM}Hardened security keys & SSL reverse proxy compatibility{Colors.RESET}\n")

        default_num = "1" if current_active == "dev" else "2"
        choice = prompt_input("Select mode (1 for dev, 2 for prod/publish)", default=default_num)
        mode = normalize_mode(choice) or ("prod" if choice in ["2", "prod", "production", "publish", "pub"] else "dev")

    mode_label = "PUBLISH / PROD" if mode == "prod" else "DEVELOPMENT (DEV)"
    profile_file = PROFILES_DIR / f"{mode}.env"
    existing = load_env_dict(profile_file)

    if existing:
        print(f"\n{Colors.GREEN}Found existing saved settings for {mode_label} mode.{Colors.RESET}")
        print(f"{Colors.DIM}Press [Enter] to keep current values, or type new values to update.{Colors.RESET}\n")
    else:
        print(f"\n{Colors.YELLOW}Configuring {mode_label} mode for the first time.{Colors.RESET}\n")

    new_cfg = {}

    # Common Settings
    print(f"{Colors.BOLD}--- 1. Discord Bot Credentials ---{Colors.RESET}")
    print(f"{Colors.DIM}Get these from https://discord.com/developers/applications{Colors.RESET}")
    new_cfg["TOKEN"] = prompt_input("Discord Bot Token", default=existing.get("TOKEN", ""), secret=True, required=True)
    new_cfg["PREFIX"] = prompt_input("Legacy Command Prefix", default=existing.get("PREFIX", "!"))

    # Network Ports & Host Binding (Universal 0.0.0.0)
    print(f"\n{Colors.BOLD}--- 2. Network Ports & Host Binding ---{Colors.RESET}")
    print(f"{Colors.DIM}Binding to 0.0.0.0 enables direct access from your server's IP address.{Colors.RESET}")
    new_cfg["PORT"] = prompt_port("Web Dashboard Port", default=existing.get("PORT", "3000"))
    new_cfg["HOSTNAME"] = "0.0.0.0"
    new_cfg["CONTROL_PLANE_PORT"] = prompt_port("Bot Control Plane Internal Port", default=existing.get("CONTROL_PLANE_PORT", "8800"))
    new_cfg["CONTROL_PLANE_HOST"] = "0.0.0.0"
    new_cfg["CONTROL_PLANE_URL"] = f"http://127.0.0.1:{new_cfg['CONTROL_PLANE_PORT']}"

    if mode == "dev":
        print(f"\n{Colors.BOLD}--- 3. Administrator Access (Dev Mode) ---{Colors.RESET}")
        print(f"{Colors.DIM}Development mode bypasses OAuth and dynamically discovers all servers the bot is in.{Colors.RESET}")
        admin_id = prompt_input("Your Discord User ID (Bot Owner / Admin)", default=existing.get("ADMIN_DISCORD_IDS", existing.get("OWNER_DISCORD_ID", "")))
        new_cfg["ADMIN_DISCORD_IDS"] = admin_id
        new_cfg["OWNER_DISCORD_ID"] = admin_id
        new_cfg["DEV_USER_ID"] = admin_id
        new_cfg["NEXT_PUBLIC_APP_URL"] = existing.get("NEXT_PUBLIC_APP_URL", f"http://localhost:{new_cfg['PORT']}")
        new_cfg["DISCORD_REDIRECT_URI"] = f"{new_cfg['NEXT_PUBLIC_APP_URL'].rstrip('/')}/api/auth/callback/discord"
        new_cfg["AUTH_ENABLED"] = "false"
        new_cfg["GUILD_ID"] = existing.get("GUILD_ID", "")
        new_cfg["DISCORD_CLIENT_ID"] = existing.get("DISCORD_CLIENT_ID", "")
        new_cfg["DISCORD_CLIENT_SECRET"] = existing.get("DISCORD_CLIENT_SECRET", "")

    else:  # prod mode
        print(f"\n{Colors.BOLD}--- 3. Production Discord OAuth2 Credentials ---{Colors.RESET}")
        print(f"{Colors.DIM}Required for server owners and moderators to log into your web dashboard.{Colors.RESET}")
        new_cfg["DISCORD_CLIENT_ID"] = prompt_input("Discord Client ID", default=existing.get("DISCORD_CLIENT_ID", ""), required=True)
        new_cfg["DISCORD_CLIENT_SECRET"] = prompt_input("Discord Client Secret", default=existing.get("DISCORD_CLIENT_SECRET", ""), secret=True, required=True)

        print(f"\n{Colors.BOLD}--- 4. Public URL & Access Control ---{Colors.RESET}")
        print(f"{Colors.DIM}e.g. https://dashboard.yourdomain.com or http://YOUR_SERVER_IP:{new_cfg['PORT']}{Colors.RESET}")
        default_domain = existing.get("NEXT_PUBLIC_APP_URL", f"http://YOUR_SERVER_IP:{new_cfg['PORT']}")
        domain_url = prompt_input("Public Dashboard URL", default=default_domain, required=True)
        domain_url = domain_url.rstrip("/")
        new_cfg["NEXT_PUBLIC_APP_URL"] = domain_url
        new_cfg["DISCORD_REDIRECT_URI"] = f"{domain_url}/api/auth/callback/discord"
        new_cfg["AUTH_ENABLED"] = "true"
        new_cfg["GUILD_ID"] = existing.get("GUILD_ID", "")
        new_cfg["OWNER_DISCORD_ID"] = prompt_input("Bot Owner Discord User ID (optional, auto-detected)", default=existing.get("OWNER_DISCORD_ID", ""))
        new_cfg["ADMIN_DISCORD_IDS"] = prompt_input("Admin Discord User IDs (comma-separated)", default=existing.get("ADMIN_DISCORD_IDS", ""))

    # Database
    print(f"\n{Colors.BOLD}--- Database Configuration (MongoDB) ---{Colors.RESET}")
    print(f"{Colors.DIM}Local: mongodb://localhost:27017 | Atlas: mongodb+srv://...{Colors.RESET}")
    new_cfg["MONGODB_URI"] = prompt_input("MongoDB URI", default=existing.get("MONGODB_URI", "mongodb://localhost:27017"), required=True)
    new_cfg["MONGODB_DB"] = prompt_input("MongoDB Database Name", default=existing.get("MONGODB_DB", "neverland"))

    print(f"  {Colors.DIM}Testing MongoDB connectivity...{Colors.RESET}")
    db_ok, db_err = check_mongodb_connection(new_cfg["MONGODB_URI"], timeout_ms=3000)
    if db_ok:
        print(f"  {Colors.GREEN}[OK] Connected to MongoDB successfully.{Colors.RESET}")
    else:
        print(f"  {Colors.YELLOW}[WARNING] Could not reach MongoDB ({new_cfg['MONGODB_URI'].split('@')[-1]}): {db_err}{Colors.RESET}")
        if "TLSV1_ALERT_INTERNAL_ERROR" in db_err or "SSL handshake failed" in db_err:
            print(f"\n  {Colors.BOLD}{Colors.CYAN}💡 MongoDB Atlas IP Whitelist Notice:{Colors.RESET}")
            print(f"  Atlas rejected the connection during TLS handshake ({Colors.RED}TLSV1_ALERT_INTERNAL_ERROR{Colors.RESET}).")
            print(f"  Your current IP address is {Colors.BOLD}NOT whitelisted{Colors.RESET} in MongoDB Atlas Network Access.")
            print(f"  {Colors.BOLD}To fix:{Colors.RESET} Go to https://cloud.mongodb.com > Security > Network Access > Add IP Address > Allow Access from Anywhere (0.0.0.0/0).\n")
        else:
            print(f"  {Colors.DIM}You may continue configuration, but ensure MongoDB is started before running 'neverland start'.{Colors.RESET}")

    # 5. Radio & 24/7 Audio Streaming Configuration
    print(f"\n{Colors.BOLD}--- 5. Radio & 24/7 Audio Streaming Configuration ---{Colors.RESET}")
    print(f"{Colors.DIM}Configure broadcast bots, playlist storage quotas, and upload limits.{Colors.RESET}\n")

    # Radio Bot Instances (1-3)
    default_bots = existing.get("RADIO_BOTS_COUNT", "3")
    while True:
        bots_input = prompt_input("Number of Radio Bot instances (1 to 3)", default=default_bots)
        try:
            bots_val = int(bots_input.strip())
            if 1 <= bots_val <= 3:
                new_cfg["RADIO_BOTS_COUNT"] = str(bots_val)
                break
            print(f"  {Colors.RED}Please enter an integer between 1 and 3.{Colors.RESET}")
        except ValueError:
            print(f"  {Colors.RED}Invalid number. Please enter 1, 2, or 3.{Colors.RESET}")

    # Maximum playlists per server
    default_max_pl = existing.get("RADIO_MAX_PLAYLISTS_PER_GUILD", "6")
    while True:
        pl_input = prompt_input("Maximum playlists allowed per server", default=default_max_pl)
        try:
            pl_val = int(pl_input.strip())
            if pl_val >= 1:
                new_cfg["RADIO_MAX_PLAYLISTS_PER_GUILD"] = str(pl_val)
                break
            print(f"  {Colors.RED}Minimum playlists allowed is 1.{Colors.RESET}")
        except ValueError:
            print(f"  {Colors.RED}Invalid integer.{Colors.RESET}")

    # Storage quota per playlist in MB
    default_storage = existing.get("RADIO_MAX_PLAYLIST_STORAGE_MB", "50")
    while True:
        storage_input = prompt_input("Storage quota PER PLAYLIST in MB", default=default_storage)
        try:
            storage_val = int(storage_input.strip())
            if storage_val >= 10:
                new_cfg["RADIO_MAX_PLAYLIST_STORAGE_MB"] = str(storage_val)
                break
            print(f"  {Colors.RED}Minimum storage quota per playlist is 10 MB.{Colors.RESET}")
        except ValueError:
            print(f"  {Colors.RED}Invalid integer.{Colors.RESET}")

    # Storage Multiplier Notice
    total_server_mb = int(new_cfg["RADIO_MAX_PLAYLISTS_PER_GUILD"]) * int(new_cfg["RADIO_MAX_PLAYLIST_STORAGE_MB"])
    print(f"\n  {Colors.CYAN}💡 Storage Policy Notice:{Colors.RESET}")
    print(f"     Each playlist receives an independent quota of {Colors.BOLD}{new_cfg['RADIO_MAX_PLAYLIST_STORAGE_MB']} MB{Colors.RESET}.")
    print(f"     {new_cfg['RADIO_MAX_PLAYLISTS_PER_GUILD']} playlists × {new_cfg['RADIO_MAX_PLAYLIST_STORAGE_MB']} MB = {Colors.BOLD}{Colors.GREEN}{total_server_mb} MB{Colors.RESET} total maximum audio storage per server.\n")

    # Max single audio file upload size in MB
    current_storage_int = int(new_cfg["RADIO_MAX_PLAYLIST_STORAGE_MB"])
    default_upload = existing.get("RADIO_MAX_UPLOAD_SIZE_MB", str(min(25, current_storage_int)))
    while True:
        upload_input = prompt_input(f"Maximum single audio file upload size in MB (max {current_storage_int})", default=default_upload)
        try:
            upload_val = int(upload_input.strip())
            if 1 <= upload_val <= current_storage_int:
                new_cfg["RADIO_MAX_UPLOAD_SIZE_MB"] = str(upload_val)
                break
            print(f"  {Colors.RED}Upload size must be between 1 and {current_storage_int} MB.{Colors.RESET}")
        except ValueError:
            print(f"  {Colors.RED}Invalid integer.{Colors.RESET}")

    # Auto-generate or preserve cryptographic secrets
    new_cfg["CONTROL_PLANE_SECRET"] = existing.get("CONTROL_PLANE_SECRET") or secrets.token_hex(32)
    new_cfg["DASHBOARD_SESSION_SECRET"] = existing.get("DASHBOARD_SESSION_SECRET") or secrets.token_hex(32)
    new_cfg["RADIO_ENCRYPTION_KEY"] = existing.get("RADIO_ENCRYPTION_KEY") or generate_fernet_key()

    # Save to isolated profile
    write_env_file(profile_file, new_cfg, header=f"Neverland Profile: {mode.upper()}")
    print(f"\n{Colors.GREEN}[OK] Settings saved safely to {profile_file}{Colors.RESET}")

    # Activate profile
    activate_profile(mode)
    print(f"{Colors.GREEN}[OK] Active profile set to: {mode_label}{Colors.RESET}")

    # Reload state to avoid race condition / overwriting active_mode
    state = get_state()
    state["active_mode"] = mode
    configured = set(state.get("configured_modes") or [])
    configured.add(mode)
    state["configured_modes"] = sorted(list(configured))
    save_state(state)

    print(f"\n{Colors.GREEN}{Colors.BOLD}Configuration complete!{Colors.RESET}")
    if mode == "prod":
        print(f"\n{Colors.YELLOW}IMPORTANT NOTICE FOR DISCORD DEVELOPER PORTAL:{Colors.RESET}")
        print(f"Make sure to add this Redirect URI in your Discord Application (OAuth2 > General):")
        print(f"  [-] {Colors.CYAN}{new_cfg['DISCORD_REDIRECT_URI']}{Colors.RESET}\n")

    print(f"Run {Colors.BOLD}neverland start{Colors.RESET} to launch your bot and dashboard in {mode_label} mode!")


# =====================================================================
# SYSTEM TOOLS & AUTO-UPDATE HELPERS (FFmpeg & GitHub)
# =====================================================================

def get_user_bin_dir() -> Path:
    """Return platform-specific user bin directory for Neverland tools."""
    if platform.system() == "Windows":
        return Path.home() / ".neverland" / "bin"
    return Path.home() / ".local" / "bin"


def refresh_env_path():
    """Ensure user binary directories and registry/system paths are in os.environ['PATH']."""
    current_paths = [p for p in os.environ.get("PATH", "").split(os.pathsep) if p]
    bin_dir = str(get_user_bin_dir())
    node_dir = str(Path.home() / ".neverland" / "node")

    for d in [bin_dir, node_dir]:
        if d not in current_paths:
            current_paths.insert(0, d)

    if platform.system() == "Windows":
        common_nodes = [
            os.path.expandvars(r"%ProgramFiles%\nodejs"),
            os.path.expandvars(r"%ProgramFiles(x86)%\nodejs"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\node"),
        ]
        for cn in common_nodes:
            if os.path.exists(cn) and cn not in current_paths:
                current_paths.insert(0, cn)

        try:
            import winreg
            for hkey in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
                sub = r"Environment" if hkey == winreg.HKEY_CURRENT_USER else r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"
                try:
                    with winreg.OpenKey(hkey, sub) as key:
                        reg_path, _ = winreg.QueryValueEx(key, "Path")
                        for part in reg_path.split(";"):
                            part = part.strip()
                            if part and part not in current_paths:
                                current_paths.append(part)
                except Exception:
                    pass
        except Exception:
            pass

    os.environ["PATH"] = os.pathsep.join(current_paths)


def _add_to_windows_path(bin_dir: Path):
    """Safely append bin_dir to Windows User PATH environment variable."""
    try:
        import winreg
        bin_str = str(bin_dir)
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment", 0, winreg.KEY_ALL_ACCESS) as key:
            try:
                current_path, _ = winreg.QueryValueEx(key, "Path")
            except FileNotFoundError:
                current_path = ""
            paths = [p for p in current_path.split(";") if p.strip()]
            if not any(p.lower() == bin_str.lower() for p in paths):
                paths.append(bin_str)
                new_path = ";".join(paths)
                winreg.SetValueEx(key, "Path", 0, winreg.REG_EXPAND_SZ, new_path)
    except Exception:
        pass


def is_ffmpeg_installed() -> tuple[bool, str]:
    """Check if ffmpeg is installed and executable. Returns (is_installed, version_or_path)."""
    refresh_env_path()
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        candidate = get_user_bin_dir() / ("ffmpeg.exe" if platform.system() == "Windows" else "ffmpeg")
        if candidate.exists() and os.access(candidate, os.X_OK if platform.system() != "Windows" else os.R_OK):
            ffmpeg_path = str(candidate)

    if not ffmpeg_path:
        return False, ""

    try:
        res = subprocess.run([ffmpeg_path, "-version"], capture_output=True, text=True, timeout=3)
        if res.returncode == 0:
            first_line = res.stdout.strip().split("\n")[0]
            return True, first_line
    except Exception:
        pass

    return True, ffmpeg_path


def _install_ffmpeg_windows() -> bool:
    """Install FFmpeg on Windows using winget, choco, scoop, or direct static download."""
    if shutil.which("winget"):
        print(f"  {Colors.DIM}Attempting FFmpeg installation via winget...{Colors.RESET}")
        try:
            subprocess.run(
                ["winget", "install", "-e", "--id", "Gyan.FFmpeg", "--accept-package-agreements", "--accept-source-agreements"],
                capture_output=True,
                text=True,
                timeout=180,
            )
            refresh_env_path()
            if is_ffmpeg_installed()[0]:
                return True
        except Exception:
            pass

    if shutil.which("choco"):
        print(f"  {Colors.DIM}Attempting FFmpeg installation via Chocolatey...{Colors.RESET}")
        try:
            subprocess.run(["choco", "install", "ffmpeg", "-y"], capture_output=True, text=True, timeout=180)
            refresh_env_path()
            if is_ffmpeg_installed()[0]:
                return True
        except Exception:
            pass

    if shutil.which("scoop"):
        print(f"  {Colors.DIM}Attempting FFmpeg installation via Scoop...{Colors.RESET}")
        try:
            subprocess.run(["scoop", "install", "ffmpeg"], capture_output=True, text=True, timeout=180)
            refresh_env_path()
            if is_ffmpeg_installed()[0]:
                return True
        except Exception:
            pass

    # Fallback: direct download static zip into ~/.neverland/bin
    print(f"  {Colors.DIM}Downloading standalone FFmpeg binary for Windows...{Colors.RESET}")
    bin_dir = get_user_bin_dir()
    bin_dir.mkdir(parents=True, exist_ok=True)
    zip_url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    tmp_zip = bin_dir / "ffmpeg_temp.zip"
    try:
        urllib.request.urlretrieve(zip_url, tmp_zip)
        with zipfile.ZipFile(tmp_zip, "r") as z:
            for member in z.namelist():
                filename = Path(member).name
                if filename.lower() in ("ffmpeg.exe", "ffprobe.exe"):
                    source = z.open(member)
                    target = bin_dir / filename
                    with open(target, "wb") as f_out:
                        shutil.copyfileobj(source, f_out)
        tmp_zip.unlink(missing_ok=True)
        _add_to_windows_path(bin_dir)
        refresh_env_path()
        return is_ffmpeg_installed()[0]
    except Exception as e:
        tmp_zip.unlink(missing_ok=True)
        print(f"  {Colors.YELLOW}[Notice] Direct download fallback failed: {e}{Colors.RESET}")
        return False


def _install_ffmpeg_linux() -> bool:
    """Install FFmpeg on Linux using system package manager or static release."""
    pkg_mgrs = [
        ("apt-get", ["apt-get", "update", "-y"], ["apt-get", "install", "-y", "ffmpeg"]),
        ("dnf", None, ["dnf", "install", "-y", "ffmpeg"]),
        ("yum", None, ["yum", "install", "-y", "ffmpeg"]),
        ("pacman", None, ["pacman", "-Sy", "--noconfirm", "ffmpeg"]),
        ("zypper", None, ["zypper", "install", "-y", "ffmpeg"]),
        ("apk", None, ["apk", "add", "--no-cache", "ffmpeg"]),
        ("xbps-install", None, ["xbps-install", "-y", "ffmpeg"]),
    ]

    has_sudo = (shutil.which("sudo") is not None) and (hasattr(os, "geteuid") and os.geteuid() != 0)

    for mgr, update_cmd, install_cmd in pkg_mgrs:
        if shutil.which(mgr):
            print(f"  {Colors.DIM}Attempting FFmpeg installation via {mgr}...{Colors.RESET}")
            try:
                prefix = ["sudo"] if has_sudo else []
                if update_cmd:
                    subprocess.run(prefix + update_cmd, capture_output=True, timeout=60)
                subprocess.run(prefix + install_cmd, capture_output=True, timeout=120)
                refresh_env_path()
                if is_ffmpeg_installed()[0]:
                    return True
            except Exception:
                pass

    if platform.machine().lower() in ("x86_64", "amd64"):
        print(f"  {Colors.DIM}Downloading static FFmpeg binary for Linux...{Colors.RESET}")
        bin_dir = get_user_bin_dir()
        bin_dir.mkdir(parents=True, exist_ok=True)
        tar_url = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
        tmp_tar = bin_dir / "ffmpeg_temp.tar.xz"
        try:
            urllib.request.urlretrieve(tar_url, tmp_tar)
            with tarfile.open(tmp_tar, "r:xz") as tar:
                for member in tar.getmembers():
                    filename = Path(member.name).name
                    if filename in ("ffmpeg", "ffprobe"):
                        f = tar.extractfile(member)
                        if f:
                            target = bin_dir / filename
                            with open(target, "wb") as f_out:
                                shutil.copyfileobj(f, f_out)
                            target.chmod(0o755)
            tmp_tar.unlink(missing_ok=True)
            refresh_env_path()
            return is_ffmpeg_installed()[0]
        except Exception:
            tmp_tar.unlink(missing_ok=True)

    return False


def _install_ffmpeg_macos() -> bool:
    """Install FFmpeg on macOS using Homebrew."""
    if shutil.which("brew"):
        print(f"  {Colors.DIM}Attempting FFmpeg installation via Homebrew...{Colors.RESET}")
        try:
            subprocess.run(["brew", "install", "ffmpeg"], capture_output=True, timeout=180)
            refresh_env_path()
            return is_ffmpeg_installed()[0]
        except Exception:
            pass
    return False


def ensure_ffmpeg(force: bool = False) -> bool:
    """
    Verify that FFmpeg is available.
    If already installed, skip installation ('ولو موجود يعمل سكب').
    If not installed, install it automatically.
    """
    installed, ver = is_ffmpeg_installed()
    if installed and not force:
        ver_summary = ver.split("\n")[0] if ver else "installed"
        first_part = ver_summary.split()[0] if ver_summary else "ffmpeg"
        sec_part = ver_summary.split()[2] if len(ver_summary.split()) > 2 else ""
        print(f"  {Colors.GREEN}[OK] FFmpeg is already installed ({first_part} {sec_part}) - skipping installation.{Colors.RESET}")
        return True

    print(f"  {Colors.YELLOW}[Notice] FFmpeg is not installed. Installing FFmpeg automatically...{Colors.RESET}")

    sys_os = platform.system()
    if sys_os == "Windows":
        _install_ffmpeg_windows()
    elif sys_os == "Linux":
        _install_ffmpeg_linux()
    elif sys_os == "Darwin":
        _install_ffmpeg_macos()
    else:
        print(f"  {Colors.YELLOW}[Warning] Unsupported OS ({sys_os}) for automatic FFmpeg installation.{Colors.RESET}")
        return False

    refresh_env_path()
    installed, ver = is_ffmpeg_installed()
    if installed:
        print(f"  {Colors.GREEN}[OK] FFmpeg installed successfully.{Colors.RESET}")
        return True
    else:
        print(f"  {Colors.YELLOW}[Warning] FFmpeg installation completed, but binary not found in PATH.{Colors.RESET}")
        print(f"  {Colors.DIM}Audio features may not function until FFmpeg is available in system PATH.{Colors.RESET}")
        return False


def _sync_updated_dependencies():
    """Install or upgrade dependencies if requirements.txt exists."""
    req_file = BASE_DIR / "requirements.txt"
    if req_file.exists():
        print(f"  {Colors.CYAN}Syncing Python dependencies from requirements.txt...{Colors.RESET}")
        try:
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "-r", str(req_file), "--quiet"],
                cwd=str(BASE_DIR),
                check=False,
                timeout=90,
            )
            print(f"  {Colors.GREEN}[OK] Python dependencies up to date.{Colors.RESET}")
        except Exception as e:
            print(f"  {Colors.YELLOW}[Notice] Dependency sync skipped: {e}{Colors.RESET}")


def update_from_github(verbose: bool = True) -> bool:
    """
    Check and pull the latest changes from the GitHub repository automatically.
    Gracefully handles offline environments, detached heads, or local modifications.
    """
    git_dir = BASE_DIR / ".git"
    if not git_dir.exists():
        if verbose:
            print(f"  {Colors.DIM}[Notice] Not a git repository ({BASE_DIR}). Skipping auto-update.{Colors.RESET}")
        return False

    git_bin = shutil.which("git")
    if not git_bin:
        if verbose:
            print(f"  {Colors.DIM}[Notice] Git is not installed. Skipping auto-update.{Colors.RESET}")
        return False

    try:
        if verbose:
            print(f"  {Colors.CYAN}Checking for updates from GitHub repository...{Colors.RESET}")

        # Fetch remote quietly with timeout
        fetch_res = subprocess.run(
            [git_bin, "fetch", "--quiet"],
            cwd=str(BASE_DIR),
            capture_output=True,
            text=True,
            timeout=15,
        )
        if fetch_res.returncode != 0:
            if verbose:
                err_msg = (fetch_res.stderr or "").strip() or "network/remote unreachable"
                print(f"  {Colors.YELLOW}[Notice] Could not fetch updates from GitHub ({err_msg}). Continuing with current version.{Colors.RESET}")
            return False

        # Attempt pull --ff-only
        pull_res = subprocess.run(
            [git_bin, "pull", "--ff-only"],
            cwd=str(BASE_DIR),
            capture_output=True,
            text=True,
            timeout=30,
        )

        if pull_res.returncode == 0:
            out = (pull_res.stdout or "").strip()
            if "Already up to date." in out or "Already up-to-date." in out:
                if verbose:
                    print(f"  {Colors.GREEN}[OK] Neverland repository is up to date.{Colors.RESET}")
            else:
                print(f"  {Colors.GREEN}[OK] Updated Neverland to the latest version from GitHub!{Colors.RESET}")
                _sync_updated_dependencies()
            return True
        else:
            err = (pull_res.stderr or pull_res.stdout or "").strip()
            if verbose:
                print(f"  {Colors.YELLOW}[Notice] Auto-update skipped ({err or 'local changes present'}). Continuing...{Colors.RESET}")
            return False

    except subprocess.TimeoutExpired:
        if verbose:
            print(f"  {Colors.YELLOW}[Notice] Update check timed out. Continuing with current version.{Colors.RESET}")
        return False
    except Exception as e:
        if verbose:
            print(f"  {Colors.YELLOW}[Notice] Auto-update check skipped: {e}{Colors.RESET}")
        return False


def cmd_update(args):
    print_banner()
    print(f"\n{Colors.BOLD}Updating Neverland from GitHub repository...{Colors.RESET}")
    success = update_from_github(verbose=True)
    if success:
        print(f"\n{Colors.GREEN}{Colors.BOLD}[OK] Update completed successfully.{Colors.RESET}\n")
    else:
        print(f"\n{Colors.YELLOW}[Notice] Update finished with no new changes or was skipped.{Colors.RESET}\n")


def cmd_ffmpeg(args):
    print_banner()
    print(f"\n{Colors.BOLD}Checking FFmpeg status...{Colors.RESET}")
    force = getattr(args, "reinstall", False)
    ensure_ffmpeg(force=force)
    print()


# =====================================================================
# COMMAND: START
# =====================================================================

def is_process_running(pid: int) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    if platform.system() == "Windows":
        try:
            res = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True, check=False)
            return str(pid) in res.stdout
        except Exception:
            return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False


def kill_process_tree(pid: int):
    if not isinstance(pid, int) or pid <= 0:
        return
    if platform.system() == "Windows":
        try:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
    else:
        try:
            pgid = os.getpgid(pid)
            if pgid != os.getpgrp():
                os.killpg(pgid, signal.SIGTERM)
                time.sleep(0.5)
                if is_process_running(pid):
                    os.killpg(pgid, signal.SIGKILL)
            else:
                os.kill(pid, signal.SIGTERM)
                time.sleep(0.5)
                if is_process_running(pid):
                    os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        except Exception:
            try:
                os.kill(pid, signal.SIGTERM)
            except Exception:
                pass


def find_pids_by_port(port: int) -> list[int]:
    """Find PIDs of processes listening on a specific TCP port."""
    pids = []
    if platform.system() == "Windows":
        try:
            res = subprocess.run(["netstat", "-ano", "-p", "tcp"], capture_output=True, text=True, check=False)
            for line in res.stdout.splitlines():
                if f":{port}" in line and "LISTENING" in line.upper():
                    parts = line.strip().split()
                    if parts:
                        try:
                            p = int(parts[-1])
                            if p > 0 and p not in pids:
                                pids.append(p)
                        except ValueError:
                            pass
        except Exception:
            pass
    else:
        try:
            res = subprocess.run(["ss", "-tlpn", f"sport = :{port}"], capture_output=True, text=True, check=False)
            for match in re.finditer(r"pid=(\d+)", res.stdout):
                pids.append(int(match.group(1)))
        except Exception:
            pass
        if not pids and shutil.which("fuser"):
            try:
                res = subprocess.run(["fuser", f"{port}/tcp"], capture_output=True, text=True, check=False)
                for part in res.stdout.split() + res.stderr.split():
                    if part.strip().isdigit():
                        pids.append(int(part.strip()))
            except Exception:
                pass
        if not pids and shutil.which("lsof"):
            try:
                res = subprocess.run(["lsof", "-ti", f":{port}"], capture_output=True, text=True, check=False)
                for line in res.stdout.splitlines():
                    if line.strip().isdigit():
                        pids.append(int(line.strip()))
            except Exception:
                pass
    return list(set(pids))


def free_port_if_occupied(port: int) -> list[int]:
    """Free a TCP port if held by any stray process."""
    killed = []
    my_pid = os.getpid()
    for pid in find_pids_by_port(port):
        if pid != my_pid and pid > 0:
            kill_process_tree(pid)
            killed.append(pid)
    return killed


def find_stray_bot_processes() -> list[int]:
    """Find any running python processes executing Neverland's main.py."""
    stray_pids = []
    my_pid = os.getpid()
    if platform.system() == "Windows":
        try:
            res = subprocess.run(
                ["wmic", "process", "where", "name like 'python%.exe'", "get", "processid,commandline"],
                capture_output=True, text=True, check=False
            )
            for line in res.stdout.splitlines():
                if re.search(r"(?:^|[\s\\/])main\.py(?:\s|$)", line):
                    parts = line.strip().split()
                    if parts and parts[-1].isdigit():
                        p = int(parts[-1])
                        if p != my_pid and p not in stray_pids:
                            stray_pids.append(p)
        except Exception:
            pass
    else:
        try:
            res = subprocess.run(["ps", "-eo", "pid,args"], capture_output=True, text=True, check=False)
            for line in res.stdout.splitlines():
                if ("python" in line) and re.search(r"(?:^|[\s/])main\.py(?:\s|$)", line):
                    parts = line.strip().split()
                    if parts and parts[0].isdigit():
                        p = int(parts[0])
                        if p != my_pid and p not in stray_pids:
                            stray_pids.append(p)
        except Exception:
            pass
    return stray_pids


def find_npm_runner() -> str:
    refresh_env_path()
    for cmd in ["pnpm", "npm", "yarn"]:
        if shutil.which(cmd):
            return cmd
    if platform.system() == "Windows":
        portable_npm = Path.home() / ".neverland" / "node" / "npm.cmd"
        if portable_npm.exists():
            return str(portable_npm)
    return "npm"


def build_dashboard(runner: str, env: dict) -> bool:
    """Build Next.js 15 production bundle and record build stamp."""
    print(f"  {Colors.YELLOW}Building Next.js 15 production bundle with {runner}...{Colors.RESET}")
    build_cmd = get_node_cmd(runner, "run", "build")
    res = subprocess.run(build_cmd, cwd=str(DASHBOARD_DIR), env=env, check=False)
    if res.returncode == 0:
        build_stamp_file = DASHBOARD_DIR / ".next" / ".neverland-build-stamp"
        stamp_content = f"APP_URL={env.get('NEXT_PUBLIC_APP_URL', '')}|PORT={env.get('PORT', '3000')}|HOST={env.get('HOSTNAME', '0.0.0.0')}"
        try:
            build_stamp_file.parent.mkdir(parents=True, exist_ok=True)
            build_stamp_file.write_text(stamp_content, encoding="utf-8")
        except Exception:
            pass
        print(f"  {Colors.GREEN}[OK] Next.js Dashboard built successfully.{Colors.RESET}")
        return True
    else:
        print(f"  {Colors.RED}[ERROR] Next.js Dashboard build failed (exit code: {res.returncode}).{Colors.RESET}")
        return False


def cmd_build(args):
    print_banner()
    mode = resolve_active_mode(getattr(args, "mode", None)) or "prod"
    profile_file = PROFILES_DIR / f"{mode}.env"
    if not profile_file.exists():
        print(f"{Colors.YELLOW}No profile found for {mode}. Run 'neverland config' first.{Colors.RESET}")
        return

    activate_profile(mode)
    env = os.environ.copy()
    env.update(load_env_dict(BOT_ENV_FILE))
    runner = find_npm_runner()

    print(f"\n{Colors.BOLD}Building Neverland Dashboard in {mode.upper()} mode...{Colors.RESET}")
    if not (DASHBOARD_DIR / "node_modules").exists():
        print(f"  {Colors.YELLOW}Installing dashboard dependencies with {runner}...{Colors.RESET}")
        subprocess.run(get_node_cmd(runner, "install"), cwd=str(DASHBOARD_DIR), check=False)

    success = build_dashboard(runner, env)
    if not success:
        sys.exit(1)


def cmd_start(args):
    print_banner()

    # Disallow mutually exclusive flags
    if getattr(args, "bot_only", False) and getattr(args, "dashboard_only", False):
        print(f"{Colors.RED}Error: Cannot specify both --bot-only and --dashboard-only simultaneously.{Colors.RESET}")
        sys.exit(1)

    # 1. Automatic Update from GitHub Repository (Opt-in via --update or NEVERLAND_AUTO_UPDATE=true)
    if getattr(args, "update", False) or os.getenv("NEVERLAND_AUTO_UPDATE", "false").lower() == "true":
        update_from_github(verbose=True)

    # 2. Verify / Auto-Install FFmpeg (skips if already present)
    if not getattr(args, "skip_ffmpeg", False):
        ensure_ffmpeg()

    raw_mode = getattr(args, "mode", None)
    mode = resolve_active_mode(raw_mode)

    if not mode:
        print(f"\n{Colors.YELLOW}No active configuration profile found.{Colors.RESET}")
        print(f"{Colors.BOLD}Please select your deployment mode to configure:{Colors.RESET}\n")
        print(f"  {Colors.BOLD}[1] Development Mode (`dev`){Colors.RESET}")
        print(f"  {Colors.BOLD}[2] Publish / Production Mode (`prod` / `publish`){Colors.RESET}\n")
        choice = prompt_input("Select mode (1 for dev, 2 for prod/publish)", default="1")
        mode = normalize_mode(choice) or ("prod" if choice in ["2", "prod", "publish", "pub"] else "dev")
        cmd_config(argparse.Namespace(mode=mode))
        mode = resolve_active_mode(mode) or mode

    profile_file = PROFILES_DIR / f"{mode}.env"
    if not profile_file.exists():
        mode_label = "Publish / Production" if mode == "prod" else "Development"
        print(f"{Colors.YELLOW}No configuration found for {mode_label} mode ('{mode}'). Launching configuration wizard...{Colors.RESET}")
        cmd_config(argparse.Namespace(mode=mode))

    activate_profile(mode)
    pids = get_pids()

    # Check if any service is already running
    bot_pid = pids.get("bot_pid")
    dashboard_pid = pids.get("dashboard_pid")
    running_services = []
    if bot_pid and is_process_running(bot_pid):
        running_services.append(f"Bot (PID: {bot_pid})")
    if dashboard_pid and is_process_running(dashboard_pid):
        running_services.append(f"Dashboard (PID: {dashboard_pid})")

    if running_services:
        print(f"{Colors.YELLOW}Neverland services are already running: {', '.join(running_services)}.{Colors.RESET}")
        print(f"Use {Colors.BOLD}neverland stop{Colors.RESET} to stop them first, or {Colors.BOLD}neverland status{Colors.RESET} for details.")
        return

    mode_label = "PUBLISH / PROD" if mode == "prod" else "DEVELOPMENT (DEV)"
    print(f"\n{Colors.BOLD}Starting Neverland in {Colors.CYAN}{mode_label}{Colors.RESET}{Colors.BOLD} mode...{Colors.RESET}")

    env = os.environ.copy()
    env_vars = load_env_dict(BOT_ENV_FILE)
    env.update(env_vars)

    bot_proc = None
    dash_proc = None

    # Check python runner
    python_exe = sys.executable

    # Check Node & package manager
    runner = find_npm_runner()
    is_daemon = getattr(args, "daemon", False)

    # Process kwargs for daemon vs foreground
    proc_kwargs = {}
    if is_daemon:
        if platform.system() == "Windows":
            detached = getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
            create_new_group = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
            create_no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
            proc_kwargs["creationflags"] = detached | create_new_group | create_no_window
        else:
            proc_kwargs["start_new_session"] = True
    else:
        if platform.system() != "Windows":
            proc_kwargs["start_new_session"] = True

    # 1. Proactive MongoDB check before starting bot
    if not getattr(args, "dashboard_only", False):
        mongo_uri = env_vars.get("MONGODB_URI", "mongodb://localhost:27017")
        print(f"  Verifying MongoDB connectivity...")
        db_ok, db_err = check_mongodb_connection(mongo_uri, timeout_ms=3000)
        if not db_ok:
            print(f"  {Colors.YELLOW}[WARNING] MongoDB is unreachable at {mongo_uri.split('@')[-1]}:{Colors.RESET}")
            print(f"    {Colors.DIM}{db_err}{Colors.RESET}")
            if "TLSV1_ALERT_INTERNAL_ERROR" in db_err or "SSL handshake failed" in db_err:
                print(f"\n  {Colors.BOLD}{Colors.CYAN}💡 MongoDB Atlas IP Whitelist Notice:{Colors.RESET}")
                print(f"  Atlas rejected the connection during TLS handshake ({Colors.RED}TLSV1_ALERT_INTERNAL_ERROR{Colors.RESET}).")
                print(f"  This almost always means your current IP address is {Colors.BOLD}NOT whitelisted{Colors.RESET} in Atlas.")
                print(f"  {Colors.BOLD}To fix this:{Colors.RESET}")
                print(f"    1. Log in to {Colors.CYAN}https://cloud.mongodb.com{Colors.RESET}")
                print(f"    2. Go to {Colors.BOLD}Security > Network Access{Colors.RESET}")
                print(f"    3. Click {Colors.BOLD}+ Add IP Address{Colors.RESET}")
                print(f"    4. Select {Colors.BOLD}'Allow Access From Anywhere' (0.0.0.0/0){Colors.RESET} or 'Add Current IP Address'")
                print(f"    5. Click Confirm, wait ~1 minute for Atlas to apply, and restart Neverland.\n")
            else:
                print(f"    {Colors.YELLOW}Ensure MongoDB is running before starting the bot.{Colors.RESET}")
            if not is_daemon and sys.stdin.isatty():
                try:
                    proceed = prompt_input("Attempt to start services anyway? (y/N)", default="n").lower()
                except (KeyboardInterrupt, EOFError):
                    proceed = "n"
                if proceed not in ("y", "yes"):
                    print(f"  {Colors.RED}Startup cancelled.{Colors.RESET}")
                    return
        else:
            print(f"  {Colors.GREEN}[OK] MongoDB connection verified.{Colors.RESET}")

        # Proactively ensure control plane port is free from any previous orphaned instances
        ctrl_port = int(env_vars.get("CONTROL_PLANE_PORT", "8800"))
        freed_ctrl = free_port_if_occupied(ctrl_port)
        if freed_ctrl:
            print(f"  {Colors.YELLOW}[INFO] Freed occupied Control Plane port {ctrl_port} (PID: {', '.join(map(str, freed_ctrl))}){Colors.RESET}")
            time.sleep(0.5)

        bot_cmd = [python_exe, str(BASE_DIR / "main.py")]
        if is_daemon:
            bot_log = open(LOGS_DIR / "bot.log", "a", encoding="utf-8")
            bot_proc = subprocess.Popen(bot_cmd, cwd=str(BASE_DIR), env=env, stdout=bot_log, stderr=bot_log, **proc_kwargs)
            print(f"  {Colors.GREEN}[OK] Discord Bot started in background (PID: {bot_proc.pid}){Colors.RESET}")
        else:
            bot_proc = subprocess.Popen(bot_cmd, cwd=str(BASE_DIR), env=env, **proc_kwargs)
            print(f"  {Colors.GREEN}[OK] Discord Bot starting (PID: {bot_proc.pid})...{Colors.RESET}")

    # 2. Start Dashboard
    if not getattr(args, "bot_only", False):
        dash_script = "dev" if mode == "dev" else "start"
        
        # Check node_modules
        if not (DASHBOARD_DIR / "node_modules").exists():
            print(f"  {Colors.YELLOW}Installing dashboard dependencies with {runner}...{Colors.RESET}")
            subprocess.run(get_node_cmd(runner, "install"), cwd=str(DASHBOARD_DIR), check=False)

        # In prod mode, build if needed (first-run or if config changed)
        if mode == "prod":
            build_stamp_file = DASHBOARD_DIR / ".next" / ".neverland-build-stamp"
            expected_stamp = f"APP_URL={env.get('NEXT_PUBLIC_APP_URL', '')}|PORT={env.get('PORT', '3000')}|HOST={env.get('HOSTNAME', '0.0.0.0')}"
            needs_build = not (DASHBOARD_DIR / ".next").exists()
            if not needs_build and build_stamp_file.exists():
                try:
                    needs_build = (build_stamp_file.read_text(encoding="utf-8").strip() != expected_stamp)
                except Exception:
                    needs_build = True
            elif not needs_build and not build_stamp_file.exists():
                needs_build = True

            if needs_build:
                if not build_dashboard(runner, env):
                    print(f"  {Colors.RED}Startup aborted due to Next.js build failure.{Colors.RESET}")
                    return

        dash_port = str(env_vars.get("PORT", "3000"))
        dash_host = str(env_vars.get("HOSTNAME", "0.0.0.0"))
        env["PORT"] = dash_port
        env["HOSTNAME"] = dash_host

        # Proactively ensure dashboard port is free
        try:
            freed_dash = free_port_if_occupied(int(dash_port))
            if freed_dash:
                print(f"  {Colors.YELLOW}[INFO] Freed occupied Dashboard port {dash_port} (PID: {', '.join(map(str, freed_dash))}){Colors.RESET}")
                time.sleep(0.5)
        except Exception:
            pass

        dash_cmd = get_node_cmd(runner, "run", dash_script)

        if is_daemon:
            dash_log = open(LOGS_DIR / "dashboard.log", "a", encoding="utf-8")
            dash_proc = subprocess.Popen(dash_cmd, cwd=str(DASHBOARD_DIR), env=env, stdout=dash_log, stderr=dash_log, **proc_kwargs)
            print(f"  {Colors.GREEN}[OK] Next.js Dashboard started in background (PID: {dash_proc.pid}){Colors.RESET}")
        else:
            dash_proc = subprocess.Popen(dash_cmd, cwd=str(DASHBOARD_DIR), env=env, **proc_kwargs)
            print(f"  {Colors.GREEN}[OK] Next.js Dashboard starting (PID: {dash_proc.pid})...{Colors.RESET}")

    # Save PIDs
    save_pids({
        "bot_pid": bot_proc.pid if bot_proc else None,
        "dashboard_pid": dash_proc.pid if dash_proc else None,
        "mode": mode,
        "started_at": time.strftime("%Y-%m-%d %H:%M:%S")
    })

    dash_port = env_vars.get("PORT", "3000")
    app_url = env_vars.get("NEXT_PUBLIC_APP_URL") or f"http://localhost:{dash_port}"
    cp_port = env_vars.get("CONTROL_PLANE_PORT", "8800")
    print(f"\n{Colors.BOLD}{Colors.GREEN}[OK] Neverland is operational.{Colors.RESET}")
    print(f"  Web Dashboard: {Colors.CYAN}{app_url}{Colors.RESET} (listening on 0.0.0.0:{dash_port})")
    print(f"  Bot Control Plane: {Colors.DIM}http://127.0.0.1:{cp_port}{Colors.RESET} (listening on 0.0.0.0:{cp_port})\n")

    if is_daemon:
        print(f"To monitor logs: {Colors.BOLD}neverland logs -f{Colors.RESET}")
        print(f"To stop: {Colors.BOLD}neverland stop{Colors.RESET}")
    else:
        print(f"{Colors.DIM}Press Ctrl+C to terminate all services.{Colors.RESET}")
        try:
            while True:
                time.sleep(1)
                if bot_proc and bot_proc.poll() is not None:
                    code = bot_proc.returncode
                    print(f"\n{Colors.RED}{Colors.BOLD}Discord Bot stopped unexpectedly (exit code {code}).{Colors.RESET}")
                    bot_log_path = LOGS_DIR / "bot.log"
                    if bot_log_path.exists():
                        try:
                            log_lines = bot_log_path.read_text(encoding="utf-8", errors="replace").strip().splitlines()
                            if log_lines:
                                print(f"{Colors.YELLOW}Recent Bot Log / Error Output:{Colors.RESET}")
                                for l in log_lines[-10:]:
                                    print(f"  {Colors.DIM}{l}{Colors.RESET}")
                        except Exception:
                            pass
                    print(f"\n{Colors.YELLOW}Troubleshooting Tips:{Colors.RESET}")
                    print(f"  1. Verify your Discord Bot Token with {Colors.BOLD}neverland config{Colors.RESET}")
                    print(f"  2. Verify MongoDB is accessible ({env_vars.get('MONGODB_URI', 'mongodb://localhost:27017').split('@')[-1]})")
                    print(f"  3. Check full logs with {Colors.BOLD}neverland logs --bot{Colors.RESET}\n")
                    break
                if dash_proc and dash_proc.poll() is not None:
                    code = dash_proc.returncode
                    print(f"\n{Colors.RED}{Colors.BOLD}Dashboard stopped unexpectedly (exit code {code}).{Colors.RESET}")
                    dash_log_path = LOGS_DIR / "dashboard.log"
                    if dash_log_path.exists():
                        try:
                            log_lines = dash_log_path.read_text(encoding="utf-8", errors="replace").strip().splitlines()
                            if log_lines:
                                print(f"{Colors.YELLOW}Recent Dashboard Log / Error Output:{Colors.RESET}")
                                for l in log_lines[-10:]:
                                    print(f"  {Colors.DIM}{l}{Colors.RESET}")
                        except Exception:
                            pass
                    print(f"\n{Colors.YELLOW}Troubleshooting Tips:{Colors.RESET}")
                    print(f"  1. Check if port {env.get('PORT', '3000')} is already in use by another application")
                    print(f"  2. Run {Colors.BOLD}neverland build{Colors.RESET} to rebuild the production bundle")
                    print(f"  3. Check full logs with {Colors.BOLD}neverland logs --dashboard{Colors.RESET}\n")
                    break
        except KeyboardInterrupt:
            print("\nShutting down services...")
        finally:
            cmd_stop(argparse.Namespace(quiet=True))


# =====================================================================
# COMMAND: STOP
# =====================================================================

def cmd_stop(args):
    quiet = getattr(args, "quiet", False)
    if not quiet:
        print_banner()
        print(f"\n{Colors.BOLD}Stopping Neverland services...{Colors.RESET}")

    pids = get_pids()
    bot_pid = pids.get("bot_pid")
    dashboard_pid = pids.get("dashboard_pid")

    stopped_any = False
    if bot_pid and is_process_running(bot_pid):
        kill_process_tree(bot_pid)
        if not quiet:
            print(f"  {Colors.GREEN}[OK] Discord Bot stopped (PID: {bot_pid}){Colors.RESET}")
        stopped_any = True

    if dashboard_pid and is_process_running(dashboard_pid):
        kill_process_tree(dashboard_pid)
        if not quiet:
            print(f"  {Colors.GREEN}[OK] Web Dashboard stopped (PID: {dashboard_pid}){Colors.RESET}")
        stopped_any = True

    # Clean up any stray/orphaned bot processes running main.py
    for stray_pid in find_stray_bot_processes():
        if stray_pid != bot_pid and stray_pid != dashboard_pid:
            kill_process_tree(stray_pid)
            if not quiet:
                print(f"  {Colors.YELLOW}[OK] Cleaned up orphaned Bot process (PID: {stray_pid}){Colors.RESET}")
            stopped_any = True

    # Free control plane port if still bound
    env_vars = load_env_dict(BOT_ENV_FILE)
    try:
        ctrl_port = int(env_vars.get("CONTROL_PLANE_PORT", "8800"))
        for port_pid in free_port_if_occupied(ctrl_port):
            if not quiet:
                print(f"  {Colors.YELLOW}[OK] Freed Control Plane port {ctrl_port} (PID: {port_pid}){Colors.RESET}")
            stopped_any = True
    except Exception:
        pass

    # Free dashboard port if still bound
    try:
        dash_port = int(env_vars.get("PORT", "3000"))
        for port_pid in free_port_if_occupied(dash_port):
            if not quiet:
                print(f"  {Colors.YELLOW}[OK] Freed Dashboard port {dash_port} (PID: {port_pid}){Colors.RESET}")
            stopped_any = True
    except Exception:
        pass

    save_pids({})

    if not stopped_any and not quiet:
        print(f"  {Colors.DIM}No running Neverland processes detected.{Colors.RESET}")
    elif not quiet:
        print(f"\n{Colors.GREEN}[OK] All Neverland services stopped successfully.{Colors.RESET}")


def cmd_restart(args):
    cmd_stop(args)
    time.sleep(1.5)
    cmd_start(args)


# =====================================================================
# COMMAND: STATUS
# =====================================================================

def cmd_status(args):
    print_banner()
    state = get_state()
    pids = get_pids()
    active_mode = resolve_active_mode() or state.get("active_mode") or "prod"
    mode_label = "PUBLISH / PROD" if active_mode == "prod" else "DEVELOPMENT (DEV)"

    bot_pid = pids.get("bot_pid")
    dash_pid = pids.get("dashboard_pid")

    bot_alive = bot_pid and is_process_running(bot_pid)
    dash_alive = dash_pid and is_process_running(dash_pid)

    bot_status = f"{Colors.GREEN}RUNNING (PID: {bot_pid}){Colors.RESET}" if bot_alive else f"{Colors.RED}STOPPED{Colors.RESET}"
    dash_status = f"{Colors.GREEN}RUNNING (PID: {dash_pid}){Colors.RESET}" if dash_alive else f"{Colors.RED}STOPPED{Colors.RESET}"

    env_vars = load_env_dict(BOT_ENV_FILE)

    print(f"\n{Colors.BOLD}--- NEVERLAND STATUS REPORT ---{Colors.RESET}")
    print(f"  Active Profile:    {Colors.CYAN}{mode_label}{Colors.RESET} ({active_mode})")
    print(f"  Configured Modes:  {', '.join(state.get('configured_modes') or [active_mode])}")
    print(f"  Discord Bot:       {bot_status}")
    print(f"  Next.js Dashboard: {dash_status}")
    print(f"  Dashboard URL:     {Colors.CYAN}{env_vars.get('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')}{Colors.RESET}")
    print(f"  Control Plane IPC: http://127.0.0.1:{env_vars.get('CONTROL_PLANE_PORT', '8800')}")
    print(f"  Database Host:     {env_vars.get('MONGODB_URI', 'Not Configured').split('@')[-1]}")
    if pids.get("started_at"):
        print(f"  Uptime Started:    {pids.get('started_at')}")
    print("----------------------------------------------------------------------\n")


# =====================================================================
# COMMAND: LOGS
# =====================================================================

def cmd_logs(args):
    print_banner()
    target = "bot" if args.bot else ("dashboard" if args.dashboard else "all")
    follow = args.follow
    lines = max(1, getattr(args, "lines", 50) or 50)

    log_files = []
    if target in ["bot", "all"]:
        bf = LOGS_DIR / "bot.log"
        if bf.exists():
            log_files.append(("BOT", bf))
    if target in ["dashboard", "all"]:
        df = LOGS_DIR / "dashboard.log"
        if df.exists():
            log_files.append(("DASHBOARD", df))

    if not log_files:
        print(f"{Colors.YELLOW}No log files found in {LOGS_DIR}. Run services with `neverland start -d` first.{Colors.RESET}")
        return

    for tag, path in log_files:
        print(f"\n{Colors.BOLD}=== {tag} LOGS ({path.name}) ==={Colors.RESET}")
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
            for l in all_lines[-lines:]:
                print(l, end="")

    if follow:
        if len(log_files) > 1:
            print(f"\n{Colors.YELLOW}Notice: Real-time follow (-f) requires specifying a single target.{Colors.RESET}")
            print(f"Use {Colors.BOLD}neverland logs -f --bot{Colors.RESET} or {Colors.BOLD}neverland logs -f --dashboard{Colors.RESET}.\n")
            return

        _, single_path = log_files[0]
        print(f"\n{Colors.CYAN}Following {single_path.name}... (Ctrl+C to stop){Colors.RESET}")
        with open(single_path, "r", encoding="utf-8", errors="replace") as f:
            f.seek(0, os.SEEK_END)
            try:
                while True:
                    line = f.readline()
                    if line:
                        print(line, end="")
                    else:
                        time.sleep(0.5)
            except KeyboardInterrupt:
                pass


# =====================================================================
# COMMAND: DOMAIN & REVERSE PROXY GENERATOR
# =====================================================================

def cmd_domain(args):
    print_banner()
    sub = args.proxy_type or "nginx"
    env_vars = load_env_dict(BOT_ENV_FILE)
    domain = args.domain or env_vars.get("NEXT_PUBLIC_APP_URL", "https://dashboard.yourdomain.com").replace("https://", "").replace("http://", "").split(":")[0]
    port = args.port if args.port is not None else int(env_vars.get("PORT", "3000"))

    print(f"\n{Colors.BOLD}{Colors.CYAN}--- REVERSE PROXY & DOMAIN CONFIGURATION BUILDER ---{Colors.RESET}\n")

    if sub == "nginx":
        nginx_conf = f"""# Neverland Dashboard Nginx Configuration
# Created by bitt-ar | Support: https://ko-fi.com/E1E41CVWBU

server {{
    listen 80;
    server_name {domain};

    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}
}}
"""
        is_rhel = Path("/etc/nginx/conf.d").exists() and not Path("/etc/nginx/sites-available").exists()
        conf_dest = "/etc/nginx/conf.d/neverland.conf" if is_rhel else "/etc/nginx/sites-available/neverland"
        print(f"{Colors.BOLD}1. Save this config to:{Colors.RESET} {Colors.CYAN}{conf_dest}{Colors.RESET}\n")
        print(f"{Colors.DIM}{nginx_conf}{Colors.RESET}")
        print(f"{Colors.BOLD}2. Enable and obtain SSL Certificate via Let's Encrypt / Cloudflare:{Colors.RESET}")
        if not is_rhel:
            print(f"  {Colors.GREEN}sudo ln -s /etc/nginx/sites-available/neverland /etc/nginx/sites-enabled/{Colors.RESET}")
        print(f"  {Colors.GREEN}sudo nginx -t && sudo systemctl reload nginx{Colors.RESET}")
        print(f"  {Colors.GREEN}sudo certbot --nginx -d {domain}{Colors.RESET}\n")

    elif sub == "caddy":
        caddy_conf = f"""# Neverland Caddyfile Configuration (Automatic HTTPS via Let's Encrypt)
# Created by bitt-ar | Support: https://ko-fi.com/E1E41CVWBU

{domain} {{
    reverse_proxy 127.0.0.1:{port}
}}
"""
        print(f"{Colors.BOLD}Caddyfile configuration for {domain}:{Colors.RESET}\n")
        print(f"{Colors.DIM}{caddy_conf}{Colors.RESET}")
        print(f"Add this block to {Colors.CYAN}/etc/caddy/Caddyfile{Colors.RESET} and run: {Colors.GREEN}sudo systemctl reload caddy{Colors.RESET}\n")

    elif sub == "systemd":
        python_bin = sys.executable
        runner = find_npm_runner()

        bot_service = f"""[Unit]
Description=Neverland Discord Bot Service
After=network.target mongodb.service

[Service]
Type=simple
User=neverland
WorkingDirectory={BASE_DIR}
ExecStart={python_bin} {BASE_DIR}/main.py
Restart=always
RestartSec=5
EnvironmentFile={BOT_ENV_FILE}

[Install]
WantedBy=multi-user.target
"""
        dash_service = f"""[Unit]
Description=Neverland Next.js 15 Web Dashboard
After=network.target

[Service]
Type=simple
User=neverland
WorkingDirectory={DASHBOARD_DIR}
ExecStart={shutil.which(runner) or runner} start
Restart=always
RestartSec=5
Environment=PORT={port}
EnvironmentFile={DASHBOARD_ENV_FILE}

[Install]
WantedBy=multi-user.target
"""
        print(f"{Colors.BOLD}--- Systemd Service Units (Auto-start on Linux Boot) ---{Colors.RESET}\n")
        print(f"{Colors.YELLOW}Security Note: Systemd unit templates use dedicated 'User=neverland' instead of 'root'.{Colors.RESET}")
        print(f"Ensure that user exists ('sudo useradd -r -s /bin/false neverland') or adjust User= to your desired service account.\n")
        print(f"{Colors.CYAN}/etc/systemd/system/neverland-bot.service:{Colors.RESET}")
        print(f"{Colors.DIM}{bot_service}{Colors.RESET}\n")
        print(f"{Colors.CYAN}/etc/systemd/system/neverland-dashboard.service:{Colors.RESET}")
        print(f"{Colors.DIM}{dash_service}{Colors.RESET}\n")
        print(f"{Colors.BOLD}To activate systemd services:{Colors.RESET}")
        print(f"  {Colors.GREEN}sudo systemctl daemon-reload{Colors.RESET}")
        print(f"  {Colors.GREEN}sudo systemctl enable --now neverland-bot neverland-dashboard{Colors.RESET}\n")


# =====================================================================
# COMMAND: UNINSTALL
# =====================================================================

def cmd_uninstall(args):
    print_banner()
    print(f"\n{Colors.RED}{Colors.BOLD}⚠️  DANGER ZONE: UNINSTALL NEVERLAND BOT & DASHBOARD{Colors.RESET}\n")
    print("This operation will:")
    print("  - Stop all running Neverland bot and dashboard processes")
    print("  - Remove local environment files (.env, dashboard/.env.local, .neverland/)")
    print("  - Remove the Python virtual environment (.venv)")
    print("  - Remove Next.js build cache (.next)")
    print("  - Remove CLI command shims\n")

    try:
        confirm = input(f"Type {Colors.BOLD}{Colors.RED}UNINSTALL{Colors.RESET} to confirm removal: ").strip()
    except (KeyboardInterrupt, EOFError):
        print(f"\n{Colors.GREEN}Uninstallation cancelled.{Colors.RESET}")
        return

    if confirm != "UNINSTALL":
        print(f"\n{Colors.GREEN}Uninstallation aborted. Nothing was touched.{Colors.RESET}")
        return

    print(f"\n{Colors.YELLOW}Stopping services...{Colors.RESET}")
    cmd_stop(argparse.Namespace(quiet=True))

    # Clean runtime files
    if NEVERLAND_DIR.exists():
        shutil.rmtree(NEVERLAND_DIR, ignore_errors=True)
        print(f"  {Colors.GREEN}[OK] Removed .neverland runtime state & profiles{Colors.RESET}")

    if BOT_ENV_FILE.exists():
        BOT_ENV_FILE.unlink(missing_ok=True)
        print(f"  {Colors.GREEN}[OK] Removed root .env file{Colors.RESET}")

    if DASHBOARD_ENV_FILE.exists():
        DASHBOARD_ENV_FILE.unlink(missing_ok=True)
        print(f"  {Colors.GREEN}[OK] Removed dashboard/.env.local{Colors.RESET}")

    venv_dir = BASE_DIR / ".venv"
    if venv_dir.exists():
        print(f"  {Colors.YELLOW}Removing Python virtual environment...{Colors.RESET}")
        if platform.system() == "Windows" and sys.prefix.lower() == str(venv_dir).lower():
            cleaner = f'cmd.exe /c "timeout /t 2 /nobreak >nul & rmdir /s /q \\"{venv_dir}\\""'
            subprocess.Popen(cleaner, shell=True, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW)
            print(f"  {Colors.GREEN}[OK] Scheduled .venv deletion immediately upon CLI exit{Colors.RESET}")
        else:
            shutil.rmtree(venv_dir, ignore_errors=True)
            print(f"  {Colors.GREEN}[OK] Removed .venv{Colors.RESET}")

    next_dir = DASHBOARD_DIR / ".next"
    if next_dir.exists():
        shutil.rmtree(next_dir, ignore_errors=True)
        print(f"  {Colors.GREEN}[OK] Removed dashboard/.next cache{Colors.RESET}")

    # Remove shims and path
    if platform.system() == "Windows":
        bin_dir = Path.home() / ".neverland" / "bin"
        if bin_dir.exists():
            shutil.rmtree(bin_dir, ignore_errors=True)
            print(f"  {Colors.GREEN}[OK] Removed Windows CLI shims{Colors.RESET}")
        try:
            import winreg
            bin_str = str(bin_dir)
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment", 0, winreg.KEY_ALL_ACCESS) as key:
                current_path, ptype = winreg.QueryValueEx(key, "Path")
                paths = [p for p in current_path.split(";") if p.strip() and p.lower() != bin_str.lower()]
                new_path = ";".join(paths)
                winreg.SetValueEx(key, "Path", 0, ptype, new_path)
                print(f"  {Colors.GREEN}[OK] Cleaned up User PATH{Colors.RESET}")
        except Exception:
            pass
    else:
        shim_file = Path.home() / ".local" / "bin" / "neverland"
        if shim_file.exists():
            shim_file.unlink(missing_ok=True)
            print(f"  {Colors.GREEN}[OK] Removed Linux/macOS CLI shim{Colors.RESET}")

    print(f"\n{Colors.GREEN}{Colors.BOLD}Neverland has been completely uninstalled.{Colors.RESET}")
    print(f"Author: bitt-ar | https://github.com/bitt-ar/Neverland-bot\n")


# =====================================================================
# CLI PARSER DEFINITION & INTERACTIVE LAUNCHER
# =====================================================================

def cmd_menu(parser):
    """Interactive navigation menu when CLI is launched without arguments in an interactive terminal."""
    print_banner()
    state = get_state()
    active = state.get("active_mode") or ("prod" if (PROFILES_DIR / "prod.env").exists() else ("dev" if (PROFILES_DIR / "dev.env").exists() else "None"))
    print(f"\n{Colors.BOLD}Neverland Interactive CLI{Colors.RESET} (Active Profile: {Colors.CYAN}{active}{Colors.RESET})\n")
    print(f"  {Colors.BOLD}[1]{Colors.RESET} Start Bot & Web Dashboard ({Colors.GREEN}neverland start{Colors.RESET})")
    print(f"  {Colors.BOLD}[2]{Colors.RESET} Check System Status ({Colors.CYAN}neverland status{Colors.RESET})")
    print(f"  {Colors.BOLD}[3]{Colors.RESET} Interactive Configuration Wizard ({Colors.YELLOW}neverland config{Colors.RESET})")
    print(f"  {Colors.BOLD}[4]{Colors.RESET} View Service Logs ({Colors.DIM}neverland logs{Colors.RESET})")
    print(f"  {Colors.BOLD}[5]{Colors.RESET} Check & Pull GitHub Updates ({Colors.BLUE}neverland update{Colors.RESET})")
    print(f"  {Colors.BOLD}[6]{Colors.RESET} Check / Install FFmpeg ({Colors.MAGENTA}neverland ffmpeg{Colors.RESET})")
    print(f"  {Colors.BOLD}[7]{Colors.RESET} Build Production Next.js Bundle ({Colors.CYAN}neverland build{Colors.RESET})")
    print(f"  {Colors.BOLD}[8]{Colors.RESET} Show Full Command Help")
    print(f"  {Colors.BOLD}[0]{Colors.RESET} Exit\n")

    try:
        choice = prompt_input("Select an action (0-8)", default="1")
    except (KeyboardInterrupt, EOFError):
        print("\nExiting.")
        sys.exit(0)

    mapping = {
        "1": ["start"],
        "2": ["status"],
        "3": ["config"],
        "4": ["logs"],
        "5": ["update"],
        "6": ["ffmpeg"],
        "7": ["build"],
    }
    if choice in mapping:
        sub_args = parser.parse_args(mapping[choice])
        sub_args.func(sub_args)
    elif choice == "8":
        parser.print_help()
    else:
        print("Exiting Neverland.")
        sys.exit(0)


def main():
    parser = argparse.ArgumentParser(
        prog="neverland",
        description="Neverland All-in-One Discord Automation & Web Dashboard CLI | Created by bitt-ar",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--version", "-v", action="version", version=f"Neverland CLI {__version__} (by bitt-ar)")

    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")

    MODE_CHOICES = ["dev", "prod", "publish", "pub", "development"]

    # config
    p_config = subparsers.add_parser("config", help="Interactive configuration wizard (Dev or Publish/Prod modes)")
    p_config.add_argument("-m", "--mode", choices=MODE_CHOICES, help="Directly configure specified mode (dev or prod/publish)")
    p_config.set_defaults(func=cmd_config)

    # build
    p_build = subparsers.add_parser("build", help="Build Next.js 15 production bundle")
    p_build.add_argument("-m", "--mode", choices=MODE_CHOICES, help="Mode profile to build with (defaults to active mode or prod)")
    p_build.set_defaults(func=cmd_build)

    # start
    p_start = subparsers.add_parser("start", help="Start Discord Bot and Dashboard")
    p_start.add_argument("-m", "--mode", choices=MODE_CHOICES, help="Mode to start in (dev or prod/publish)")
    p_start.add_argument("-d", "--daemon", action="store_true", help="Run processes in background daemon mode")
    p_start.add_argument("--bot-only", action="store_true", help="Start only the Discord Bot")
    p_start.add_argument("--dashboard-only", action="store_true", help="Start only the Web Dashboard")
    p_start.add_argument("--update", action="store_true", help="Check for and pull updates before starting (or use 'neverland update')")
    p_start.add_argument("--no-update", action="store_true", help="Skip checking for GitHub updates before starting")
    p_start.add_argument("--skip-ffmpeg", action="store_true", help="Skip checking/installing FFmpeg before starting")
    p_start.set_defaults(func=cmd_start)

    # stop
    p_stop = subparsers.add_parser("stop", help="Stop running Bot and Dashboard processes")
    p_stop.set_defaults(func=cmd_stop)

    # restart
    p_restart = subparsers.add_parser("restart", help="Restart Bot and Dashboard services")
    p_restart.add_argument("-m", "--mode", choices=MODE_CHOICES, help="Mode to restart in (dev or prod/publish)")
    p_restart.add_argument("-d", "--daemon", action="store_true", help="Restart in background daemon mode")
    p_restart.add_argument("--no-update", action="store_true", help="Skip checking for GitHub updates on restart")
    p_restart.add_argument("--skip-ffmpeg", action="store_true", help="Skip checking/installing FFmpeg on restart")
    p_restart.set_defaults(func=cmd_restart)

    # status
    p_status = subparsers.add_parser("status", help="Show real-time status of Bot, Dashboard, and Database")
    p_status.set_defaults(func=cmd_status)

    # update
    p_update = subparsers.add_parser("update", help="Update Neverland from GitHub repository and sync dependencies")
    p_update.set_defaults(func=cmd_update)

    # ffmpeg
    p_ffmpeg = subparsers.add_parser("ffmpeg", help="Check or install FFmpeg for audio and voice features")
    p_ffmpeg.add_argument("--install", "--reinstall", action="store_true", dest="reinstall", help="Force install or reinstall FFmpeg")
    p_ffmpeg.set_defaults(func=cmd_ffmpeg)

    # logs
    p_logs = subparsers.add_parser("logs", help="View service logs")
    p_logs.add_argument("-f", "--follow", action="store_true", help="Follow log output in real-time")
    p_logs.add_argument("-n", "--lines", type=int, default=50, help="Number of log lines to show (default 50)")
    p_logs.add_argument("--bot", action="store_true", help="Show only bot logs")
    p_logs.add_argument("--dashboard", action="store_true", help="Show only dashboard logs")
    p_logs.set_defaults(func=cmd_logs)

    # domain
    p_domain = subparsers.add_parser("domain", help="Generate reverse proxy and domain configurations")
    p_domain.add_argument("proxy_type", choices=["nginx", "caddy", "systemd"], default="nginx", nargs="?", help="Proxy type: nginx, caddy, or systemd")
    p_domain.add_argument("--domain", help="Custom domain (e.g. dashboard.yourdomain.com)")
    p_domain.add_argument("--port", type=int, default=None, help="Local dashboard port (default: from active .env or 3000)")
    p_domain.set_defaults(func=cmd_domain)

    # uninstall
    p_uninstall = subparsers.add_parser("uninstall", help="Completely uninstall Neverland Bot and remove files")
    p_uninstall.set_defaults(func=cmd_uninstall)

    args = parser.parse_args()

    if not args.command:
        if sys.stdin.isatty() and sys.stdout.isatty():
            cmd_menu(parser)
            return
        print_banner()
        parser.print_help()
        sys.exit(0)

    args.func(args)


if __name__ == "__main__":
    main()

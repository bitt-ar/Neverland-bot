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
import subprocess
import time
from pathlib import Path

# Paths
CLI_DIR = Path(__file__).resolve().parent
BASE_DIR = CLI_DIR.parent
DASHBOARD_DIR = BASE_DIR / "dashboard"
NEVERLAND_DIR = BASE_DIR / ".neverland"
PROFILES_DIR = NEVERLAND_DIR / "profiles"
LOGS_DIR = NEVERLAND_DIR / "logs"
STATE_FILE = NEVERLAND_DIR / "state.json"
PIDS_FILE = NEVERLAND_DIR / "pids.json"

BOT_ENV_FILE = BASE_DIR / ".env"
DASHBOARD_ENV_FILE = DASHBOARD_DIR / ".env.local"

# ANSI Color Codes
class Colors:
    HEADER = "\033[95m"
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
    with open(path, "w", encoding="utf-8") as f:
        if header:
            f.write(f"# {header}\n# Generated by Neverland CLI (bitt-ar | https://ko-fi.com/E1E41CVWBU)\n\n")
        for k, v in data.items():
            f.write(f"{k}={v}\n")


def prompt_input(label: str, default: str = "", secret: bool = False, required: bool = False) -> str:
    default_hint = f" [{Colors.DIM}{default[:6]}...{Colors.RESET}]" if (secret and default) else (f" [{Colors.DIM}{default}{Colors.RESET}]" if default else "")
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

    dashboard_data = {
        "TOKEN": profile_data.get("TOKEN", ""),
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
    new_cfg["PORT"] = prompt_input("Web Dashboard Port", default=existing.get("PORT", "3000"))
    new_cfg["HOSTNAME"] = "0.0.0.0"
    new_cfg["CONTROL_PLANE_PORT"] = prompt_input("Bot Control Plane Internal Port", default=existing.get("CONTROL_PLANE_PORT", "8800"))
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

    # Auto-generate or preserve cryptographic secrets
    new_cfg["CONTROL_PLANE_SECRET"] = existing.get("CONTROL_PLANE_SECRET") or secrets.token_hex(32)
    new_cfg["DASHBOARD_SESSION_SECRET"] = existing.get("DASHBOARD_SESSION_SECRET") or secrets.token_hex(32)
    new_cfg["RADIO_ENCRYPTION_KEY"] = existing.get("RADIO_ENCRYPTION_KEY") or generate_fernet_key()
    new_cfg["RADIO_MAX_PLAYLIST_STORAGE_MB"] = existing.get("RADIO_MAX_PLAYLIST_STORAGE_MB", "100")

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
# COMMAND: START
# =====================================================================

def is_process_running(pid: int) -> bool:
    if pid <= 0:
        return False
    if platform.system() == "Windows":
        try:
            output = subprocess.check_output(f"tasklist /FI \"PID eq {pid}\" /NH", shell=True, text=True)
            return str(pid) in output
        except Exception:
            return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False


def find_npm_runner() -> str:
    for cmd in ["pnpm", "npm", "yarn"]:
        if shutil.which(cmd):
            return cmd
    return "npm"


def cmd_start(args):
    print_banner()
    raw_mode = getattr(args, "mode", None)
    mode = resolve_active_mode(raw_mode)

    if not mode:
        print(f"\n{Colors.YELLOW}No active configuration profile found.{Colors.RESET}")
        print(f"{Colors.BOLD}Please select your deployment mode to configure:{Colors.RESET}\n")
        print(f"  {Colors.BOLD}[1] Development Mode (`dev`){Colors.RESET}")
        print(f"  {Colors.BOLD}[2] Publish / Production Mode (`prod` / `publish`){Colors.RESET}\n")
        choice = prompt_input("Select mode (1 for dev, 2 for prod/publish)", default="2")
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

    # Check if already running
    bot_pid = pids.get("bot_pid")
    dashboard_pid = pids.get("dashboard_pid")
    if bot_pid and is_process_running(bot_pid):
        print(f"{Colors.YELLOW}Neverland Bot is already running (PID: {bot_pid}).{Colors.RESET}")
        print(f"Use {Colors.BOLD}neverland stop{Colors.RESET} to stop it first, or {Colors.BOLD}neverland status{Colors.RESET} for details.")
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

    # 1. Start Discord Bot
    if not getattr(args, "dashboard_only", False):
        bot_cmd = [python_exe, str(BASE_DIR / "main.py")]
        if is_daemon:
            bot_log = open(LOGS_DIR / "bot.log", "a", encoding="utf-8")
            bot_proc = subprocess.Popen(bot_cmd, cwd=str(BASE_DIR), env=env, stdout=bot_log, stderr=bot_log)
            print(f"  {Colors.GREEN}[OK] Discord Bot started in background (PID: {bot_proc.pid}){Colors.RESET}")
        else:
            bot_proc = subprocess.Popen(bot_cmd, cwd=str(BASE_DIR), env=env)
            print(f"  {Colors.GREEN}[OK] Discord Bot starting (PID: {bot_proc.pid})...{Colors.RESET}")

    # 2. Start Dashboard
    if not getattr(args, "bot_only", False):
        dash_script = "dev" if mode == "dev" else "start"
        
        # Check node_modules
        if not (DASHBOARD_DIR / "node_modules").exists():
            print(f"  {Colors.YELLOW}Installing dashboard dependencies with {runner}...{Colors.RESET}")
            subprocess.run([runner, "install"], cwd=str(DASHBOARD_DIR), check=False)

        # In prod mode, build if needed
        if mode == "prod" and not (DASHBOARD_DIR / ".next").exists():
            print(f"  {Colors.YELLOW}Building Next.js 15 production bundle...{Colors.RESET}")
            subprocess.run([runner, "run", "build"], cwd=str(DASHBOARD_DIR), env=env, check=False)

        dash_port = str(env_vars.get("PORT", "3000"))
        dash_host = str(env_vars.get("HOSTNAME", "0.0.0.0"))
        env["PORT"] = dash_port
        env["HOSTNAME"] = dash_host

        dash_cmd = [runner, "run", dash_script]
        if platform.system() == "Windows":
            dash_cmd = ["cmd", "/c"] + dash_cmd

        if is_daemon:
            dash_log = open(LOGS_DIR / "dashboard.log", "a", encoding="utf-8")
            dash_proc = subprocess.Popen(dash_cmd, cwd=str(DASHBOARD_DIR), env=env, stdout=dash_log, stderr=dash_log)
            print(f"  {Colors.GREEN}[OK] Next.js Dashboard started in background (PID: {dash_proc.pid}){Colors.RESET}")
        else:
            dash_proc = subprocess.Popen(dash_cmd, cwd=str(DASHBOARD_DIR), env=env)
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
                    print(f"{Colors.RED}Discord Bot stopped unexpectedly (exit code {bot_proc.returncode}).{Colors.RESET}")
                    break
                if dash_proc and dash_proc.poll() is not None:
                    print(f"{Colors.RED}Dashboard stopped unexpectedly (exit code {dash_proc.returncode}).{Colors.RESET}")
                    break
        except KeyboardInterrupt:
            print("\nShutting down services...")
        finally:
            cmd_stop(argparse.Namespace(quiet=True))


# =====================================================================
# COMMAND: STOP
# =====================================================================

def kill_process_tree(pid: int):
    if pid <= 0:
        return
    if platform.system() == "Windows":
        try:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
    else:
        try:
            os.kill(pid, signal.SIGTERM)
            time.sleep(0.5)
            if is_process_running(pid):
                os.kill(pid, signal.SIGKILL)
        except Exception:
            pass


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

    save_pids({})

    if not stopped_any and not quiet:
        print(f"  {Colors.DIM}No running Neverland processes detected.{Colors.RESET}")
    elif not quiet:
        print(f"\n{Colors.GREEN}[OK] All Neverland services stopped successfully.{Colors.RESET}")


def cmd_restart(args):
    cmd_stop(args)
    time.sleep(1)
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
    lines = args.lines or 50

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

    if follow and len(log_files) == 1:
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
    port = args.port or int(env_vars.get("PORT", "3000"))

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
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}
}}
"""
        print(f"{Colors.BOLD}1. Save this config to:{Colors.RESET} {Colors.CYAN}/etc/nginx/sites-available/neverland{Colors.RESET}\n")
        print(f"{Colors.DIM}{nginx_conf}{Colors.RESET}")
        print(f"{Colors.BOLD}2. Enable and obtain SSL Certificate via Let's Encrypt:{Colors.RESET}")
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
User=root
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
User=root
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
    print("  - Remove Next.js build cache and node_modules (optional)")
    print("  - Remove CLI command shims\n")

    confirm = input(f"Type {Colors.BOLD}{Colors.RED}UNINSTALL{Colors.RESET} to confirm removal: ").strip()
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
        shutil.rmtree(venv_dir, ignore_errors=True)
        print(f"  {Colors.GREEN}[OK] Removed .venv{Colors.RESET}")

    next_dir = DASHBOARD_DIR / ".next"
    if next_dir.exists():
        shutil.rmtree(next_dir, ignore_errors=True)
        print(f"  {Colors.GREEN}[OK] Removed dashboard/.next cache{Colors.RESET}")

    # Remove shims
    if platform.system() == "Windows":
        shim_dir = Path.home() / ".neverland" / "bin"
        if shim_dir.exists():
            shutil.rmtree(shim_dir, ignore_errors=True)
            print(f"  {Colors.GREEN}[OK] Removed Windows CLI shims{Colors.RESET}")
    else:
        shim_file = Path.home() / ".local" / "bin" / "neverland"
        if shim_file.exists():
            shim_file.unlink(missing_ok=True)
            print(f"  {Colors.GREEN}[OK] Removed Linux/macOS CLI shim{Colors.RESET}")

    print(f"\n{Colors.GREEN}{Colors.BOLD}Neverland has been completely uninstalled.{Colors.RESET}")
    print(f"Author: bitt-ar | https://github.com/bitt-ar/Neverland-bot\n")


# =====================================================================
# CLI PARSER DEFINITION
# =====================================================================

def main():
    parser = argparse.ArgumentParser(
        prog="neverland",
        description="Neverland All-in-One Discord Automation & Web Dashboard CLI | Created by bitt-ar",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--version", "-v", action="version", version="Neverland CLI 1.0.0 (by bitt-ar)")

    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")

    MODE_CHOICES = ["dev", "prod", "publish", "pub", "development"]

    # config
    p_config = subparsers.add_parser("config", help="Interactive configuration wizard (Dev or Publish/Prod modes)")
    p_config.add_argument("-m", "--mode", choices=MODE_CHOICES, help="Directly configure specified mode (dev or prod/publish)")
    p_config.set_defaults(func=cmd_config)

    # start
    p_start = subparsers.add_parser("start", help="Start Discord Bot and Dashboard")
    p_start.add_argument("-m", "--mode", choices=MODE_CHOICES, help="Mode to start in (dev or prod/publish)")
    p_start.add_argument("-d", "--daemon", action="store_true", help="Run processes in background daemon mode")
    p_start.add_argument("--bot-only", action="store_true", help="Start only the Discord Bot")
    p_start.add_argument("--dashboard-only", action="store_true", help="Start only the Web Dashboard")
    p_start.set_defaults(func=cmd_start)

    # stop
    p_stop = subparsers.add_parser("stop", help="Stop running Bot and Dashboard processes")
    p_stop.set_defaults(func=cmd_stop)

    # restart
    p_restart = subparsers.add_parser("restart", help="Restart Bot and Dashboard services")
    p_restart.add_argument("-m", "--mode", choices=MODE_CHOICES, help="Mode to restart in (dev or prod/publish)")
    p_restart.add_argument("-d", "--daemon", action="store_true", help="Restart in background daemon mode")
    p_restart.set_defaults(func=cmd_restart)

    # status
    p_status = subparsers.add_parser("status", help="Show real-time status of Bot, Dashboard, and Database")
    p_status.set_defaults(func=cmd_status)

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
    p_domain.add_argument("--port", type=int, default=3000, help="Local dashboard port (default: 3000)")
    p_domain.set_defaults(func=cmd_domain)

    # uninstall
    p_uninstall = subparsers.add_parser("uninstall", help="Completely uninstall Neverland Bot and remove files")
    p_uninstall.set_defaults(func=cmd_uninstall)

    args = parser.parse_args()

    if not args.command:
        print_banner()
        parser.print_help()
        sys.exit(0)

    args.func(args)


if __name__ == "__main__":
    main()

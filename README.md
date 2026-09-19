<div align="center">

# 🌟 Neverland

**Enterprise-grade All-in-One Discord Automation Platform & Real-Time Supabase-styled Management Dashboard**

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/E1E41CVWBU)
[![GitHub stars](https://img.shields.io/github/stars/bitt-ar/Neverland-bot?style=for-the-badge&logo=github&color=238636&labelColor=161b22)](https://github.com/bitt-ar/Neverland-bot/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/bitt-ar/Neverland-bot?style=for-the-badge&logo=github&color=1f6feb&labelColor=161b22)](https://github.com/bitt-ar/Neverland-bot/network/members)
[![GitHub issues](https://img.shields.io/github/issues/bitt-ar/Neverland-bot?style=for-the-badge&color=e3b341&labelColor=161b22)](https://github.com/bitt-ar/Neverland-bot/issues)
[![License](https://img.shields.io/github/license/bitt-ar/Neverland-bot?style=for-the-badge&color=8957e5&labelColor=161b22)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white&labelColor=161b22)](https://www.python.org/)
[![discord.py](https://img.shields.io/badge/discord.py-2.7+-5865F2?style=for-the-badge&logo=discord&logoColor=white&labelColor=161b22)](https://github.com/Rapptz/discord.py)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=nextdotjs&logoColor=white&labelColor=161b22)](https://nextjs.org/)
[![UI Style](https://img.shields.io/badge/UI-Supabase_Dark-3ECF8E?style=for-the-badge&labelColor=161b22)](https://supabase.com/)

<p align="center">
  <strong>Neverland unites a lightning-fast asynchronous Python Discord bot with an interactive Next.js 15 management dashboard and a powerful cross-platform CLI. Everything you need to automate, protect, and grow your Discord community.</strong>
</p>

[Quickstart](#-quickstart-one-command-installation) • [CLI Reference](#-neverland-cli) • [Key Features](#-all-in-one-modules) • [Server & Domain Setup](#-server--custom-domain-setup) • [Support](#-support--sponsorship)

</div>

---

## ⚡ Quickstart (One-Command Installation)

Get Neverland installed, configured, and running in seconds with a single command. The installer handles Python virtual environments, dependencies, sets up the `neverland` CLI command globally, launches the interactive configuration wizard, and starts your bot automatically.

### 🪟 Windows (PowerShell)
Open PowerShell as Administrator or standard user and run:
```powershell
irm https://raw.githubusercontent.com/bitt-ar/Neverland-bot/main/install.ps1 | iex
```

### 🐧 Linux & 🍎 macOS (Bash / Zsh)
Open Terminal and run:
```bash
curl -fsSL https://raw.githubusercontent.com/bitt-ar/Neverland-bot/main/install.sh | bash
```

> **What the installer does:**
> 1. Verifies/installs Python (3.11+) and Node.js (18+).
> 2. Clones and configures the environment in a dedicated virtualenv.
> 3. Installs Python packages and Dashboard dependencies.
> 4. Adds the `neverland` CLI command to your system PATH.
> 5. Launches `neverland config` interactively.
> 6. Starts the Bot & Dashboard immediately with `neverland start`!

---

## 🖥️ Neverland CLI

Neverland ships with a unified, cross-platform CLI tool to manage every aspect of your bot and dashboard lifecycle.

```text
  _   _                     _                 _ 
 | \ | | _____   _____ _ __| | __ _ _ __   __| |
 |  \| |/ _ \ \ / / _ \ '__| |/ _` | '_ \ / _` |
 | |\  |  __/\ V /  __/ |  | | (_| | | | | (_| |
 |_| \_|\___| \_/ \___|_|  |_|\__,_|_| |_|\__,_|
 All-in-One Discord Automation & Management Platform
 Created with ❤️ by bitt-ar | Ko-fi: https://ko-fi.com/E1E41CVWBU
```

| Command | Description |
|---|---|
| `neverland config` | Launch the interactive configuration wizard (Dev or Prod/Server modes). |
| `neverland start` | Start both the Discord Bot and Web Dashboard. |
| `neverland start -d` | Start services in background daemon mode. |
| `neverland stop` | Gracefully stop all running Neverland processes. |
| `neverland restart` | Restart bot and dashboard services. |
| `neverland status` | View real-time status of Bot, Dashboard, Database, and Ports. |
| `neverland logs` | Stream live combined or dedicated service logs (`--follow`, `--bot`, `--dashboard`). |
| `neverland domain` | Generate ready-to-use Nginx or Caddy reverse proxy configs with SSL setup. |
| `neverland uninstall` | Completely clean up and remove Neverland, venv, and dependencies. |

### 🔒 Strict Profile Isolation (`dev` vs `prod`)
`neverland config` keeps your **Development** and **Production** environments completely isolated:
- **Development Mode (`dev`)**: Uses local guild testing (`GUILD_ID`), binds to `localhost:3000`, skips public OAuth credentials. Saved to `.neverland/profiles/dev.env`.
- **Production Mode (`prod`)**: Full Discord OAuth2 login, custom domain binding, HTTPS reverse proxy integration, hardened cryptographic session secrets. Saved to `.neverland/profiles/prod.env`.
- Settings never bleed into or overwrite each other when switching modes!

---

## 📸 Dashboard Preview

![Neverland Dashboard Preview](assets/dashboard-preview.png)

The Next.js 15 dashboard offers real-time synchronization with the bot core over an authenticated internal IPC control plane (`:8800`).

---

## 🧩 All-in-One Modules

Neverland comes fully loaded out of the box—no fragmented bots or third-party add-ons required:

| Module Identifier | Status | Display Title | Dashboard Route | Required Discord Permissions |
|---|---|---|---|---|
| `tickets` | Active | Support Tickets | `/community/tickets` | `manage_channels`, `manage_roles` |
| `giveaways` | Active | Giveaways | `/community/giveaways` | `manage_guild`, `manage_messages`, `embed_links` |
| `moderation` | Active | Moderation & Security | `/automation/moderation` | `moderate_members`, `kick_members`, `ban_members`, `manage_messages` |
| `temp_voice` | Active | Temporary Voice Lounges | `/community/temp-voice` | `manage_channels`, `move_members` |
| `leveling` | Active | Leveling & XP Progression | `/community/leveling` | `manage_roles`, `send_messages`, `embed_links` |
| `reaction_roles` | Active | Reaction Roles & Menus | `/automation/reaction-roles` | `manage_roles`, `send_messages`, `add_reactions`, `embed_links` |
| `welcome` | Active | Welcome & Onboarding | `/automation/welcome` | `send_messages`, `embed_links`, `attach_files`, `manage_roles` |

### Detailed Module Capabilities:
- **Support Tickets**: Race-safe ticket channel creation with atomic MongoDB counters, automatic private channel isolation, persistent interactive components (`timeout=None`) surviving bot restarts, staff claim/close/reopen controls, and transcript generation.
- **Moderation Suite**: Full moderation toolset featuring `/warn`, `/timeout`, `/kick`, `/ban`, `/modlogs` with automated infraction cases, DM notices, and audit logging.
- **Giveaway Engine**: Interactive giveaway creator with embed banners, duration countdowns, bonus entry multipliers for specific roles, required server roles, and rerolls via slash command or message context menu.
- **Temporary Voice Lounges**: Dynamic voice channel generation upon joining a trigger channel, automated dynamic ownership delegation, permission locks, member limits, rename controls, and automated channel cleanup when empty.
- **Leveling & Experience**: Message XP tracking with per-user cooldowns, voice activity XP accumulation, customizable level-up announcements, dynamic rank cards rendered with Pillow, and tiered role rewards.
- **Reaction Roles**: Multi-mode role distribution supporting classic reactions, persistent Discord component buttons, and interactive dropdown selection menus with live dashboard sync.
- **Welcome & Onboarding**: Greeting announcements, automatic join role assignments, and customizable welcome cards rendered dynamically with PIL.
- **Control Plane IPC**: Real-time bidirectional control bridge between Next.js and Discord bot via secret-authenticated internal HTTP APIs.

---

## 🌐 Server & Custom Domain Setup

Deploying Neverland to a VPS (Ubuntu, Debian, etc.) and linking your custom domain (e.g., `dashboard.yourdomain.com`) is effortless with the CLI.

### 1. Configure for Production
Run the CLI on your server:
```bash
neverland config --mode prod
```
When prompted, enter:
- Your Discord Bot Token, Client ID, and Client Secret.
- Your Custom Domain / Public URL: `https://dashboard.yourdomain.com`.
- MongoDB connection string (local or MongoDB Atlas).

### 2. Generate Reverse Proxy Configuration
Neverland generates ready-to-use reverse proxy configs:
```bash
# Generate Nginx configuration
neverland domain nginx

# Or generate Caddy configuration
neverland domain caddy
```

#### Example Nginx Configuration (`/etc/nginx/sites-available/neverland`):
```nginx
server {
    server_name dashboard.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable HTTPS via Let's Encrypt:
```bash
sudo certbot --nginx -d dashboard.yourdomain.com
```

### 3. Update Discord Developer Portal
In your [Discord Developer Portal](https://discord.com/developers/applications):
1. Navigate to **OAuth2 > General**.
2. Add your Redirect URI:
   ```text
   https://dashboard.yourdomain.com/api/auth/callback/discord
   ```
3. Save changes.

### 4. Run as a Systemd Service (Optional)
Generate systemd service files automatically:
```bash
neverland domain systemd
```
Then start and enable:
```bash
sudo systemctl enable --now neverland-bot
sudo systemctl enable --now neverland-dashboard
```

---

## 🛠️ Architecture

```
+------------------------------------+           Internal HTTP IPC           +------------------------------------+
|           Web Dashboard            | ------------------------------------> |         Bot Control Plane          |
|      Next.js 15 + Shadcn UI        |       (Secret-Gated Header Auth)      |       Python aiohttp Daemon        |
|      Turbopack, Tailwind CSS       | <------------------------------------ |         Port 8800 (Local)          |
+------------------------------------+             JSON Payloads             +------------------------------------+
                  |                                                                     |
                  |                   +-------------------------+                       |
                  +-----------------> |    MongoDB Database     | <---------------------+
                                      | Guild Configs & States  |
                                      +-------------------------+
                                                   ^
                                                   | Gateway WebSocket & REST
                                      +-------------------------+
                                      |    Discord Platform     |
                                      +-------------------------+
```

---

## ☕ Support & Sponsorship

Neverland is maintained with passionate dedication by **[bitt-ar](https://github.com/bitt-ar)**. If Neverland saves you time, powers your community, or inspires your projects, please consider supporting development:

<div align="center">

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/E1E41CVWBU)

**[Support bitt-ar on Ko-fi](https://ko-fi.com/E1E41CVWBU)**

Your support helps fund hosting, development of new modules, and continuous open-source improvements.

</div>

---

## 📄 License

Neverland is licensed under the [MIT License](LICENSE).
Copyright (c) 2026 bitt-ar.

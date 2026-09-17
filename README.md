# Neverland

<div align="center">

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/E1E41CVWBU)

[![GitHub stars](https://img.shields.io/github/stars/bitt-ar/Neverland-bot?style=for-the-badge&logo=github&color=238636&labelColor=161b22)](https://github.com/bitt-ar/Neverland-bot/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/bitt-ar/Neverland-bot?style=for-the-badge&logo=github&color=1f6feb&labelColor=161b22)](https://github.com/bitt-ar/Neverland-bot/network/members)
[![GitHub issues](https://img.shields.io/github/issues/bitt-ar/Neverland-bot?style=for-the-badge&color=e3b341&labelColor=161b22)](https://github.com/bitt-ar/Neverland-bot/issues)
[![License](https://img.shields.io/github/license/bitt-ar/Neverland-bot?style=for-the-badge&color=8957e5&labelColor=161b22)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white&labelColor=161b22)](https://www.python.org/)
[![discord.py](https://img.shields.io/badge/discord.py-2.4+-5865F2?style=for-the-badge&logo=discord&logoColor=white&labelColor=161b22)](https://github.com/Rapptz/discord.py)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=nextdotjs&logoColor=white&labelColor=161b22)](https://nextjs.org/)
[![UI Style](https://img.shields.io/badge/UI-Supabase_Dark-3ECF8E?style=for-the-badge&labelColor=161b22)](https://supabase.com/)

<p align="center">
  <strong>Enterprise-grade Discord automation platform paired with a real-time, Supabase-inspired management dashboard.</strong>
</p>

</div>

---

## Overview

Neverland is a dual-process Discord administration platform engineered for high reliability, responsiveness, and clean administrative control. It unites an asynchronous Python Discord bot core with a modern Next.js 15 web dashboard styled according to the clean, high-density Supabase design system.

The platform provides dedicated sub-engines for customer support ticketing, temporary voice channels, leveling and rank progression, reaction role assignment, onboarding greeting cards, and giveaways—all controllable via Discord slash commands and an authenticated web interface.

---

## Dashboard Preview

![Neverland Dashboard Preview](assets/dashboard-preview.png)

---

## Key Modules

- **Support Ticket System**: Race-safe ticket channel creation with atomic database counters, automatic private channel isolation, permission assignment, and staff management controls (claim, close, reopen, user access).
- **Temporary Voice Lounges**: Dynamic voice channel generation upon trigger join, dynamic ownership delegation, permission locks, member limits, rename controls, and automated channel cleanup when empty.
- **Leveling & Experience**: Message XP tracking with per-user rate-limiting, voice activity XP accumulation, customizable level-up announcements, and tiered role rewards.
- **Reaction Roles**: Multi-mode role distribution supporting classic reactions, persistent Discord component buttons, and interactive dropdown selection menus with live configuration sync.
- **Welcome & Onboarding**: Greeting announcements, automatic join role assignments (`Active member` and `BOT`), and customizable welcome cards rendered dynamically via PIL (Pillow).
- **Giveaway Engine**: Slash command giveaway creator with automated countdowns, randomized winner selection, and reroll support.
- **Control Plane IPC**: Real-time bidirectional control bridge between Next.js and Discord bot via secret-authenticated internal HTTP APIs.

---

## Module Directory

| Module Identifier | Status | Display Title | Dashboard Route | Required Discord Permissions |
|---|---|---|---|---|
| `tickets` | Active | Support Tickets | `/community/tickets` | `manage_channels`, `manage_roles` |
| `temp_voice` | Active | Temporary Voice | `/community/temp-voice` | `manage_channels`, `move_members` |
| `leveling` | Active | Leveling & XP | `/community/leveling` | `manage_roles`, `send_messages`, `embed_links` |
| `reaction_roles` | Active | Reaction Roles | `/automation/reaction-roles` | `manage_roles`, `send_messages`, `add_reactions`, `embed_links` |
| `welcome` | Active | Welcome & Onboarding | `/automation/welcome` | `send_messages`, `embed_links`, `attach_files`, `manage_roles` |

---

## Slash Commands Reference

All slash commands are synced from a single global source to prevent duplicate command entries in the Discord interface.

| Command | Scope | Description | Required Permissions |
|---|---|---|---|
| `/help` | Global | Display the interactive command index and module guide | Everyone |
| `/sync` | Global | Force sync application slash command tree to Discord | Administrator |
| `/rank` | Global | View your level, XP progression, and server rank | Everyone |
| `/leaderboard` | Global | Display the top ranked members in the server | Everyone |
| `/setlevel` | Global | Manually set a target user experience points or level | Administrator |
| `/ticket send_panel`| Global | Deploy an interactive support ticket creation panel | Manage Channels |
| `/ticket close` | Global | Close the current support ticket channel | Manage Channels |
| `/ticket add` | Global | Add a user to the current support ticket | Manage Channels |
| `/ticket remove` | Global | Remove a user from the current support ticket | Manage Channels |
| `/tempvoice setup` | Global | Deploy the temporary voice creation hub | Manage Channels |
| `/tempvoice lock` | Global | Restrict access to your temporary voice channel | Channel Owner |
| `/tempvoice unlock` | Global | Re-open your temporary voice channel to everyone | Channel Owner |
| `/tempvoice name` | Global | Rename your temporary voice channel | Channel Owner |
| `/tempvoice limit` | Global | Set maximum member capacity for your channel | Channel Owner |
| `/reactionrole create` | Global | Launch the reaction role message creator | Manage Roles |
| `/welcome test` | Global | Preview the dynamic welcome card in the target channel | Manage Guild |
| `/welcome setchannel` | Global | Designate the primary welcome channel | Manage Guild |
| `/giveaway start` | Global | Start a new giveaway with custom duration and prize | Manage Guild |
| `/giveaway end` | Global | Conclude an active giveaway immediately | Manage Guild |
| `/giveaway reroll` | Global | Randomly select a new winner for a completed giveaway | Manage Guild |

---

## Architecture

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

- **Bot Daemon (`discord.py 2.4+`, Python 3.11+)**: Handles real-time gateway events, module listeners, atomic MongoDB persistence, and an embedded `aiohttp` HTTP server (`127.0.0.1:8800`) secured by `X-Internal-Secret`.
- **Management Dashboard (`Next.js 15`, `React 19`, `Tailwind CSS`)**: High-density, Supabase-dark admin dashboard providing live metric visualization, module toggles, role selectors, and channel configurations.
- **Shared Data Layer (`MongoDB`)**: High-performance persistence layer tracking guild settings, counters, XP stats, and reaction mappings.

---

## Getting Started

### Prerequisites

- Python 3.11 or later
- Node.js 18+ and `pnpm` (or `npm`)
- MongoDB 6.0+ (Local installation or MongoDB Atlas cluster)
- Discord Developer Application with a Bot Token and Privileged Gateway Intents enabled:
  - Server Members Intent
  - Message Content Intent

---

### Installation

#### 1. Clone Repository
```bash
git clone https://github.com/bitt-ar/Neverland-bot.git
cd Neverland-bot
```

#### 2. Configure Environment
Copy the example environment template and populate your credentials:
```bash
cp .env.example .env
```

Edit `.env`:
```env
TOKEN=your_discord_bot_token_here
MONGODB_URI=mongodb://localhost:27017/neverland
CONTROL_PLANE_SECRET=generate_a_secure_random_secret
CONTROL_PLANE_HOST=127.0.0.1
CONTROL_PLANE_PORT=8800
GUILD_ID=your_primary_discord_guild_id
```

Configure dashboard environment:
```bash
cd dashboard
cp .env.example .env.local
```

Edit `dashboard/.env.local`:
```env
CONTROL_PLANE_SECRET=same_secret_as_in_bot_env
INTERNAL_API_URL=http://127.0.0.1:8800
MONGODB_URI=mongodb://localhost:27017/neverland
```

---

### Running the Services

#### Start the Discord Bot:
```bash
pip install -r requirements.txt
python main.py
```

#### Start the Next.js Web Dashboard:
```bash
cd dashboard
pnpm install
pnpm dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### Production Deployment via Docker

Run the entire platform including MongoDB with Docker Compose:
```bash
docker compose up -d --build
```

---

## Quality Gates & Verification

```bash
# Verify dashboard compilation and linting
cd dashboard && pnpm build && pnpm lint

# Verify Python syntax and integrity
python -m py_compile main.py
python -m py_compile bot/control/server.py
```

---

## Support & Sponsorship

If you find Neverland useful for your community, please consider supporting its development:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/E1E41CVWBU)

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

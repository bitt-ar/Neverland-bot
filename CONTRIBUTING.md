# Contributing to Neverland

Thank you for your interest in contributing to Neverland! Neverland is an open-source, enterprise-grade All-in-One Discord automation platform paired with a Supabase-styled Next.js dashboard and unified CLI.

## How to Contribute

### 1. Reporting Bugs
- Search existing GitHub Issues before submitting a new one.
- Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.yml).
- Include steps to reproduce, environment details, and relevant logs.

### 2. Suggesting Features
- Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.yml).
- Describe the feature, its use cases, and how it aligns with Neverland's modular architecture.

### 3. Submitting Pull Requests
- Fork the repository and create a descriptive branch:
  ```bash
  git checkout -b feature/awesome-module
  ```
- Make your changes with clear, concise commit messages.
- Ensure all quality gates pass before opening a PR:
  ```bash
  # Verify Python code compiles cleanly
  python -m py_compile main.py
  python -m py_compile cli/neverland.py

  # Verify Dashboard compiles and lints
  cd dashboard
  pnpm lint
  pnpm build
  ```
- Submit your Pull Request referencing any related issues.

## Project Structure

- `bot/` & `cogs/`: Discord bot cogs, event listeners, and slash commands.
- `core/`: Database connections (MongoDB), shared configuration, and schemas.
- `dashboard/`: Next.js 15 web dashboard with Supabase-dark theme and real-time control plane.
- `cli/`: Neverland unified CLI (`neverland config`, `start`, `stop`, `status`, `uninstall`, `domain`).
- `install.sh` / `install.ps1`: Cross-platform one-line installers.

## Code of Conduct

All contributors and maintainers are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Support the Creator

If you appreciate Neverland and want to support its ongoing development:
[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/E1E41CVWBU)

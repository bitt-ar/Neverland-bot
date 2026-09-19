# Security Policy

## Supported Versions

We actively maintain and support the following versions of Neverland with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

Security is a high priority for Neverland. If you discover a security vulnerability within the platform:

1. **Do NOT report security vulnerabilities through public GitHub issues.**
2. Please report sensitive vulnerabilities via GitHub Security Advisories or by emailing the project maintainer at `support@neverlandbot.com` / opening a private disclosure on GitHub.
3. Include detailed reproduction steps, the potential impact, and any proof-of-concept information.
4. You will receive an acknowledgement within 48 hours and regular updates on fix progress.

## Security Architecture Highlights

- **Control Plane Authentication**: Internal HTTP communication between the Next.js Dashboard and the Python Discord Bot is cryptographically secured with an `X-Internal-Secret` header using constant-time verification.
- **Session Protection**: Dashboard sessions are encrypted and signed using cryptographic session secrets.
- **Environment Isolation**: Separate, isolated profile storage prevents production credentials from ever mixing with development setups.
- **Role Permission Enforcement**: Discord slash commands strictly check guild permissions before executing sensitive moderation or configuration tasks.

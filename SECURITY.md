# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| 1.x     | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a vulnerability in Garden Godmother, please report it responsibly.

### Preferred: GitHub Private Vulnerability Reporting

1. Go to the [Security tab](https://github.com/rancur/garden-godmother/security/advisories) of this repository
2. Click **"Report a vulnerability"**
3. Fill out the form with details about the vulnerability

This is the fastest way to reach us and keeps the report confidential until a fix is ready.

### Alternative: Email

If you prefer email, contact **security@rancur.dev** with:

- A description of the vulnerability
- Steps to reproduce
- The affected version(s)
- Any potential impact assessment

### What to Expect

- **Acknowledgment**: Within 48 hours of your report
- **Status update**: Within 7 days with our assessment
- **Fix timeline**: Critical issues within 14 days, others within 30 days
- **Credit**: We will credit reporters in the release notes (unless you prefer anonymity)

### Scope

The following are in scope:
- SQL injection, XSS, CSRF vulnerabilities
- Authentication or authorization bypasses
- Data exposure or leakage
- Path traversal or file access issues
- Docker container escape or privilege escalation
- Dependency vulnerabilities with a known exploit

### Out of Scope

- Issues in dependencies without a proof-of-concept exploit
- Denial of service attacks requiring significant resources
- Social engineering attacks
- Issues in third-party services (Home Assistant, Meshtastic)

## Security Best Practices for Self-Hosters

- Always run behind a reverse proxy with HTTPS
- Change default credentials immediately after installation
- Keep your Docker images updated (`docker compose pull && docker compose up -d`)
- Restrict network access to trusted IPs if exposing to the internet
- Review environment variables and never commit `.env` files

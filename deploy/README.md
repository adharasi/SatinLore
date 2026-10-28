# Deployment comes after the hardware milestone

This repository is a local simulator, not a deployable beta. No cloud resources or
credentials are included. Production mode intentionally fails until it is implemented.

The planned minimum is a single VPS with Caddy HTTPS, a non-root FastAPI service and
SQLite outside the web root. Before adding deployment configuration, complete:

- Individual authenticated sessions, CSRF/origin checks and rate limits.
- Server-only vendor credentials, explicit device selection and verified command expiry.
- Supported phone/browser checks and a qualified story-privacy boundary.
- A database backup/restore exercise, rollback and session-disable procedure.

Keep the application bound to localhost behind the reverse proxy. Do not deploy the
development `--reload` command or treat the simulator health endpoint as beta readiness.

# Deployment follows hardware and operational qualification

This is a local development build with a simulator and authenticated hardware-check flow. It is not an externally deployable beta. Production mode and nonlocal app origins intentionally fail configuration validation.

The planned minimum is a single VPS with Caddy HTTPS, a non-root FastAPI service and SQLite outside the web root. Before deployment, complete:

- Live SDK/device/browser qualification and a reviewed story-privacy boundary.
- Production origin, secure-cookie, proxy/rate-limit and secret-management configuration.
- Data deletion and explicit retention, including existing invitation/session records.
- Database-consistent backup/restore, rollback, support and access-revocation procedures.
- A clear response to output continuing after transport failure; backend revocation cannot guarantee physical Stop.

Invitation sessions, CSRF/origin checks, bounded requests and local rate limits already exist. Their presence does not establish internet-facing readiness. Keep the app on loopback behind the future reverse proxy; never deploy the development `--reload` command. The health response must continue to distinguish availability from beta readiness.

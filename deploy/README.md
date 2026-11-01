# Deployment options

## Founder-only reader preview

The product owner's 1 November 2026 request authorises a private simulator release at `app.satinlore.com`, protected by Cloudflare Access. The [Cloudflare adapter and runbook](cloudflare/README.md) host only the browser reader, with signed Access-token validation on every request. Reader text and opted-in saved stories remain browser-local. The local Python authentication database and vendor/device-check routes are not deployed by that adapter.

This allows software review without representing simulator output as qualified hardware behaviour. Full external beta readiness remains a separate roadmap gate. Follow the runbook's Access-first order: a successful build alone is not proof of a protected live hostname.

## Future full Python backend

The FastAPI development server still rejects production mode and nonlocal origins. The planned minimum for that backend is a single VPS with Caddy HTTPS, a non-root FastAPI service and SQLite outside the web root. Before exposing it, complete:

- Production origin, secure-cookie, proxy/rate-limit and secret-management configuration.
- Data deletion and explicit retention, including invitation/session records.
- Database-consistent backup/restore, rollback, support and access-revocation procedures.
- Reviewed story-privacy boundaries and live SDK/device/browser qualification before real story playback.
- A clear response to output continuing after transport failure; backend revocation cannot guarantee physical Stop.

Keep the development service on loopback; never deploy the `--reload` command. Health responses distinguish availability from beta readiness.

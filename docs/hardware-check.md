# Local authenticated device check

This screen exercises pairing and one short device command. It does not connect story reading to a real device and is not an external beta deployment. Until the device arrives, use [test-today.md](test-today.md). Prepare a copy of [hardware-test-record.md](hardware-test-record.md) to record observed results for each device/browser configuration.

## Prerequisites

- Complete the README setup and run the checks.
- Have a Lovense developer token and the exact Website Name from your developer dashboard. Confirm your integration access with Lovense.
- Pair your Lush 3 or Lush 4 with Lovense Remote first. Reproduce the official vendor demo before diagnosing SatinLore.
- Use a desktop browser for the initial QR flow and a phone with Lovense Remote. Same-phone app switching is a separate qualification task.
- Use a browser with Web Locks support. The check permits one controlling tab per origin; unsupported browsers fail the connection step.

The default simulator remains usable without any vendor access. No developer token belongs in the browser, repository or chat.

## Configure the server

Stop the running development server before changing its process variables. In PowerShell:

```powershell
$env:SATINLORE_DEVICE_MODE = "lovense"
$env:SATINLORE_APP_ORIGIN = "http://127.0.0.1:8000"
$env:LOVENSE_PLATFORM_NAME = Read-Host "Lovense Website Name"
$token = Read-Host "Lovense developer token" -AsSecureString
$env:LOVENSE_DEVELOPER_TOKEN = [System.Net.NetworkCredential]::new("", $token).Password
Remove-Variable token
py run.py
```

In Bash (use a Bash terminal on macOS):

```bash
export SATINLORE_DEVICE_MODE=lovense
export SATINLORE_APP_ORIGIN=http://127.0.0.1:8000
read -r -p "Lovense Website Name: " LOVENSE_PLATFORM_NAME
read -r -s -p "Lovense developer token: " LOVENSE_DEVELOPER_TOKEN
printf '\n'
export LOVENSE_PLATFORM_NAME LOVENSE_DEVELOPER_TOKEN
python3 run.py
```

The token is entered without echoing or placing its value in shell history. It still exists in the server process environment. Close the terminal when finished, or unset the variables after stopping the server. The loader reads process variables, not `.env` files.

| Variable | Default / use |
| --- | --- |
| `SATINLORE_DEVICE_MODE` | `simulator`; set `lovense` for the hardware check |
| `SATINLORE_APP_ORIGIN` | `http://127.0.0.1:8000`; exact local origin, no trailing slash |
| `SATINLORE_DATABASE_PATH` | Repository `data/satinlore.sqlite3`; always outside public static files |
| `SATINLORE_SESSION_TTL_SECONDS` | `3600`; allowed range 60–86400 |
| `LOVENSE_DEVELOPER_TOKEN` | Server-only secret required in Lovense mode |
| `LOVENSE_PLATFORM_NAME` | Exact Website Name required in Lovense mode |

Production mode and nonlocal app origins are deliberately unsupported. Local HTTP cookies omit `Secure`; a configured HTTPS origin uses it. Cookies are HttpOnly, SameSite Strict and scoped to `/api`. Do not expose this reload server publicly.

## Create and redeem an invitation

In another terminal at the repository root, using the same database path if customised:

```powershell
# Windows
.venv\Scripts\python.exe scripts/create_invite.py --hours 24
```

```sh
# macOS/Linux
.venv/bin/python scripts/create_invite.py --hours 24
```

`--hours` accepts 1–168; default 24. The command prints the invitation token once. It is a bearer credential: paste it into the invitation field at <http://127.0.0.1:8000/device-check>, not a URL or issue report. A token can be redeemed once. Expired or used invitations fail.

Each redemption creates a temporary anonymous beta identity and session. There is no email login or account recovery yet; a new invitation is needed after expiry or logout. An invitation command run in an unconfigured second terminal can use the default simulator setting; it only needs the same database path, not the developer token.

## Exercise the connection

1. Redeem the invitation, then explicitly connect Lovense.
2. Scan the displayed QR with Lovense Remote. Do not share the QR or connection credentials.
3. Select one supported online device; a discovered device must not be selected automatically.
4. With the device on a desk, issue the bounded low-output test. Confirm only that device responds and measure when output stops.
5. Exercise Stop, selection changes, disconnect, tab hiding, session expiry and logout. Returning or reconnecting must require another explicit test action.

The command is limited to two seconds and a maximum level of 5/20. The UI timer and successful SDK call do not establish physical expiry. Follow the full [QA checklist](qa.md) before extending playback.

Only one tab may hold the device-check lock. Hiding the active tab tears down its connection; returning requires an explicit reconnect and device selection.

## Privacy and lifecycle limits

The reader never loads the vendor SDK. The device-check page hosts it in a sandboxed iframe without same-origin permission, and the bridge exchanges only connection/control messages. No story content is passed to it. The mocked Chromium test verifies that the frame cannot read its parent's DOM; live SDK/network and supported-browser qualification remain required. See the [evidence ledger](beta-roadmap.md#evidence-ledger).

Invitation and application-session bearer tokens are hashed in SQLite. The database also contains temporary user IDs, timestamps and hashed rate-limit keys. Expired rows and unused identities are removed opportunistically during invitation creation/redemption or rate-limit writes; there is no scheduled retention job. Logout invalidates the application session. Neither logout nor local database removal promises vendor-side token revocation or an immediate physical stop after transport failure.

This phase has no persistent user account, feedback store or remote deletion API. Before external testing, finish the data-deletion/retention workflow and operational controls. Do not attach the database, cookies, QR payloads or vendor responses to bug reports.

## Troubleshooting

- **Origin rejected:** open the exact configured scheme, host and port. Do not substitute `localhost` for `127.0.0.1`.
- **Invalid/used invitation:** create a fresh token for the same database. Repeated attempts are rate-limited.
- **Lovense mode unavailable:** configure both vendor variables, set the mode, then restart the server.
- **Vendor connection failed:** verify dashboard access, Website Name, credentials and network access. Server responses intentionally omit vendor payloads.
- **No supported device:** confirm pairing in Lovense Remote. Discovery alone is not a support guarantee.
- **Session expired:** the connection must stop and a new invitation is needed. No automatic resume is expected.

Reference: [Standard JS SDK](https://developer.lovense.com/docs/standard-solutions/standard-js-sdk) and [server token exchange](https://developer.lovense.com/docs/standard-solutions/socket-api), checked 28 October 2026.

# SatinLore

A browser-first reader for synchronising users' text with a supported Lovense device. The current development build contains a **local reader simulator and an authenticated device-check screen**.

## Current status

Implemented: TXT/paste, paragraph navigation, manual levels, simulator, ceiling and Stop/Pause; one-use beta invitations and expiring sessions; server-side Lovense token exchange; a separate device-check screen with explicit device selection, a bounded test command and Stop.

The reader still drives the simulator only. Real-device behaviour and the vendor connection need qualification with your credentials and hardware. Scoring, scroll tracking, story-to-device playback, feedback and production deployment remain outstanding. Text stays in reader-page memory and clears on reload.

Read the [specification](docs/development-spec.md), [roadmap](docs/beta-roadmap.md) and [hardware-check setup](docs/hardware-check.md).

## Quick start

Install Python 3.12+, Git and VS Code; Node.js 24 for JavaScript checks. The simulator needs no hardware or credentials.

```sh
git clone https://github.com/adharasi/SatinLore.git
cd SatinLore
code .
```

Windows, in the VS Code terminal:

```powershell
py bootstrap.py
py run.py
```

macOS/Linux:

```sh
python3 bootstrap.py
python3 run.py
```

Open <http://127.0.0.1:8000>; Ctrl+C stops the server. Bootstrap installs dependencies into `.venv` using internet access. Select that VS Code interpreter with **Python: Select Interpreter**. Keep the exact configured origin: `localhost` and `127.0.0.1` are not interchangeable for authenticated requests.

For hardware work, follow [the dedicated setup](docs/hardware-check.md). `.env.example` documents process variables; the application does not automatically load `.env` files.

## Run checks

```powershell
# Windows
py scripts/check.py
```

```sh
# macOS/Linux
python3 scripts/check.py
```

Use the [QA checklist](docs/qa.md) for browser and physical-device evidence. Fake SDK tests do not certify real hardware.

Optional browser integration checks use Playwright and a fake vendor SDK. See the QA checklist for installation; `scripts/check.py` remains the offline unit/syntax check command.

## Repository map

| Path | Purpose |
| --- | --- |
| `app/main.py`, `app/api/` | HTTP assembly, invitations, session identity, logout and vendor-token issuance |
| `app/core/` | Local-only configuration and mode validation |
| `app/services/`, `app/db/` | Server-side vendor exchange and SQLite invitation/session records |
| `app/static/reader/` | Local text import; future scoring/position modules |
| `app/static/devices/` | Device adapters and testable control logic |
| `app/static/device-check.*`, `device-bridge.*` | Separate hardware check and sandboxed vendor SDK bridge |
| `app/static/playback/` | Future story playback controller boundary |
| `scripts/create_invite.py` | Local one-use invitation issuance |
| `tests/`, `scripts/check.py` | Automated checks and their common entry point |
| `docs/`, `deploy/` | Scope, roadmap, QA, setup and deployment planning |
| `AGENTS.md`, `app/static/AGENTS.md` | Repository and browser instructions for Codex |

## Work with Codex

Install the official OpenAI Codex VS Code extension, sign in and open this repository root. See [the Codex workflow](docs/codex.md).

Next: qualify the connection screen with one device, then implement the reading loop and its controller tests. Keep hardware qualification, simulated evidence and planned work separate. Supply credentials through local configuration, never chat or committed files.

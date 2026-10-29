# SatinLore

A browser-first reader for synchronising users' text with a supported Lovense device. The current development build contains a **local reader simulator and an authenticated device-check screen**.

## Current status

Implemented: a **saved-story reading workspace** with Satin Editorial light, Midnight Ink dark and System appearance. A collapsible library opens TXT/pasted stories straight into continuous reading, with background local analysis and optional corrections. Wide/Comfortable/Full widths, focus mode and optional settings preserve your place. Explicit local saving retains opted-in stories and progress; session-only remains the default. Persistent strength −/+, confirmed Start/ceiling and Pause/Stop control the bounded simulator. One-use invitations and expiring sessions support a separate authenticated device-check screen.

The reader still drives the simulator only. Real-device behaviour and the vendor connection need qualification with your credentials and hardware. Suggestion quality needs user evaluation. Story-to-real-device playback, feedback, server account-data deletion and production deployment remain outstanding. Unsaved stories clear on reload. **Save on this browser** stores a story locally by choice; it is visible to others using that browser and is not cloud sync or a backup. Reopening always stays paused with strength reset. Delete one/all removes retained story data; appearance is separate. Hardware is not required to continue the software-beta roadmap.

**Start testing today:** [hardware-free front-end and authentication guide](docs/test-today.md). It includes a neutral sample and expected results. Use the [frontend design checks](docs/frontend-design.md) for themes, responsive layout and accessibility review.

For the device session, use [hardware setup](docs/hardware-check.md) and the [blank hardware record](docs/hardware-test-record.md). Technical scope and evidence are in the [specification](docs/development-spec.md), [roadmap](docs/beta-roadmap.md) and [QA checklist](docs/qa.md).

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
| `app/static/appearance.js`, `theme.css`, `reader.css` | Theme preference, approved semantic colours and responsive reader layout |
| `app/static/reader/` | Local import/background analysis, override model, opted-in story storage and reading-position selection |
| `app/static/devices/` | Device adapters and testable control logic |
| `app/static/device-check.*`, `device-bridge.*` | Separate hardware check and sandboxed vendor SDK bridge |
| `app/static/playback/` | Simulator playback state, cadence, ceiling and interruption control |
| `scripts/create_invite.py` | Local one-use invitation issuance |
| `tests/`, `scripts/check.py` | Automated checks and their common entry point |
| `docs/`, `deploy/` | Scope, roadmap, QA, setup and deployment planning |
| `AGENTS.md`, `app/static/AGENTS.md` | Repository and browser instructions for Codex |

## Work with Codex

Install the official OpenAI Codex VS Code extension, sign in and open this repository root. See [the Codex workflow](docs/codex.md).

Next: validate the saved-story workspace, then build the deterministic device-scenario harness (F3) and remaining feedback/account/support services (F4). Scoring evaluation (F5) can proceed in parallel. Hardware qualification is a later, separate gate before real story playback. See the [software-first roadmap](docs/beta-roadmap.md); keep mocked, browser and physical evidence separate. Supply any later device credentials through local configuration, never chat or committed files.

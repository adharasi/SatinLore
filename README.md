# SatinLore

A browser-first reading workspace for synchronising users' text with a supported Lovense device. The current build contains a **private hosted simulator, a deterministic transport lab and a separate local device-check screen**.

## Current status

Implemented: a **NovelAI-inspired saved-story reading workspace** with Satin Editorial light, Midnight Ink dark and System appearance. A collapsible, searchable and sortable library plus open-story tabs bring TXT/pasted stories straight into continuous reading, with background local analysis and optional corrections. Portable local backups restore fresh, session-only copies; explicit browser saving is still required. Reader and Story settings, word/progress statistics, remembered presentation choices and keyboard shortcuts support the workspace. Wide/Comfortable/Full widths, focus mode and optional settings preserve your place. Explicit local saving retains opted-in stories and progress; session-only remains the default. Persistent strength −/+, confirmed Start/ceiling and Pause/Stop control the bounded simulator. One-use invitations and expiring sessions support a separate authenticated device-check screen.

The reader still drives the simulator only. Real-device behaviour and the vendor connection need qualification with your credentials and hardware. Suggestion quality needs user evaluation. Story-to-real-device playback and algorithm qualification remain outstanding. The hosted app now has real private feedback, feedback export/deletion and help; this does not delete a Cloudflare identity or change the separate marketing waitlist. The standalone Python invitation backend remains a separate local device-testing service. A separate Cloudflare adapter packages the private simulator workspace for founder-only hosting; it does not expose the local invitation/vendor backend. Unsaved stories clear on reload. **Save on this browser** stores a story locally by choice; it is visible to others using that browser and is not cloud sync or a backup. Reopening always stays paused with strength reset. Delete one/all removes retained story data; appearance is separate. Hardware is not required to continue the software-beta roadmap.

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

## Private hosted workspace

The requested `app.satinlore.com` deployment uses the same reader and local story processing behind Cloudflare Access. Its Worker validates a dedicated Access application's signed token before serving **every** reader asset. Missing configuration fails closed; direct Worker and preview hostnames are disabled. Access expiry or failed revalidation pauses the simulator, blocks Start and leaves the current text readable.

The reader explains why Start is unavailable, provides a nearby sign-in retry and supports repeated Start/Stop/reconnect without restoring an armed session. A synchronous access-check failure no longer leaves retries stuck.

This is a private **simulator preview**. It does not claim qualified physical-device playback, a validated intensity algorithm, cloud story storage or account sync. The Python invitation/device-check backend stays local and is excluded from the hosted build. The one-time browser setup connects this GitHub repository to Cloudflare for automatic deployment on future pushes. Access settings remain in the Cloudflare dashboard and survive those deployments. See [the Cloudflare deployment runbook](deploy/cloudflare/README.md) for the exact setup, checks and rollback; source publication alone does not establish a live, protected deployment.

Useful hosted pages: `/help` for controls/privacy/build information, `/support` for private feedback and feedback data, and `/simulator-lab` for the founder's repeatable failure scenarios. Help opens separately so session-only reader text remains in the original tab.

![Satin Editorial private-reader preview with neutral sample text](docs/images/private-reader-desktop.jpg)

## Run checks

Install the pinned JavaScript dependencies once with `npm ci --ignore-scripts` before running the common checks. These include the private Worker's token-verification tests; the browser reader itself remains build-free.

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

Next: use the simulator lab and workspace checks to finish software acceptance with real readers, then evaluate the intensity algorithm (F5) against suitable material. The F3 harness and hosted feedback/support/data journeys are implemented; broadening founder-only access to invited beta readers remains an explicit release task. Hardware qualification is a later, separate gate before real story playback. See the [software-first roadmap](docs/beta-roadmap.md); keep mocked, browser and physical evidence separate. Supply any later device credentials through local configuration, never chat or committed files.

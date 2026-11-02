# SatinLore

A browser-first reading workspace for synchronising users' text with a supported Lovense device. The current build contains a **private hosted simulator, a deterministic transport lab and a separate local device-check screen**.

## Current status

The **NovelAI-inspired reader** uses Satin Editorial light, Midnight Ink dark and System appearance. Type or paste directly onto a blank story page, or use the right sidebar to upload text/AO3 HTML or request a supported AO3 link import. Literotica and other sites have a source-page/copy/upload fallback. A compact library has title search, sorting, folders and open-story tabs; the right sidebar holds the current story's controls, optional corrections and model choice. A top-right Dark mode switch moves directly between Satin Editorial and Midnight Ink. The gear retains the System/Light/Dark choice alongside account status, backup/restore, about, help and support; its Close button and top-right × return to the reader.

Guided simulator setup offers a neutral practice read before personal stories. An actual-output graphic/trace shows simulated changes as you read. Persistent strength −/+, a direct maximum slider and confirmed Start/Pause/Stop control the bounded simulator; maximum changes have no second popup. A stronger custom model and multi-toy/dual-area support are labelled future work. Account-linked login and cloud story storage are backlogged for testing; there is no paid tier or account-sync implementation.

Explicit browser saving retains opted-in stories, corrections, progress and folder membership; session-only remains the default. Folder creation/rename/deletion is an explicit local metadata action. Backups restore fresh session-only stories into Unfiled and cannot arm playback. One-use invitations and expiring sessions remain available on the separate local device-check screen.

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

The private `app.satinlore.com` deployment uses the same reader and local story processing behind Cloudflare Access. The 1 November deployment and signed-in checks are recorded in the roadmap; each later release needs its own acceptance evidence. Its Worker validates a dedicated Access application's signed token before serving **every** reader asset. Missing configuration fails closed; direct Worker and preview hostnames are disabled. Access expiry or failed revalidation pauses the simulator, blocks Start and leaves the current text readable.

The reader explains why Start is unavailable, provides a nearby sign-in retry and supports repeated Start/Stop/reconnect without restoring an armed session. A synchronous access-check failure no longer leaves retries stuck.

This is a private **simulator preview**. It does not claim qualified physical-device playback, a validated intensity algorithm, cloud story storage or account sync. The Python invitation/device-check backend stays local and is excluded from the hosted build. The one-time browser setup connects this GitHub repository to Cloudflare for automatic deployment on future pushes. Access settings remain in the Cloudflare dashboard and survive those deployments. See [the Cloudflare deployment runbook](deploy/cloudflare/README.md) for the exact setup, checks and rollback; source publication alone does not establish a live, protected deployment.

Useful hosted pages: `/help` for controls/privacy/build information, `/support` for private feedback and feedback data, and `/simulator-lab` for the founder's repeatable failure scenarios. Open these from the global gear menu; they open separately so session-only reader text remains in its original tab. Deliberate AO3 link import uses the authenticated `/api/story-import` service, temporarily fetching/extracting the requested public source without server retention or forwarding browser credentials; local drafts/uploads/saved stories are not automatically uploaded.

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
| `app/static/reader/` | Local/direct and supported-link import, folders/storage, background analysis, optional corrections, position, guided setup and simulator visualisation |
| `app/static/devices/` | Device adapters and testable control logic |
| `app/static/device-check.*`, `device-bridge.*` | Separate hardware check and sandboxed vendor SDK bridge |
| `app/static/playback/` | Simulator playback state, cadence, ceiling and interruption control |
| `scripts/create_invite.py` | Local one-use invitation issuance |
| `tests/`, `scripts/check.py` | Automated checks and their common entry point |
| `docs/`, `deploy/` | Scope, roadmap, QA, setup and deployment planning |
| `AGENTS.md`, `app/static/AGENTS.md` | Repository and browser instructions for Codex |

## Work with Codex

Install the official OpenAI Codex VS Code extension, sign in and open this repository root. See [the Codex workflow](docs/codex.md).

Next: complete the new editor/import/folder/setup acceptance checks with real readers, then evaluate the intensity algorithm (F5) against suitable material. Durable accounts/cloud story sync and the custom model/paid entitlements are future milestones, not working features hidden behind the current selector. The F3 harness and hosted feedback/support/data journeys are implemented; broadening founder-only access to invited beta readers remains an explicit release task. Hardware qualification is a later, separate gate before real story playback. See the [software-first roadmap](docs/beta-roadmap.md); keep mocked, browser and physical evidence separate. Supply any later device credentials through local configuration, never chat or committed files.

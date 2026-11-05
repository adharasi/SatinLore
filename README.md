# SatinLore

A private browser reader that turns a person's chosen story into changing controls for a compatible Lovense toy. The app has hardware-free simulators, verified email and password accounts, an opt-in account library, saved toy presets and a guided calibration-to-reading flow. Physical-device qualification remains separate from software implementation.

**For 3 November testing:** start with the [founder and tester session runbook](docs/beta-session-2026-11-03.md). It covers the remaining Cloudflare hostname/allowlist steps, account creation, the simulator rehearsal, live checks, personal-range permission, controlled stories and the private recording admin.

**Public reader rollout:** use the [email sign-in activation checklist](deploy/cloudflare/public-reader.md) to verify delivery and open the app hostname. The beta and Alpha workflows keep their existing authentication. See the [onboarding walkthrough and UX review](docs/public-reader-ux-review.md) for the next usability improvements.

## Current experience

The NovelAI-inspired reader opens in Midnight Ink for new visitors, with Satin Editorial and System appearance choices, a collapsible library, a continuous reading canvas and a right settings sidebar. Type/paste, upload and supported AO3 link import remain separate choices. Analysis suggests intensity, rhythm and movement by section. When it finds reliable movement cues, it lists matching toy models above the story. Review is optional. The dock changes the current section target one level at a time, and the maximum slider applies directly.

**Loom** is the default story model. The optional **Nocturne** private beta adds GPT-6 Luna classification of up to 16 locally derived scene cues on explicit request. It selects from local simulator shapes, including a sustained crest and a rolling wave. Nocturne requests contain scene cues and exclude story text and device settings. Loom covers excluded sections and service failures. [Enable and verify Nocturne](deploy/cloudflare/README.md#enable-nocturne-for-the-private-beta)

Public readers create an account with an email and password, confirm 18+, verify their address and then sign in. Password reset requires a code sent to the verified inbox. The private beta still uses its existing Cloudflare Access login. Named account-wide and story-specific presets retain per-movement minimum, background, preferred, maximum, recovery, rhythm and gain, plus selected active movements and master maximum. Applying them always pauses. New stories are session-only. **Save on this browser** keeps them local. **Save to my account** sends the selected story and reading details to the signed-in account library for access from another browser. Browser shelves remain local. Public account reading settings sync separately from the story.

The public reader asks four optional questions after sign-in about quiet passages, edging, maximum intensity and rhythm. In **Settings → Device preferences**, choose **Preview onboarding** to rehearse the questions with fresh defaults, or **Edit device preferences** to apply changes. Nocturne uses those choices to shape quiet passages, build-ups and climaxes in the simulator. **Reading controls → Advanced → Nocturne patterns** lets readers choose build-up and climax patterns independently. Saving preferences keeps playback paused and does not grant a higher physical range.

Setup offers 33 [Lovense model and family profiles](docs/lovense-compatibility.md). The main hosted reader uses three steps: pair, run a quick check and open Advanced controls. Choose the device explicitly, then check its available movements on one screen. Movements are selected together where the connection supports them. The detailed calibration controls remain available when wanted, and the beta host retains its existing test workflow.

Live control uses an isolated Lovense Remote bridge. The documented Standard Socket adapter can expose Oscillate and qualified combined actions; its narrower Standard JS fallback does not invent these capabilities. Heating and undocumented independent vibration motors are not implemented. All nonzero requests remain finite at two seconds. Initial gentle checks and unqualified actions are capped at 5/20. After checking a movement's response and targeted Stop, an explicit Enable personal range choice may permit up to 20/20 for that connection. It does not raise the chosen maximum or start output. Presets cannot grant permission; hide, expiry, disconnect and device changes reset it. Lower limits, manual zero and Stop remain authoritative.

The same private reader is packaged for app.satinlore.com and beta.satinlore.com. Only the exact beta host offers an explicit recording choice. Its structured control timeline captures allowed steps, settings changes, requested/simulated channel output, optional ratings, normalized navigation and fixed controlled-story identifiers. It does not capture DOM/screen video, story text/title, typed preset names, private URLs or pairing/credential material. Founder-only beta.satinlore.com/admin provides the timeline, channel graphs and review controls. Each recording is bounded to one hour, 20,000 events and 4 MiB; retained data expires after 30 days within a 128 MiB global budget. Recording controls are independent of device Stop.

The marketing website, CRM, SES and questionnaire bridge remain separate. The local Python invitation/device-check service also remains separate and retains its discrete low-level contract. Generated stories, billing, other toy brands and multiple physical toys remain outside this iteration. No physical toy or full Lovense Remote feature parity is claimed from simulator results.

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

The `app.satinlore.com` deployment uses the same reader and local story processing. In private mode the Worker requires a signed Cloudflare Access token. With public email sign-in enabled, guests can read and rehearse with the simulator. A verified account is required for live pairing, Nocturne, link imports, saved presets and feedback. Direct Worker and preview hostnames are disabled. Session expiry or failed revalidation pauses playback and tears down a live connection while leaving the current text readable.

The reader explains why Start is unavailable, provides a nearby sign-in retry and supports repeated Start/Stop/reconnect without restoring an armed session. A synchronous access-check failure no longer leaves retries stuck.

This is a private **software beta** with hardware-free simulation, explicit account/preset persistence and a configured Lovense route. Physical-device playback and the intensity algorithm still need qualification. The Python invitation/device-check backend stays local and is excluded from the hosted build. The one-time browser setup connects this GitHub repository to Cloudflare for automatic deployment on future pushes. Access settings remain in the Cloudflare dashboard and survive those deployments. See [the Cloudflare deployment runbook](deploy/cloudflare/README.md) for the exact setup, checks and rollback; source publication alone does not establish a live, protected deployment.

Useful hosted pages include `/help` for controls and privacy, `/support` for feedback and your submitted notes, and `/simulator-lab` for repeatable failure scenarios. The header Feedback link opens a separate tab so the reader stays in place. The founder inbox is on `beta.satinlore.com/feedback-admin`. A deliberate AO3 link import uses the authenticated `/api/story-import` service to fetch the requested public source without retaining it or forwarding browser credentials. Local drafts and uploads stay on the device unless the reader explicitly saves them to an account.

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
| `app/static/devices/` | Lovense profiles and simulators, SDK/bridge transport and reader device control |
| `app/static/device-check.*`, `device-bridge.*` | Separate hardware check and sandboxed vendor SDK bridge |
| `app/static/playback/` | Synchronous simulation and asynchronous targeted playback, cadence, ceiling and interruption control |
| `scripts/create_invite.py` | Local one-use invitation issuance |
| `tests/`, `scripts/check.py` | Automated checks and their common entry point |
| `docs/`, `deploy/` | Scope, roadmap, QA, setup and deployment planning |
| `AGENTS.md`, `app/static/AGENTS.md` | Repository and browser instructions for Codex |

## Work with Codex

Install the official OpenAI Codex VS Code extension, sign in and open this repository root. See [the Codex workflow](docs/codex.md).

Next: complete the account, preset, guided calibration, combined-control and recording acceptance checks with real readers, then evaluate the intensity algorithm (F5) against suitable material. Cloud story storage and custom model/paid entitlements remain future milestones. The F3 harness and hosted feedback/support/data journeys are implemented; invited-beta access requires explicit tester configuration in both Access layers. The bounded live route is for controlled qualification; wider hardware support requires observed per-model results. See the [software-first roadmap](docs/beta-roadmap.md); keep mocked, browser and physical evidence separate. Supply hosted device credentials through private runtime configuration (or local process variables for the separate Python service), never chat or committed files.

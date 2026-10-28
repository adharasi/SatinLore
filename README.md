# SatinLore

A browser-first reader for synchronising users' text with a supported Lovense device. Currently a **local simulator scaffold**.

## Current status

Working: TXT/paste, paragraph navigation, manual levels, simulator, ceiling and Stop/Pause. Text stays in page memory and clears on reload.

Not implemented: real pairing, authentication, scoring, scroll tracking, persistence, feedback or deployment. The Lovense session endpoint returns HTTP 501. Automated tests do not certify physical devices.

Read the [specification](docs/development-spec.md) and [roadmap](docs/beta-roadmap.md) for scope and next steps.

## Quick start

Install Python 3.12+, Git and VS Code; Node.js 24 for JavaScript checks. Simulator mode needs no hardware or credentials.

Clone and open the repository:

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

Open <http://127.0.0.1:8000>; Ctrl+C stops the server. Bootstrap installs dependencies into `.venv` using internet access. Select that VS Code interpreter with **Python: Select Interpreter**.

## Run checks

```powershell
# Windows
py scripts/check.py
```

```sh
# macOS/Linux
python3 scripts/check.py
```

Use the [QA checklist](docs/qa.md) for browser and physical-device evidence; simulator tests cannot prove hardware behaviour.

## Repository map

| Path | Purpose |
| --- | --- |
| `app/main.py`, `app/api/` | FastAPI assembly, health route and disabled real-session route |
| `app/core/` | Application configuration |
| `app/services/`, `app/db/` | Boundaries for future authenticated services and SQLite persistence |
| `app/static/reader/` | Local text import and future scoring/position modules |
| `app/static/devices/` | Simulator; future real adapter belongs here |
| `app/static/playback/` | Future playback controller boundary |
| `tests/`, `scripts/check.py` | Automated checks and their common entry point |
| `docs/` | Technical scope, roadmap, QA and Codex workflow |
| `deploy/` | Deployment planning; not a live environment |
| `AGENTS.md`, `app/static/AGENTS.md` | Repository and browser-code instructions for Codex |

## Work with Codex

Install the official OpenAI Codex VS Code extension, sign in and open this repository root. See [the Codex workflow](docs/codex.md).

Next milestone: implement authenticated, per-user Lovense session issuance and one explicitly selected device's bounded test command and Stop, while retaining simulator mode. See the roadmap for prerequisites and acceptance criteria. Provide credentials through local configuration, never chat or committed files.

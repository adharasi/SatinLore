# Developing with Codex

Open the repository root in VS Code, install OpenAI's Codex extension, sign in and select `.venv` for Python.

Codex recognises root `AGENTS.md` and applicable directory instructions. `app/static/AGENTS.md` adds browser-specific constraints. `README.md` and `docs/` are ordinary context files referenced by those instructions, not automatically installed skills or agent configurations. See [official instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

Start with a focused task:

> Read AGENTS.md, README.md, docs/development-spec.md and docs/beta-roadmap.md. Run the existing checks. Implement milestone 1: authenticated per-user Lovense session issuance, explicit device selection, a bounded low-intensity test command and Stop. Keep simulator mode. Supply secrets through local configuration, never chat. Report changed behaviour, tests and the checks still requiring my physical device.

Name the behaviour and acceptance criteria for each task. Keep milestones reviewable and make Git checkpoints around meaningful changes.

Update milestone status and test evidence. Distinguish mock results, unexecuted tests and physical observations. Extra approval ceremonies or agent configuration are unnecessary.

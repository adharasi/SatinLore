# Developing with Codex

Open the repository root in VS Code, install OpenAI's Codex extension, sign in and select `.venv` for Python.

Codex recognises root `AGENTS.md` and applicable directory instructions. `app/static/AGENTS.md` adds browser-specific constraints. `README.md` and `docs/` are ordinary context files referenced by those instructions, not automatically installed skills or agent configurations. See [official instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

For the next implementation milestone:

> Read AGENTS.md, README.md, docs/development-spec.md and docs/beta-roadmap.md. Run the existing checks. Implement the reading-loop milestone: experimental local paragraph scoring, manual corrections, a stable reading anchor and coalesced simulator playback with an authoritative ceiling and explicit Start. Preserve the separate authenticated device-check flow and SDK isolation. Report changed behaviour, tests and remaining browser/hardware qualification. Do not claim real story playback works before the physical checks pass.

For device qualification, follow `docs/hardware-check.md` with your own device and locally configured credentials. Codex can inspect contracts, automate browser checks and analyse redacted observations; it cannot infer physical output from a mock or API response.

Name the behaviour and acceptance criteria for each task. Keep milestones reviewable and make Git checkpoints around meaningful changes. Update the roadmap and QA evidence after each milestone. Extra approval ceremonies or agent configuration are unnecessary.

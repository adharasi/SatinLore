# Developing with Codex

Open the repository root in VS Code, install OpenAI's Codex extension, sign in and select `.venv` for Python.

Codex recognises root `AGENTS.md` and applicable directory instructions. `app/static/AGENTS.md` adds browser-specific constraints. `README.md` and `docs/` are ordinary context files referenced by those instructions, not automatically installed skills or agent configurations. See [official instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

For Nocturne Luna discrepancy closure, use the [VS Code handoff and copy-ready prompt](nocturne-vscode-handoff.md). It starts from the approved corpus protocol and exact v47 development baseline.

For general reader and control work:

> Read AGENTS.md, README.md, docs/frontend-design.md, docs/test-today.md and the current roadmap/evidence ledger. Run the existing checks and reproduce the reported failure with neutral fixtures. Preserve the approved v1.2 workspace: direct reading, optional review, explicit local-save consent, paused restoration, semantic themes and simulator-only playback. Keep background-analysis cancellation, zero overrides, bounded session strength, confirmed Start/ceiling and interruption rules. Fix the smallest supported issue, update relevant tests and record the evidence without claiming physical behaviour.

Use the [roadmap](beta-roadmap.md) to select a current milestone. The deterministic device harness and feedback workflow have their own checks. Nocturne compiler and fixed-answer regression checks run locally without hardware or paid AI service.

After hardware qualification, a later integration milestone is connecting the reader controller to the qualified isolated bridge. Keep simulator mode and the separate device-check screen. Do not enable continuous real playback merely because unit or fake-SDK tests pass.

For device qualification, follow `docs/hardware-check.md` with your own device and locally configured credentials. Codex can inspect contracts, automate browser checks and analyse redacted observations; it cannot infer physical output from a mock or API response.

Name the behaviour and acceptance criteria for each task. Keep milestones reviewable and make Git checkpoints around meaningful changes. Update the roadmap and QA evidence after each milestone. Extra approval ceremonies or agent configuration are unnecessary.

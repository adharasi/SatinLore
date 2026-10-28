# Developing with Codex

Open the repository root in VS Code, install OpenAI's Codex extension, sign in and select `.venv` for Python.

Codex recognises root `AGENTS.md` and applicable directory instructions. `app/static/AGENTS.md` adds browser-specific constraints. `README.md` and `docs/` are ordinary context files referenced by those instructions, not automatically installed skills or agent configurations. See [official instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

For today's validation work:

> Read AGENTS.md, README.md, docs/frontend-design.md, docs/test-today.md and the current roadmap/evidence ledger. Run the existing checks and reproduce the reported failure with neutral fixtures. Preserve the approved semantic themes, Add/Review/Read journey, appearance-only preference, simulator-only reader, local text boundary, explicit Start, zero overrides and interruption rules. Fix the smallest supported issue, update relevant tests and record the evidence without claiming physical behaviour.

The next software milestone is F3: a deterministic device-scenario harness with explicit failure/unknown-output states and a deliberate asynchronous adapter contract. Follow F4 for remaining local persistence, feedback/account and support journeys; F5 scoring evaluation can proceed in parallel. No hardware or paid AI service is required to continue this work.

After hardware qualification, a later integration milestone is connecting the reader controller to the qualified isolated bridge. Keep simulator mode and the separate device-check screen. Do not enable continuous real playback merely because unit or fake-SDK tests pass.

For device qualification, follow `docs/hardware-check.md` with your own device and locally configured credentials. Codex can inspect contracts, automate browser checks and analyse redacted observations; it cannot infer physical output from a mock or API response.

Name the behaviour and acceptance criteria for each task. Keep milestones reviewable and make Git checkpoints around meaningful changes. Update the roadmap and QA evidence after each milestone. Extra approval ceremonies or agent configuration are unnecessary.

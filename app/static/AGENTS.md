# Browser-code instructions

These supplement the repository-root `AGENTS.md` for this directory.

- Use browser ES modules and existing DOM controls; keep the starter build-free.
- Keep new stories session-only until explicit Save on this browser. Use the bounded versioned story store for opted-in text, title, corrections, analysis version and progress; keep `satinlore.appearance` (`system`, `light`, `dark`) separate. Never persist strength, ceiling, playback arming or credentials. Save/delete status must reflect actual storage outcomes; failures keep the in-memory story readable.
- Follow `docs/frontend-design.md`: shared semantic themes, pre-paint theme resolution, native colour-scheme and continuous document scrolling. Preserve the selected paragraph and pause on appearance/reflow changes.
- Open added/reopened text directly into the continuous reader. Analysis runs locally in the background; Start needs a valid mapping, but review is optional. Optional review defaults to current/already-read sections; future sections need deliberate reveal.
- Story switching, deletion, hide and interruption cancel pending Start and stale work. Restoration is always paused, with strength reset. Preserve corrections during reanalysis and fail invalid/unanalysed sections to zero.
- Start displays the chosen ceiling and requires confirmation. Lowering the ceiling applies immediately; a raise requires separate explicit confirmation. Keep Stop operable in every dialog/panel, without confirmation.
- Render imported strings with `textContent`; do not use `innerHTML` for stories.
- Never send story text, titles or excerpts to backend, vendor, analytics or error services.
- Keep third-party scripts off the reader page. Load the vendor SDK only in the dedicated sandboxed bridge without `allow-same-origin`.
- Transfer only connection/control messages through the bridge port. Check the parent source/origin on setup; validate message shapes, device IDs, expiry and bounds inside the bridge.
- Never persist invitation, CSRF or vendor tokens in browser storage or URLs. Revalidate the application session and tear down control on expiry/logout.
- Separate position, automatic suggestion, nullable manual override, session multiplier, confirmed ceiling and dispatch. Zero is an intentional override. Multiply the section base by bounded session strength, round down to a whole device level and cap it; never rewrite the stored correction.
- Preserve stable paragraph IDs within a loaded story, bounded imports and settled position tracking. Layout changes must not cause automatic playback.
- Preserve explicit Start and selected-device targeting. Stop must remain easy to reach.
- Coalesce changes to the newest desired level; never replay a backlog after scrolling or reconnecting.
- Stop dispatch when hidden or disconnected; returning to the page must stay paused.
- The hardware-check command is two seconds at most 5/20, explicitly targeted. Keep physical expiry separate from the UI timer; the simulator reading controller does not qualify continuous physical playback.
- Mock expiry and UI state are not evidence that physical output stopped.
- Add tests for meaningful controller failures and run the repository check command after changes.

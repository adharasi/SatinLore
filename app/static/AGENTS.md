# Browser-code instructions

These supplement the repository-root `AGENTS.md` for this directory.

- Use browser ES modules and existing DOM controls. The reader remains build-free; the hosted device bridge is bundled into its protected HTML so an opaque frame does not need unauthenticated module access.
- Keep new stories session-only until explicit Save on this browser. Use the bounded versioned story store for opted-in text, title, corrections, analysis version and progress; keep `satinlore.appearance` (`system`, `light`, `dark`) separate. Never persist strength, ceiling, playback arming or credentials. Save/delete status must reflect actual storage outcomes; failures keep the in-memory story readable.
- Follow `docs/frontend-design.md`: shared semantic themes, pre-paint theme resolution, native colour-scheme and continuous document scrolling. Preserve the selected paragraph and pause on appearance/reflow changes.
- Open added/reopened text directly into the continuous reader. Analysis runs locally in the background; Start needs a valid mapping, but review is optional. Optional review defaults to current/already-read sections; future sections need deliberate reveal.
- Story switching, deletion, hide and interruption cancel pending Start and stale work. Restoration is always paused, with strength reset. Preserve corrections during reanalysis and fail invalid/unanalysed sections to zero.
- Start displays the chosen ceiling and requires confirmation. In the ordinary synchronous reader simulator, direct maximum-slider input updates the chosen ceiling without a popup, pausing, or automatic restart; lower/zero values apply immediately. This user-requested change supersedes the older separate-raise popup for this reader only. Preserve the async lab and hardware-check contracts. Keep Stop operable in playback confirmation and setup dialogs/panels, without confirmation. The global settings popup pauses before opening and uses Close plus a top-right ×; do not label its dismissal Stop.
- Render imported strings with `textContent`; do not use `innerHTML` for stories. Local HTML imports must extract text without executing scripts or loading remote resources.
- Never upload local drafts, story text, titles or excerpts to backend, vendor, analytics or error services. A deliberate supported-URL import may send its source URL to the authenticated import service for bounded public-page fetching/extraction, with no credentials or server retention; explain that boundary and leave blocked/unsupported sites on a copy/download fallback.
- Keep third-party scripts off the reader page. Load the vendor SDK only in the dedicated sandboxed bridge without `allow-same-origin`.
- Transfer only connection/control messages through the bridge port. Check the parent source/origin on setup; validate message shapes, device IDs, expiry and bounds inside the bridge.
- Never persist invitation, CSRF or vendor tokens in browser storage or URLs. Revalidate the application session and tear down control on expiry/logout.
- Separate position, automatic suggestion, nullable manual override, session multiplier, confirmed ceiling and dispatch. Zero is an intentional override. Multiply the section base by bounded session strength, round down to a whole device level and cap it; never rewrite the stored correction.
- Preserve stable paragraph IDs within a loaded story, bounded imports and settled position tracking. Layout changes must not cause automatic playback.
- Preserve explicit Start and selected-device targeting. Stop must remain easy to reach.
- Coalesce changes to the newest desired level; never replay a backlog after scrolling or reconnecting.
- Stop dispatch when hidden or disconnected; returning to the page must stay paused.
- Every hardware-check and physical reader command is two seconds at most 5/20, explicitly targeted. Keep physical expiry separate from the UI timer and SDK acceptance. Use the asynchronous reader transport for real hardware, never the synchronous simulator controller. Simulate all nine requested profiles separately; derive live actions from validated discovered capabilities rather than the selected product illustration.
- Mock expiry and UI state are not evidence that physical output stopped.
- Add tests for meaningful controller failures and run the repository check command after changes.

- Separate current-reader controls in the right sidebar from global gear-menu settings: appearance, account status, backup, about, help and support. Keep Midnight Ink available through System/Light/Dark and the direct header Dark mode switch; synchronise the switch to the resolved theme.
- Folder actions are explicit local-library metadata operations; moving an unsaved story must not silently save its text. Restore stays paused.
- Simulator graphics must represent actual simulator output, including zero when paused/disconnected, and honour reduced motion. Guided setup/practice must not silently connect, select a device, start output or claim a real toy is configured. Keep Simulate and Connect my toy distinct, provide the Lovense Remote pairing steps and require a checked short test before practice. QR/auth material is private and must not enter screenshots, persistence or diagnostics.

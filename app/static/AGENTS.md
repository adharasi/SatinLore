# Browser-code instructions

These supplement the repository-root `AGENTS.md` for this directory.

- Use browser ES modules and existing DOM controls; keep the starter build-free.
- Keep text in browser memory unless the user explicitly opts into local persistence. Only allowlisted `satinlore.appearance` (`system`, `light`, `dark`) may persist in this phase; do not put story/account data in preferences.
- Follow `docs/frontend-design.md`: shared semantic themes, pre-paint theme resolution, native colour-scheme and continuous document scrolling. Preserve the selected paragraph and pause on appearance/reflow changes.
- Keep Add/Review/Read transitions explicit. Leaving Read cancels pending Start and pauses output; returning never resumes automatically. Confirm a valid story replacement before discarding corrections, and invalidate delayed import callbacks on clear/navigation/hide.
- Render imported strings with `textContent`; do not use `innerHTML` for stories.
- Never send story text, titles or excerpts to backend, vendor, analytics or error services.
- Keep third-party scripts off the reader page. Load the vendor SDK only in the dedicated sandboxed bridge without `allow-same-origin`.
- Transfer only connection/control messages through the bridge port. Check the parent source/origin on setup; validate message shapes, device IDs, expiry and bounds inside the bridge.
- Never persist invitation, CSRF or vendor tokens in browser storage or URLs. Revalidate the application session and tear down control on expiry/logout.
- Separate reading position, desired level, user ceiling and adapter dispatch. The ceiling always wins. Keep predictions separate from nullable manual overrides; zero is an intentional override.
- Preserve stable paragraph IDs within a loaded story, bounded imports and settled position tracking. Layout changes must not cause automatic playback.
- Preserve explicit Start and selected-device targeting. Stop must remain easy to reach.
- Coalesce changes to the newest desired level; never replay a backlog after scrolling or reconnecting.
- Stop dispatch when hidden or disconnected; returning to the page must stay paused.
- The hardware-check command is two seconds at most 5/20, explicitly targeted. Keep physical expiry separate from the UI timer; the simulator reading controller does not qualify continuous physical playback.
- Mock expiry and UI state are not evidence that physical output stopped.
- Add tests for meaningful controller failures and run the repository check command after changes.

# Frontend design and acceptance checks

Decision record: 29 October 2026, product owner Hammad, **SatinLore frontend implementation specification v1.2**. Keep **Satin Editorial** and **Midnight Ink**, but replace the compulsory Add → Review → Read sequence with a saved-story workspace. Quiet Form remains reference-only. The current output suggestion map stays **0, 1, 2, 3 and 5/20**; visual examples never authorise stronger defaults.

The workspace opens a story directly into one continuous reading canvas. A collapsible left library and optional right settings panel support reading; neither review nor a settings screen is a compulsory step. The deterministic F3 lab and hosted F4 feedback/support service are implemented. F5/F6 scoring/usability evaluation and H1/H2 physical qualification remain separate. The marketing waitlist is a separate application.

## Reader refinement — 2 November 2026

The current product direction follows NovelAI's dense library/editor pattern while retaining SatinLore's colours and continuous document scrolling. A blank page offers a title field and a directly typable story area; pasting does not require a modal or a separate review stage. Upload and supported-site link import remain separate, discoverable actions in the right reading sidebar. Copy speaks about stories, reading and controls, rather than file-extension jargon or a “workspace” introduction.

The compact left library contains story tabs, title search, sort and folders. The right **Reading controls** panel contains the active story's import, Reader/Story settings, model choice, optional intensity review, and simulator/setup controls. The top-right gear opens global **Settings**: appearance, account status, backup/restore, about, help and support. These global items no longer fill the library footer. Account-linked story sync is a clearly labelled backlog item; Cloudflare Access currently protects the founder preview. The model selector exposes the working baseline and labels the stronger custom/multi-toy tier as unavailable future work; it must not simulate a subscription or unsupported hardware capability.

The user explicitly requested that changing the maximum not interrupt reading. A direct slider gesture therefore updates the ordinary reader simulator's chosen maximum without a second popup. Lower/zero limits apply immediately, a raise remains within 0–20 and dispatch cadence, and a paused session stays paused. Start still explicitly confirms the current maximum and strength. This change does not weaken the separate asynchronous lab or hardware-check confirmation/acknowledgement contracts.

The right-side simulator visual uses actual connected/running/output snapshots, rather than guessed story intensity. Movement and a short history trace show changes while reading; paused/disconnected output is zero. Reduced-motion users retain numeric/level feedback without vibration movement. A guided setup flow offers explicit simulator selection/connection, a neutral practice read and adjustment of strength, maximum and scrolling. Its practice coach checks Start, section movement, strength, maximum and Stop/restart actions before claiming the checklist complete; skipping remains available. It can be skipped or repeated; it never silently starts playback, saves text or claims to connect a real toy.

Presentation preferences (width, size, spacing and follow position) remain allowlisted separately from appearance and stories. Portable backups restore fresh, session-only copies to Unfiled without playback arming; local folder IDs are deliberately omitted. Folder creation/renaming/deletion is an explicit local metadata action; moving an unsaved story does not save its text. Layout shortcuts avoid typing targets, and no keyboard shortcut starts output. All current iteration evidence belongs in the roadmap ledger after execution; this design contract is not a test result.

## Shared visual system

Both themes use the same layout and components. Local serif fallbacks serve reading text; a system sans-serif serves controls. No remote font or image service is required. The reading surface has no decorative texture. Spacing and quiet borders provide structure without treating status colour as its only meaning.

| Semantic role | Satin Editorial | Midnight Ink |
| --- | --- | --- |
| Page | `#F6F1E9` | `#18191F` |
| Surface | `#FFFCF8` | `#22232B` |
| Primary text | `#292329` | `#EDE7DF` |
| Secondary text / essential boundary | `#726771` | `#B8B4C1` |
| Primary action / focus | `#542B45` | `#BDB1E3` |
| Text on primary action | `#FFFFFF` | `#24202E` |
| Soft selection | `#EAE0E5` | `#32303E` |
| Decorative separator | `#D9CFD5` | `#494653` |
| Stop / actionable error | `#8A3442` | `#F0ABB6` |

Target at least 4.5:1 contrast for normal text and 3:1 for large text and essential boundaries. The separator is decorative, so inputs and meaningful controls use the stronger boundary token. A token contrast calculation alone is not an accessibility audit. Avoid pulsing backgrounds or motion that moves the reading anchor; respect reduced-motion preference.

The same-origin `appearance.js` runs before styles paint, sets the resolved theme and native colour-scheme, and binds the appearance choice after the DOM is ready. Default **System** follows the OS; explicit **Light** or **Dark** wins until changed. The appearance preference is `satinlore.appearance`, allowlisted to `system`, `light` or `dark`, and kept separate from opted-in stories. Invalid values and unavailable storage must not block use. The preference contains no story data or tokens. Reload clears session-only stories; opted-in stories can reopen paused. Appearance remains independent.

## Workspace and responsive behaviour

| Surface | Behaviour |
| --- | --- |
| Library | New/open, title search/sort, folders and active selection; explicit saved/session-only state; saved stories are real browser data |
| Reading canvas | Direct typing/paste on a blank page; stories open into continuous document scrolling; Wide by default with Comfortable/Full choices |
| Reading controls | Optional right panel, initially closed; import/upload, baseline model, text/width controls, current story actions and optional corrections |
| Global gear menu | Appearance, account status, backup/restore, about, help and support; Stop remains accessible |
| Setup and simulator | Repeatable neutral practice journey; actual-output graphic/trace; explicit connect/Start and honest unavailable hardware state |
| Optional review | Current/already-read sections first; future passages require deliberate reveal; manual zero, reset and reanalysis preserve deliberate edits |
| Persistent transport | Simulator/status, capped target/output, strength −/+/Reset, direct maximum slider and Start/Pause/Stop |
| Start confirmation | Shows selected simulator, strength and maximum; explicit Start-with-maximum action; Stop remains available |

At 1100 px and above, the library can sit left and settings right. The story expands when either closes. Wide has an approximately 900–1040 px maximum; Comfortable is about 620–720 px; Full uses the remaining canvas with gutters. These are maximum widths, never minimum phone widths. **Focus** closes both sidebars and preserves the dock; leaving Focus restores the prior arrangement.

Below desktop width, use drawers or sheets instead of squeezing the reader into three columns. Phone reading starts with both panels closed. Reserve dock/safe-area space so the last paragraph and focused controls remain reachable. Avoid a fixed-height nested story scrollbar. Panel, width, type, theme and viewport changes preserve the selected paragraph and never resume playback.

Use native controls, logical focus order and at least 44 × 44 px primary targets. Escape closes noncritical dialogs/panels and focus returns to the opener. A modal must expose a usable Stop action; nonmodal settings must leave the persistent Stop operable. Status is readable text, not colour alone. No image texture belongs behind story text.

## Functional and privacy boundaries

Local typed/pasted/uploaded text validates UTF-8 and the 500,000-byte / 2,000-paragraph limits, then opens reading immediately. Deliberate supported-link imports use an authenticated, bounded service to fetch and extract a public source; restricted, blocked or unsupported pages offer copy/download fallback rather than a bypass. Local HTML extraction must not execute scripts or load remote resources. Local background scoring shows quiet pending/ready/error status without exposing future text in notifications. Silent reading remains available if analysis fails; Start remains unavailable until the current story has a valid mapping. Stale analysis/import work cannot replace another story or revive a deleted one.

Session strength is visibly bounded at 0.0×–2.0× in 0.1× steps, initially 1.0×. The target is the floored section base × strength, capped by the confirmed ceiling. Manual corrections and suggestions remain separate; zero stays zero. Strength persists across paragraphs and Pause/Stop, and resets on story switch/reload. A deliberate maximum-slider gesture applies directly without a popup; lower/zero limits take priority immediately. Raising the maximum while running remains bounded by cadence and strength; changing it while paused never starts output. Start/resume explicitly confirms the current maximum. Control changes while paused never start output.

**Session only** is the initial choice. **Save on this browser** opts in to retained title/text, corrections, analysis version and progress. Make shared-browser visibility and absence of cloud backup clear. A successful label follows actual storage completion; quota, unavailable or corrupt storage keeps the story readable and reports the failure. Restore is always paused, with no retained strength, ceiling or armed session. Delete one/all removes retained story data. Appearance is separate. Local story text/titles never go to backend, vendor, URLs, analytics or routine logs. The explicit link-import service temporarily fetches/extracts the requested public source and returns text, without storing it or forwarding browser credentials. It does not upload local drafts or saved stories.

## Manual visual and interaction matrix

Use the neutral [sample](test-sample.txt), the [test guide](test-today.md) and exact `git rev-parse --short HEAD`. Record pass/fail/not-tested, browser/version and viewport. Screenshots complement functional checks; they do not prove physical-device or real-phone behaviour.

| Check | Required observation |
| --- | --- |
| Light/Dark, 1440 × 1000 | Library/settings can independently open/close; Wide is the default; Full expands into available space; readable status/focus |
| Light/Dark, 390 × 844 | Closed panels while reading, usable drawers/sheets, persistent −/+/Start/Pause/Stop; last paragraph clears dock |
| 320 CSS px / landscape / 200% text | No horizontal page overflow or hidden Stop; enlarged labels and dialogs fit; controls remain reachable |
| Focus / reading widths | Both sidebars close in Focus and restore on exit; Comfortable/Wide/Full preserve position and stay paused after reflow |
| System and storage denied | System follows OS; explicit Light/Dark wins; blocked preference storage does not stop use |
| Direct reading / analysis | Text opens before analysis completes; no compulsory review; pending/failed mapping cannot Start or inherit old output |
| Optional review | Current/read sections only initially; future reveal is deliberate; manual zero survives reanalysis and story round trips |
| Start / maximum / strength | Start confirms the current maximum; direct slider changes have no popup; + cannot raise the maximum or Start; lower/zero cap immediate |
| Blank editor / imports | Type/paste directly; upload and link actions are distinct; unavailable sites have a practical fallback; cancelled/invalid imports preserve existing stories |
| Folders | Create/rename/delete/filter/move; unsaved text stays session-only; saved membership returns after reload; deletion leaves stories available without a folder |
| Global settings / dark mode | Gear reaches appearance, backup, about/help/support and truthful account status; Midnight Ink applies across dialogs/panels |
| Guided setup / visual | Explicit connect and confirmed Start; practice can be skipped/repeated; graphic matches actual output and reduced-motion setting |
| Save / restore | Only opted-in stories persist; text/title/corrections/position return paused, strength 1.0×; failure shows unsaved state |
| Delete / Session only | Removing persistence deletes retained data; delete one/all is truthful and delayed writes cannot restore deleted stories |
| Keyboard | Logical focus, visible ring, named sliders/buttons, Escape and opener restoration; Stop accessible in modal flows |
| Real phone | Separately inspect keyboard, browser bars, rotation, backgrounding and safe areas; no physical Lovense device needed for this UI check |
| Reduced motion | No pulsing reading background or smooth-scroll dependence; state remains clear without animation |

Automated runs capture neutral workspace screenshots in ignored `artifacts/frontend/`; CI publishes the **frontend-evidence** artifact for 14 days. The [roadmap evidence ledger](beta-roadmap.md#evidence-ledger) records exact commits, browser versions and outcomes.

## Remaining work

F3 has its separate asynchronous scenario harness, and F4 has private hosted feedback/export/deletion and help. Remaining work includes account-linked login/story sync, invited-reader access, the stronger custom model and any paid entitlements, rights-cleared F5 scoring evaluation, F6 wider reader/real-phone acceptance, and later physical qualification. A model dropdown is not an implemented inference model, subscription or multi-device transport.

Requested/acknowledged hardware commands are not measured physical output. Live SDK compatibility, finite physical expiry, interrupted-network behaviour and every advertised device/browser combination remain qualification gates. This reader drives the simulator only.

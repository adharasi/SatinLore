# Frontend design and acceptance checks

Decision record: 29 October 2026, product owner Hammad, **SatinLore frontend implementation specification v1.2**. Keep **Satin Editorial** and **Midnight Ink**, but replace the compulsory Add → Review → Read sequence with a saved-story workspace. Quiet Form remains reference-only. The current output suggestion map stays **0, 1, 2, 3 and 5/20**; visual examples never authorise stronger defaults.

The workspace opens a story directly into one continuous reading canvas. A collapsible left library and optional right settings panel support reading; neither review nor a settings screen is a compulsory step. The deterministic F3 lab and hosted F4 feedback/support service are implemented. F5/F6 scoring/usability evaluation and H1/H2 physical qualification remain separate. The marketing waitlist is a separate application.

## Reader refinement — 2 November 2026

The current product direction follows NovelAI's dense library/editor pattern while retaining SatinLore's colours and continuous document scrolling. A blank page offers a title field and a directly typable story area; pasting does not require a modal or a separate review stage. Upload and supported-site link import remain separate, discoverable actions in the right reading sidebar. Copy speaks about stories, reading and controls, rather than file-extension jargon or a “workspace” introduction.

The compact left library contains story tabs, title search, sort and folders. The right **Reading controls** panel contains the active story's import, Reader/Story settings, model choice, optional intensity review, and simulator/setup controls. The top-right gear opens global **Settings**: appearance, account status, backup/restore, about, help and support. These global items no longer fill the library footer. Cloudflare email OTP plus explicit 18+ registration now backs durable toy presets for invited accounts; story text remains local, not account-synced. The model selector exposes the working baseline and labels the stronger custom/multi-toy tier as unavailable future work; it must not simulate a subscription or unsupported hardware capability.

The user explicitly requested that changing the maximum not interrupt reading. A direct slider gesture therefore updates the ordinary reader simulator's chosen maximum without a second popup. Lower/zero limits apply immediately, a raise remains within 0–20 and dispatch cadence, and a paused session stays paused. Start still explicitly confirms the current maximum and strength. This change does not weaken the separate asynchronous lab or hardware-check confirmation/acknowledgement contracts.

The right-side simulator visual uses actual connected/running/output snapshots, rather than guessed story intensity. Movement and a short history trace show changes while reading; paused/disconnected output is zero. Reduced-motion users retain numeric/level feedback without vibration movement. A guided setup flow offers explicit simulator selection/connection, a neutral practice read and adjustment of strength, maximum and scrolling. Its practice coach checks Start, section movement, strength, maximum and Stop/restart actions before claiming the checklist complete; skipping remains available. It can be skipped or repeated; it never silently starts playback, saves text or claims to connect a real toy.

Presentation preferences (width, size, spacing and follow position) remain allowlisted separately from appearance and stories. Portable backups restore fresh, session-only copies to Unfiled without playback arming; local folder IDs are deliberately omitted. Folder creation/renaming/deletion is an explicit local metadata action; moving an unsaved story does not save its text. Layout shortcuts avoid typing targets, and no keyboard shortcut starts output. All current iteration evidence belongs in the roadmap ledger after execution; this design contract is not a test result.

## Nine-model connection refinement — 2 November 2026

The connection guide offers Lush, Flexer, Nora, Domi, Velvo, Spinel, Dolce, Hush and Osci 3, then a clear Simulate / Connect my toy choice. Simulation follows the same explicit discovery, device selection, action test and practice stages without loading the vendor SDK or making a vendor request. A rehearsal pairing illustration must be labelled simulated and must not be a usable auth code. Live pairing gives short Lovense Remote steps and a private QR code, waits for an eligible discovered device and never selects it automatically. A model illustration is a setup preference, not authority to send a command.

The setup must show loading, unavailable configuration, waiting for Remote/toys, selected, testing, paused, error and retry states honestly. A two-second low test has a clear Stop and requires the reader to check the response/stopped output before practice. Mode, selected toy and available action remain visible in the reader's confirmation/status. Model-specific graphics distinguish simulated output from transport-requested output; neither is described as a physical measurement. Reduced motion retains the model label, action and numeric state. If output is unknown, show unknown rather than a reassuring zero.

Physical output uses finite two-second requests to one selected toy. Initial/default permission is capped at 5/20; after an observed gentle test/Stop and explicit user grant, the selected action may use a session-only personal range up to 20/20. Enabling it does not raise the current ceiling or start output, and presets cannot restore permission. Runtime capabilities restrict motion choices; the Standard JS SDK does not establish independent Dolce motor control or Spinel heating. Live motion not exposed by a connection must remain unavailable even if its simulator can demonstrate it. Opening/closing setup, selecting another device/action, returning from a hidden tab or reconnecting leaves playback paused. Every reading Start is separately confirmed. A missing live configuration offers a clear simulator route instead of a fake connection success.

The reader's model selector for analysis remains separate from the toy profile/action choice. A selected toy motion is not a stronger paid story-analysis model or simultaneous multi-toy control. See [the setup and beta-test guide](lovense-beta-test.md) for exact test boundaries and the owner-side Access/runtime prerequisites.

## Guided calibration and beta refinement

The newer account/calibration scope supersedes the earlier account backlog. After verified email sign-in and explicit 18+ registration, the guide shows the actual connected toy's exposed movements. It explains one movement at a time and progresses through minimum, background, preferred, upper limit and recovery, using visual level indicators and separate short test actions. A slider gesture alone does not send output. Unknown or active output cannot pass the stopped-response check. Optional ratings require a completed checked test; no outcome is required.

Qualified movements can be combined after individual checks. Each keeps its own settings; applying a combination pauses, and Start remains separate. The sidebar re-exposes the movement menu, individual controls, Explore, Hold, Ease off, Follow story and saved presets after setup. Saved account/story presets include selected active actions and master maximum, but cannot arm output or enable the higher personal range. Loading unavailable actions cannot silently invent support.

The initial physical range remains gentle. Enable personal range is a separate explicit action after the checked test and known stopped output. It does not move the maximum slider, start output or persist its permission. The current maximum, including zero, remains authoritative. Ordinary changes stay inline without a popup. User reductions take priority over gradual story-driven increases. Continuous background applies a chosen minimum only during permitted active reading; manual zero remains zero.

Controlled fixtures have authored quiet-zero levels and open paused before personal imports. Optional exploration and ratings should remain approachable: short human labels, one decision at a time, no pressure to complete an intimate outcome. Simulator animation follows actual simulated output; live controls describe requested output and uncertainty, never measured movement.

Only the beta hostname offers a separate recording choice. The notice, Recording/Paused/Saving state, pause/stop/withdrawal and history remain reachable while setup is open. This is a structured control timeline with channel graphs and fixed fixture positions, not a screen/DOM video. Private text, titles, typed preset names and pairing/credential material remain excluded. The normal app host has the same reader without beta collection. See [the session runbook](beta-session-2026-11-03.md) for the full flow and boundaries.

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

The same-origin `appearance.js` runs before styles paint, sets the resolved theme and native colour-scheme, and binds the appearance choice after the DOM is ready. Default **System** follows the OS; explicit **Light** or **Dark** wins until changed. The appearance preference is `satinlore.appearance`, allowlisted to `system`, `light` or `dark`, and kept separate from opted-in stories. Invalid values and unavailable storage must not block use. The preference contains no story data or tokens. Reload clears session-only stories; opted-in stories can reopen paused. Appearance remains independent. A top-right **Dark mode** switch reflects the resolved theme, including System, and chooses an explicit opposite theme when activated. It stays synchronised with the gear select. The gear popup closes with **Close** or its top-right **×**; opening it already pauses playback, and closing it does not restart output.

## Workspace and responsive behaviour

| Surface | Behaviour |
| --- | --- |
| Library | New/open, title search, favourites-first sorting and shelves; the selected card offers edit, favourite, duplicate, local download and delete |
| Reading canvas | Direct typing/paste on a blank page; stories open into continuous document scrolling; Wide by default with Comfortable/Full choices |
| Reading controls | Right panel opens on the first story; import/upload, story model, text/width controls, current story actions and optional corrections |
| Global gear menu | Appearance, account status, backup/restore, about, help and support; Stop remains accessible |
| Setup and device preview | Nine model profiles; separate simulator/Remote journeys; explicit device/action/test/Start; honest unavailable/error/unknown state and neutral practice |
| Optional review | Current/already-read sections first; future passages require deliberate reveal; manual zero, reset and reanalysis preserve deliberate edits |
| Persistent transport | Simulator/status, capped target/output, strength −/+/Reset, direct maximum slider and Start/Pause/Stop |
| Start confirmation | Shows selected simulator, strength and maximum; explicit Start-with-maximum action; Stop remains available |

At 1100 px and above, the library can sit left and settings right. The story expands when either closes. Wide has an approximately 900–1040 px maximum; Comfortable is about 620–720 px; Full uses the remaining canvas with gutters. These are maximum widths, never minimum phone widths. **Focus** closes both sidebars and preserves the dock; leaving Focus restores the prior arrangement.

Below desktop width, use drawers or sheets instead of squeezing the reader into three columns. The first story opens the dismissible reading-controls drawer and leaves the dock available. Closing it keeps it closed for later story switches. Reserve dock/safe-area space so the last paragraph and focused controls remain reachable. Avoid a fixed-height nested story scrollbar. Panel, width, type, theme and viewport changes preserve the selected paragraph and never resume playback.

The selected story's pencil opens **Story settings** for title, description and shelf. The heart toggles the favourite flag. Editing or favouriting a session-only story does not save its text. Duplicate opens a fresh session-only copy with its description, shelf and corrections, starting at the first section. Download creates the portable local JSON backup. Deleting a story uses the same confirmation and local storage handling as the right sidebar.

Use native controls, logical focus order and at least 44 × 44 px primary targets. Escape closes noncritical dialogs/panels and focus returns to the opener. A modal must expose a usable Stop action; nonmodal settings must leave the persistent Stop operable. Status is readable text, not colour alone. No image texture belongs behind story text.

## Functional and privacy boundaries

Local typed/pasted/uploaded text validates UTF-8 and the 500,000-byte / 2,000-paragraph limits, then opens reading immediately. Deliberate supported-link imports use an authenticated, bounded service to fetch and extract a public source; restricted, blocked or unsupported pages offer copy/download fallback rather than a bypass. Local HTML extraction must not execute scripts or load remote resources. Local background scoring shows quiet pending/ready/error status without exposing future text in notifications. Silent reading remains available if analysis fails; Start remains unavailable until the current story has a valid mapping. Stale analysis/import work cannot replace another story or revive a deleted one.

The dock shows the section level with **−** and **+**. Each press changes the target by one whole level within the active limits. The adjustment clears on navigation and is separate from any saved correction. The maximum slider applies directly, and lower limits take priority immediately. Start and resume still require confirmation.

**Session only** is the initial choice. **Save on this browser** opts in to retained title/text, corrections, analysis version and progress. Make shared-browser visibility and absence of cloud backup clear. A successful label follows actual storage completion; quota, unavailable or corrupt storage keeps the story readable and reports the failure. Restore is always paused, with no retained strength, ceiling or armed session. Delete one/all removes retained story data. Appearance is separate. Local story text/titles never go to backend, vendor, URLs, analytics or routine logs. The explicit link-import service temporarily fetches/extracts the requested public source and returns text, without storing it or forwarding browser credentials. It does not upload local drafts or saved stories.

## Manual visual and interaction matrix

Use the neutral [sample](test-sample.txt), the [test guide](test-today.md) and exact `git rev-parse --short HEAD`. Record pass/fail/not-tested, browser/version and viewport. Screenshots complement functional checks; they do not prove physical-device or real-phone behaviour.

| Check | Required observation |
| --- | --- |
| Light/Dark, 1440 × 1000 | Library/settings can independently open/close; Wide is the default; Full expands into available space; readable status/focus |
| Light/Dark, 390 × 844 | Dismissible reading-controls drawer on the first story, persistent −/+/Start/Pause/Stop; last paragraph clears dock |
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

F3 has its separate asynchronous scenario harness, and F4 has private hosted feedback/export/deletion and help. Hosted accounts and account/story settings presets are implemented by the 2 November refinement. Remaining work includes cloud story text sync, owner-configured invited access, the stronger custom model and any paid entitlements, F5 scoring evaluation, F6 wider reader/real-phone acceptance and physical qualification. A model dropdown is not an implemented inference model, subscription or multi-device transport.

Requested/acknowledged hardware commands are not measured physical output. Live SDK compatibility, finite physical expiry, interrupted-network behaviour and every advertised device/browser combination remain qualification gates. The optional live reader route is a separate asynchronous targeted bridge, finite at two seconds, with gentle/default 5/20 and explicit session-only personal-range grants up to 20/20; no model is physically qualified by the UI or simulator.

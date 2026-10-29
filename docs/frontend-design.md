# Frontend design and acceptance checks

Decision record: 29 October 2026, product owner Hammad, **SatinLore frontend implementation specification v1.2**. Keep **Satin Editorial** and **Midnight Ink**, but replace the compulsory Add → Review → Read sequence with a saved-story workspace. Quiet Form remains reference-only. The current output suggestion map stays **0, 1, 2, 3 and 5/20**; visual examples never authorise stronger defaults.

The workspace opens a story directly into one continuous reading canvas. A collapsible left library and optional right settings panel support reading; neither review nor a settings screen is a compulsory step. This local simulator milestone remains separate from deeper F3 device failures, remaining F4 services, F5/F6 evaluation and H1/H2 qualification. The marketing waitlist is a separate application.

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
| Library | New/open, active title, rename and delete; explicit saved/session-only state; saved stories are real browser data |
| Reading canvas | Continuous document scrolling; Wide by default, Comfortable or Full by choice; subtle active-section cue and manual Previous/Next |
| Settings | Optional right panel, initially closed; themes, size/spacing, reading width and optional corrections |
| Optional review | Current/already-read sections first; future passages require deliberate reveal; manual zero, reset and reanalysis preserve deliberate edits |
| Persistent transport | Simulator/status, capped target/output, strength −/+/Reset, confirmed ceiling and Start/Pause/Stop |
| Start confirmation | Shows selected simulator, strength and maximum; explicit Start-with-maximum action; Stop remains available |

At 1100 px and above, the library can sit left and settings right. The story expands when either closes. Wide has an approximately 900–1040 px maximum; Comfortable is about 620–720 px; Full uses the remaining canvas with gutters. These are maximum widths, never minimum phone widths. **Focus** closes both sidebars and preserves the dock; leaving Focus restores the prior arrangement.

Below desktop width, use drawers or sheets instead of squeezing the reader into three columns. Phone reading starts with both panels closed. Reserve dock/safe-area space so the last paragraph and focused controls remain reachable. Avoid a fixed-height nested story scrollbar. Panel, width, type, theme and viewport changes preserve the selected paragraph and never resume playback.

Use native controls, logical focus order and at least 44 × 44 px primary targets. Escape closes noncritical dialogs/panels and focus returns to the opener. A modal must expose a usable Stop action; nonmodal settings must leave the persistent Stop operable. Status is readable text, not colour alone. No image texture belongs behind story text.

## Functional and privacy boundaries

Import validates UTF-8/plain text and the 500,000-byte / 2,000-paragraph limits, then opens reading immediately. Local background scoring shows quiet pending/ready/error status without exposing future text in notifications. Silent reading remains available if analysis fails; Start remains unavailable until the current story has a valid mapping. Stale analysis/import work cannot replace another story or revive a deleted one.

Session strength is visibly bounded at 0.0×–2.0× in 0.1× steps, initially 1.0×. The target is the floored section base × strength, capped by the confirmed ceiling. Manual corrections and suggestions remain separate; zero stays zero. Strength persists across paragraphs and Pause/Stop, and resets on story switch/reload. Lowering the ceiling takes effect immediately; raising it pauses and asks separately. Start/resume explicitly confirms the maximum. Control changes while paused never start output.

**Session only** is the initial choice. **Save on this browser** opts in to retained title/text, corrections, analysis version and progress. Make shared-browser visibility and absence of cloud backup clear. A successful label follows actual storage completion; quota, unavailable or corrupt storage keeps the story readable and reports the failure. Restore is always paused, with no retained strength, ceiling or armed session. Delete one/all removes retained story data. Appearance is separate. Story text/titles never go to backend, vendor, URLs, analytics or routine logs.

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
| Start / ceiling / strength | Confirmed maximum is clear; + cannot raise it or Start; lower/zero cap immediate; cancellation/Stop invalidates pending confirmation |
| Save / restore | Only opted-in stories persist; text/title/corrections/position return paused, strength 1.0×; failure shows unsaved state |
| Delete / Session only | Removing persistence deletes retained data; delete one/all is truthful and delayed writes cannot restore deleted stories |
| Keyboard | Logical focus, visible ring, named sliders/buttons, Escape and opener restoration; Stop accessible in modal flows |
| Real phone | Separately inspect keyboard, browser bars, rotation, backgrounding and safe areas; no physical Lovense device needed for this UI check |
| Reduced motion | No pulsing reading background or smooth-scroll dependence; state remains clear without animation |

Automated runs capture neutral workspace screenshots in ignored `artifacts/frontend/`; CI publishes the **frontend-evidence** artifact for 14 days. The [roadmap evidence ledger](beta-roadmap.md#evidence-ledger) records exact commits, browser versions and outcomes.

## Remaining work

F3 still needs an asynchronous device-scenario harness: failed/delayed connection, multiple choices, unsupported capabilities, stale/out-of-order completion and failed Stop/unknown output. Remaining F4 work covers private feedback, server account-data operations and support; F5 requires rights-cleared scoring evaluation and F6 wider usability/release evidence.

Requested/acknowledged hardware commands are not measured physical output. Live SDK compatibility, finite physical expiry, interrupted-network behaviour and every advertised device/browser combination remain qualification gates. This reader drives the simulator only.

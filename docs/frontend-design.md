# Frontend design and acceptance checks

Decision record: 28 October 2026, product owner Hammad. The approved **SatinLore frontend implementation specification v1.1** selects **Satin Editorial** as the main identity and **Midnight Ink** as its dark theme. This implementation follows that decision. Quiet Form remains a discarded exploration, not a third theme. The visual reference's earlier example mapping an ordinal label to 10/20 is superseded: suggestions remain **0, 1, 2, 3 and 5/20**.

The immediate milestone is F1 plus a functioning F2 Add → Review → Read slice, using the existing local simulator. Later F3–F6 software work and H1/H2 physical/release qualification are separate. The marketing waitlist is managed separately from this local development application.

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

The same-origin `appearance.js` runs before styles paint, sets the resolved theme and native colour-scheme, and binds the appearance choice after the DOM is ready. Default **System** follows the OS; explicit **Light** or **Dark** wins until changed. The only stored reader preference is `satinlore.appearance` with an allowlisted value `system`, `light` or `dark`. Invalid values and unavailable storage must not block use. The preference contains no story data or tokens. Reload clears the story while retaining a stored appearance choice.

## Functional slice

| View | Implemented behaviour |
| --- | --- |
| Add story | Paste or UTF-8 TXT; local validation/analysis; bounded input; useful loading/error messages; confirmation before a valid replacement discards the current story/corrections |
| Review | Literal paragraph text, experimental suggestion, manual 0–20 override including zero, and per-paragraph Use suggestion reset |
| Read | Continuous document scrolling, settled current-paragraph tracking, manual Previous/Next, on-demand adjustments, font size and follow-scroll control |
| Shared controls | Simulator label, connection/status, current simulated output, maximum intensity, explicit Start/Pause/Stop; Start unavailable outside Read |

Moving out of Read, changing appearance, font or viewport, hiding the page, or clearing/replacing text pauses playback and cancels stale work. Returning to Read/reconnecting never starts output. Manual zero stays distinct from “no override.” Cancelling a replacement preserves the current model, corrections and position while paused. No theme or view may raise the controller ceiling or change finite dispatch behaviour.

The reader uses the document as its scrolling surface, rather than a fixed-height nested reader. At desktop widths the reading column has a compact side rail; narrower layouts use a bottom dock. Reserve space for the dock, safe-area insets and focus/scroll targets so the last paragraph remains reachable. Adjustment panels do not obscure Stop. Opening or closing the reading settings pauses playback; automatic scroll selection is suspended while the panel is open so editing cannot silently change the selected section.

## Manual visual and interaction matrix

Use the neutral [sample](test-sample.txt), the [testing guide](test-today.md), and the exact build recorded by `git rev-parse --short HEAD`. Mark every row pass, fail or not tested, with browser/version and viewport. An emulated phone viewport does not count as a real-phone check.

| Check | Required observation |
| --- | --- |
| Light and Dark, 1440 × 1000 | Comfortable reading column, compact rail, clear focus and status; no clipped controls or horizontal overflow |
| Light and Dark, 390 × 844 | Single column and readable bottom dock; Stop stays reachable; first/last paragraphs and focused inputs can move above the dock |
| 320 CSS px and landscape | Controls wrap without page overflow; the reading area remains usable above the dock; no permanent nested scrollbar |
| 200% text or browser zoom | Enlarged labels and controls stay legible; no hidden Stop, clipped values or unreachable text; inspect both themes |
| System appearance | Change OS colour preference while System is selected; it follows. Choose Light/Dark explicitly; OS changes no longer override it |
| Reload and blocked storage | Appearance persists when available; story/corrections disappear. Storage-denied mode remains usable without a crash |
| Reflow during playback | Change appearance/font/window size: output pauses, selected paragraph remains selected, no automatic restart |
| Keyboard | Logical Tab/Shift+Tab order, visible focus, named sliders/buttons and usable Previous/Next; hidden views do not capture focus |
| Adjustments | Opening/closing controls does not hide Stop; a correction of zero survives view changes and only reset removes it |
| Native replacement confirmation | Cancel preserves current story/corrections/position; confirm creates a new Review model; focus returns to a usable control |
| Real phone | Check keyboard opening/closing, browser bars, rotation and safe-area spacing separately when a phone is available; no Lovense device is needed |
| Reduced motion | No animated/pulsing reading backgrounds or smooth-scroll dependence; state remains identifiable without movement |

Automated browser checks capture `artifacts/frontend/desktop-light.png`, `desktop-dark.png`, `phone-light.png`, `phone-dark.png`, `add-story-light.png` and `review-dark.png`. They are ignored local test output; CI publishes the **frontend-evidence** artifact. Review images at readable size alongside test results. The [roadmap evidence ledger](beta-roadmap.md#evidence-ledger) records actual verification; this checklist does not claim an unperformed test passed.

## Remaining decisions and implementation

F3 still needs deliberate asynchronous device simulation: delayed/failed connection, multiple choices, unsupported devices, stale/out-of-order completion and failed Stop/unknown output. F4 still needs opt-in saved stories/progress and deletion, private feedback/account operations, help and other supporting states. F5 needs rights-cleared evaluation material and held-out scoring evidence. Final typography/density refinements should follow reader feedback. None of these are implied complete by the approved visual direction.

Keep future device output vocabulary accurate: a requested or acknowledged command is not measured physical output. Hardware qualification, live SDK behaviour, physical expiry and interrupted-network stopping remain later gates. The reader currently sends commands only to the simulator.

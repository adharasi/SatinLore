# Frontend implementation specification

Decision date: 28 October 2026. **Satin Editorial is the approved main identity; Midnight Ink is the dark theme.** Offer Light, Dark and System. These are implementation requirements for the next hardware-free phase, not a statement that the current interface is complete.

Use the existing FastAPI/static ES-module architecture. Build the full intended beta software journey with simulation while hardware is unavailable. Keep runtime evidence, simulator/browser verification and physical-device qualification separate. The [roadmap](beta-roadmap.md) defines the work order; [development scope](development-spec.md) and [QA](qa.md) retain their control/privacy requirements.

## Visual system

Reading is the primary activity. Separate preparation, reading and adjustment modes instead of placing every form above or below one reader. Keep decorative textures on design material; the app's reading surface should be quiet and flat.

| Semantic role | Satin Editorial | Midnight Ink |
| --- | --- | --- |
| Page | `#F6F1E9` | `#18191F` |
| Surface | `#FFFCF8` | `#22232B` |
| Strong text | `#292329` | `#EDE7DF` |
| Quiet text | `#726771` | `#B8B4C1` |
| Primary action | `#542B45` | `#BDB1E3` |
| Text on primary | `#FFFFFF` | `#24202E` |
| Separator | `#D9CFD5` | `#494653` |
| Selected/active wash | `#EAE0E5` | `#32303E` |
| Stop/error text | `#8A3442` | `#F0ABB6` |

Use tokens by purpose; do not scatter raw colors through components. Validate contrast for actual adjacent surfaces and interactive states. Brand, selection and errors must remain distinguishable without color alone. Provide a visible keyboard focus ring.

Use a readable serif for story text and a clear sans serif for controls. Initial targets are 18–22 px adjustable story text, 14–16 px primary control text, comfortable line spacing and a restrained 4/8/12/16/24/32/48 spacing scale. Font choice must be tested with real text, numerals, long labels and target phones; no external font or tracking request is needed to begin implementation. Primary touch controls should have at least a 44 px target. Respect reduced motion; never animate the reading background to show output.

System mode follows `prefers-color-scheme`; explicit Light or Dark wins. Persist only the appearance choice in an allowlisted preference key at the first milestone. Theme preference is not permission to persist stories, credentials or tokens. Prevent an avoidable bright flash when opening dark mode. Theme/font/layout changes must preserve logical reading position and must not start or resume output.

## Responsive reader

Laptop: use a centered reading column around 620–720 px with generous margins and a compact control rail or dock. Secondary review/settings surfaces should not compete with the story.

Phone: use a continuous reading surface with comfortable side padding and a persistent bottom control dock above the browser safe area. Reserve scroll space so the last paragraph can move above the dock. Avoid a short nested reader trapped between tall setup and editor panels. Keep long status labels and enlarged text from pushing Stop off-screen.

Always expose playback state, simulator/device identity, bounded output information, the chosen ceiling and Stop. Pause replaces Start while playing; reconnect and tab return remain paused until deliberate restart. Appearance, paragraph corrections and detailed connection settings can open on demand. A sheet or dialog must not hide the essential Stop control; manage focus and restore it on close. Retain Previous/Next as a fallback to scroll following.

Verify 390 × 844 and 1440 × 1000, plus narrow 320 px, browser text zoom, portrait/landscape and long-content cases. Browser emulation is useful layout evidence; it is not physical phone/device qualification.

## Screen and state inventory

| Surface | Required states and actions |
| --- | --- |
| Entry/invitation | Welcome, valid/reused/expired invitation, submitting, rate limit, session expiry and sign out; local simulator entry needs no vendor token |
| Add story | Paste/TXT, empty, valid preview, oversized/invalid UTF-8/wrong type, pending import, cancellation, replace and clear |
| Prepare/review | Suggestions marked experimental, manual override including zero, reset to suggestion, no evidence/uncertain result, reanalysis with corrections preserved |
| Reader | Empty, ready paused, playing, stopped, manual/scroll-follow mode, current section, progress, font/layout changes and inactivity pause |
| Appearance | Light/Dark/System, reading size/spacing, usable live preview, keyboard focus and reduced motion |
| Connection | Simulator choice, disconnected, connecting, no devices, one/multiple devices, explicit selection, unsupported capability, low test, timeout/error, reconnect paused |
| Interrupted playback | Hidden tab, connection loss, command failure, uncertain Stop/output, session expiry/logout, stale callbacks and competing-tab ownership |
| Story data | Memory-only default, optional explicit remember-on-this-browser, storage unavailable/full, Delete Story/Delete All, restored position always paused |
| Feedback/help | Available after success or failure, bounded submission, retry/sent/error states, no story excerpts by default |
| Account/session data | Applicable deletion/revocation, confirmation and failure/retry, accurate distinction between browser story data and backend records |

Do not add a public bookshelf, generated stories, marketplace, wallet or payment flow to this beta. Optional saved stories are local browser data, not an invented cloud library. Current one-use invitations create temporary identities; durable return access/recovery needs a separate implemented contract before promising account history.

## Simulator and fixture contract

Keep the ordinary reader simulator usable without hardware, credentials or an invitation. Authentication can be exercised with the real local API and disposable test invitations. Use neutral fixtures. Keep scenario controls in a development-only harness; consumer-facing state labels must always distinguish simulation from hardware.

Deterministic scenarios should cover connection/discovery delay and timeout, supported/unsupported devices, explicit selection among multiple devices, rejected commands, disconnect while playing, reconnect paused, session expiry, logout, inactivity, tab contention and callbacks arriving after Stop or replacement. Record requested level, capped command and simulated output separately in test evidence rather than exposing debug terminology throughout the reader.

The current continuous `PlaybackController` is synchronous and rejects Promise-returning adapters. Asynchronous latency is separate contract work: define cancellation/epoch identity, timeouts, one current desired value, stale-response rejection, Stop priority and output certainty before wiring those fixtures. Do not remove the guard or fork a second uncontrolled playback implementation for a demo. Continue fake-SDK tests for the separate bridge independently.

A disconnected or timed-out transport may leave actual output unknown. Display uncertainty accurately; an API acknowledgement, UI timer or simulated zero cannot prove physical Stop. Returning/reconnecting never replays historical commands or starts output automatically. Simulator mode must not contact the real vendor.

## Scoring and output semantics

The current scorer's ordinal bands 0–4 map to suggestions `[0, 1, 2, 3, 5]` out of 20. Displaying a 0–4 band scale is optional, not an approved replacement for the current 0–20 override controls. The UI may display those bands clearly, but must not silently replace that conservative mapping with `[0, 5, 10, 15, 20]`. The latter exploratory mapping is superseded, not approved. For example, band 2 currently suggests 2/20, then the user's ceiling may lower it further.

Manual overrides currently accept integer values 0–20. A five-choice correction UI must either preserve access to those explicit values or be a separately documented product change; it cannot silently round or discard an existing correction. Zero is intentional, not an unset value. Reset clears only the selected override.

Keep prediction/band, nullable override, effective requested level, ceiling, dispatched command and output certainty separate. The ceiling always wins. Algorithm suggestions never start playback. Reanalysis/version changes must preserve deliberate corrections or request an explicit reset; uncertain, failed or malformed results abstain to zero/review.

Start improvements with a versioned local benchmark and baseline metrics, not a provider integration. Include neutral negatives and difficult context; split by story/author to avoid leakage. Evaluate false activation, ordinal error, correction burden, abstention/coverage and phone latency/memory. Keep sensitive test corpora out of the public repository. The current keyword heuristic is not a semantic, consent or safety classifier, and a moderation score is not an intensity score.

Local processing remains the default. A model's technical ability to classify supplied text is separate from permission for this product/use case, observed refusal or filtering behavior, and privacy/data-retention terms. Any hosted classification path therefore needs a separate decision before story transfer; provider research is not an implemented integration. No AI API keys or new AI dependencies are required for F1–F4. Model output must remain bounded, validated and subordinate to user correction and the independent controller.

## Definition of frontend completion

- The intended beta journey and every listed state are usable in both themes; there are no permanent pretend buttons for core local feedback/deletion features.
- Keyboard/focus, primary touch targets, long labels, safe-area placement, scrolling, narrow widths and enlarged text remain usable; Stop is always reachable.
- Existing import/override/controller invariants pass, including cancelled imports, literal text, manual zero, lowered ceilings, no backlog and no automatic restart.
- Scenario results are deterministic and assert state/command expectations. No real vendor requests or credentials are required.
- Default memory-only story behavior and any explicit opt-in persistence/deletion are verified. Allowlisted appearance storage is tested separately from prohibited story/token leakage.
- Feedback, coarse events and account/session deletion have working local behavior with ownership, retry and retention checks.
- Build, browser/version, viewport, theme, fixture and pass/fail/not-tested evidence are recorded. Simulator readiness is not described as production or hardware readiness.

## First coding handoff

Read root and browser `AGENTS.md`, `README.md`, this specification, [development scope](development-spec.md), [roadmap](beta-roadmap.md) and [today's guide](test-today.md). Implement F1: Satin Editorial light and Midnight Ink dark, Light/Dark/System preference and a reader-first responsive shell. Preserve the existing ES modules, `ReaderModel`, synchronous simulator and `PlaybackController`. No real-device credentials or hardware are required.

Keep explicit Start, reachable Stop, authoritative ceilings and manual zero. Preserve the current `[0, 1, 2, 3, 5]` suggestion mapping. Keep story data in memory; only the appearance preference may persist. Use neutral fixtures. Verify the target viewports and narrow/zoom cases, then run `scripts/check.py` and affected mocked browser checks. Update obsolete selectors and storage assertions without weakening behavior coverage. Return changed behavior, test results, neutral screenshots, remaining gaps and the F2 task. Do not enable deployment or real-device reading as part of the visual work.

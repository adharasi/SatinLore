# SatinLore Alpha setup

Alpha runs at `https://app.satinlore.com/alpha`. It is a Flexer study with a simulator and a separate username/password session for **Dilan** and **Sadie**. Dilan reviews both users at `https://app.satinlore.com/admin`. Sadie can review or withdraw her own saved sessions in Alpha. Alpha credentials cannot sign into the reader or the beta host.

## Owner setup after the Worker deployment

1. In a local PowerShell or Terminal opened at the SatinLore checkout, run the two commands below. Copy each generated password into your password manager under its exact username. Run one command again only to replace that person's credential. Share Sadie's password privately with her.

   ```powershell
   node scripts/create-alpha-credentials.mjs Dilan
   node scripts/create-alpha-credentials.mjs Sadie
   ```

2. In Cloudflare **Workers & Pages → satinlore-private-app → Settings → Variables and Secrets**, add two **production runtime Secret** entries, `ALPHA_DILAN_VERIFIER` and `ALPHA_SADIE_VERIFIER`. For each, paste the 64-character verifier printed for that exact name. The generated password is for the sign-in form. Choose **Deploy**. Each verifier change revokes that user's previous Alpha sessions. Keep the existing `PRIVATE_APP_ENABLED=true` and Lovense runtime configuration. The source deployment creates `ALPHA_STUDY` through migration `v3`.
3. In **Zero Trust → Access controls → Applications**, add a new **Self-hosted and private** application named **SatinLore Alpha app sign-in**. Under **Add public hostname**, use the host `app.satinlore.com` and add these path destinations:

   | Path | Purpose |
   | --- | --- |
   | `/alpha` | Alpha sign-in and study |
   | `/alpha/*` | Alpha assets, APIs, isolated bridge and slash form |
   | `/admin` | Dilan review |
   | `/admin/` | Slash form of Dilan review |

4. Add one policy to this new path-scoped Access application. Choose **Action → Bypass** and **Include → Everyone**. Save. Confirm every entry includes its path before saving. Cloudflare skips its own PIN check for these paths and the Worker enforces the Alpha password and Dilan role. Keep the existing whole-host reader Access application in place. A wildcard path in `/alpha/*` does not cover the bare `/alpha` path. [Cloudflare application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/) · [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
5. In an incognito window, open `https://app.satinlore.com/alpha`. Expect the SatinLore form and dark theme. If you see Cloudflare's PIN prompt, check the more specific path entries and policy. If the form reports private setup pending, check the runtime secret names, deployed version and `ALPHA_STUDY` binding. Open the reader root in the same window and verify that it still prompts for Cloudflare Access.
6. Sign in as Dilan. Open `https://app.satinlore.com/admin` and confirm the study review loads. In a separate session, sign in as Sadie and confirm that the Alpha works and `/admin` denies access. The review filters by username.

## First rehearsal and live visit

1. In Alpha, select the recording choice and **Simulator**. Study recording starts with your choice and captures the in-app control timeline. Complete the movement checks, adjust the two levels and limits, start, mark a moment, and finish. Review the post-session form for separate vibration/flexing maxima, background preference, enjoyment, comfort, connection/setup and interface feedback. Add an annotation at a chosen time. Verify acknowledgement before leaving the page.
2. In Dilan's `/admin`, filter by your username and open the session. Check control values, output states, marks, feedback and notes. Rehearse withdrawal on a disposable synthetic session. A withdrawn session and its shared clip are removed from live review.
3. Rehearse the optional clip in desktop Chrome. After pairing, consent to tab capture, use Chrome's picker to choose the Alpha tab and preview the clip locally. Share it explicitly to make it available in review. Clip capture is limited to one minute and 8 MiB. The timeline is independent of the clip. A device Stop and a recording Stop have distinct controls.
4. For a real Flexer, choose **My Flexer**, select **Connect** and pair via Lovense Remote. Follow the short test on each available movement with the toy out of use. Confirm the physical response, expiry and Stop. Confirm both movements before using their supported combination. If the requested movement cannot be verified, finish that rehearsal in simulator mode and record the limitation. Start with the conservative range. An explicit checked personal-range action can enable higher choices without increasing the selected maximum or starting output.
5. Once the hardware checks pass, have the tester explore privately and mark a moment if they choose. They can finish at any point. The feedback form records their preferred settings, how it felt and what the connection or controls could improve. Payment covers the agreed research time independent of any outcome or capture choice.

Open `/alpha/api/lovense/status` after Alpha sign-in if connection configuration needs diagnosis. `available: true` means the required runtime settings and rate storage passed validation. Actual QR creation, physical response and Stop require the device check. Record simulator and physical observations separately. [Physical qualification record](hardware-test-record.md)

Alpha study records are labelled with the verified username. Its bounded timeline is retained for up to 30 days and shared clips for up to seven days, subject to withdrawal. The optional clip is captured from the verified Alpha tab after pairing. Research participation, control recording and clip sharing are separate choices.

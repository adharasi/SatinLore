# SatinLore Alpha setup

Alpha runs at `https://app.satinlore.com/alpha`. It is a Flexer study with a simulator and a separate username/password session for **Dilan** and **Sadie**. Dilan reviews both users at `https://app.satinlore.com/admin`. Study sessions are available for review only in Dilan’s admin panel. Alpha credentials cannot sign into the reader or the beta host.

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

1. Open Alpha, choose **Simulator**, confirm you are 18 or older and choose **Allow data collection**. Connect and select the simulator. Test each movement, tick the check only after it starts and stops, then continue to the controls.
2. Follow **What to try**. Try each movement on its own, then combine the two if both are available. Set a personal maximum and test whether you prefer a low continuous minimum or a quiet break. Lower the maximum and verify the minimum drops with it. **Stop** stops the movements. **Finish & stop** also opens the feedback page.
3. Save the three required answers and any optional feedback or timestamped notes, then choose **Back to study home**. As Dilan, open the session in `/admin` and check separate replays of pairing, movement checks, controls and feedback. Review the control timeline, marks and submitted answers there. To delete a synthetic rehearsal, use the admin session’s delete action.
4. For a real Flexer, turn on Bluetooth and pair your Flexer in the **Lovense Remote** phone app. Open Alpha on a second screen, choose **My Flexer** and **Connect**. In Remote choose **+ → Scan QR**. Scan the code, keep Remote open and choose your Flexer in Alpha.
5. Set the Flexer down and check each movement separately at the low test level. Continue with only the movements that started and stopped as expected. Start with the conservative range. If the Flexer keeps moving after **Stop**, stop it in Lovense Remote or on the device.

Open `/alpha/api/lovense/status` after Alpha sign-in if connection configuration needs diagnosis. `available: true` means the required runtime settings and rate storage passed validation. Actual QR creation, physical response and Stop require the device check. Record simulator and physical observations separately. [Physical qualification record](hardware-test-record.md)

Alpha study records are labelled with the verified username and retained for up to 30 days. Consent enables continuous masked visual replay, control changes and marks, within the session’s one-hour window and storage limits. The replay reconstructs study screen layouts and interactions from fixed elements. It excludes pairing images, sign-in details, typed text, other tabs, camera and sound. Feedback and timestamped notes are saved when submitted. Historical clips already shared remain visible in admin for up to seven days.

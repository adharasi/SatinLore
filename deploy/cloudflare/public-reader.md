# Open the public reader

`app.satinlore.com` supports SatinLore email and password accounts. A code verifies the address during registration and authorises a password reset. The production switch is `PUBLIC_READER_ENABLED`. With the switch unset or false, the existing Access login continues to protect the reader. The release uses the existing `satinlore-private-app` Worker and its authentication Durable Object.

## 1. Prepare transactional email

1. In [Amazon SES](https://console.aws.amazon.com/ses/), select the region that already has a verified `satinlore.com` sending identity. The marketing Worker currently uses `eu-north-1`. Check **Verified identities** and **Account dashboard** in that region. The account needs production sending access there to send codes to unverified recipients. If SES is in the sandbox, request production access for transactional sign-in email. [SES production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
2. In IAM, create a dedicated programmatic identity and access key for the reader. Grant `ses:SendEmail` on the verified identity ARN in that region. Restrict `ses:FromAddress` to the address you will put in `AUTH_SES_FROM_EMAIL`, such as `team@satinlore.com`. The Worker calls the SES HTTPS API and uses IAM access keys. Keep the existing marketing credentials in their current Worker. [SES IAM permissions](https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html)
3. In Bitwarden, generate a new 64-character secret using only `0–9` and `a–f`, or generate one in Windows PowerShell with the commands below. Store the result privately and clear the clipboard when finished.

   ```powershell
   $satinLoreKey = New-Object byte[] 32
   $satinLoreRandom = [System.Security.Cryptography.RandomNumberGenerator]::Create()
   $satinLoreRandom.GetBytes($satinLoreKey)
   $satinLoreRandom.Dispose()
   ([System.BitConverter]::ToString($satinLoreKey)).Replace('-', '').ToLowerInvariant() | Set-Clipboard
   ```

## 2. Configure the Worker and test behind Access

1. In [Cloudflare](https://dash.cloudflare.com/), open **Workers & Pages → satinlore-private-app → Settings → Variables & Secrets**. Add these as **runtime** bindings. [Cloudflare Worker variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)

   | Name | Type | Value |
   | --- | --- | --- |
   | `PUBLIC_READER_OTP_KEY` | Secret | New 64-character hexadecimal secret |
   | `AUTH_SES_ACCESS_KEY_ID` | Secret | Dedicated IAM access key ID |
   | `AUTH_SES_SECRET_ACCESS_KEY` | Secret | Dedicated IAM secret access key |
   | `AUTH_SES_REGION` | Text | Verified SES region, for example `eu-north-1` |
   | `AUTH_SES_FROM_EMAIL` | Text | Bare verified sender address, for example `team@satinlore.com` |
   | `AUTH_SES_SESSION_TOKEN` | Secret | Only for temporary AWS credentials, which require renewal |

2. Confirm the latest GitHub build succeeded. Password hashing runs inside the existing SQLite authentication Durable Object, which has its own CPU budget. Verify sign-in on production before changing Access. [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
3. Keep `PRIVATE_APP_ENABLED`, the existing Access audience and team settings, beta allowlist, Lovense settings and `OPENAI_API_KEY` in place. Add `PUBLIC_READER_ENABLED` as **Text** with value `true` and deploy the settings while the current Cloudflare Access policy still covers the app.
4. Open the reader using an existing Cloudflare Access session. Choose **Create account** with an inbox you own and confirm its email code. Sign in with the password and select **Keep me signed in**. Refresh to verify the session. Use **Forgot password** in a second browser profile to set a new password. Confirm the old password and the first profile’s session are rejected, then sign in with the new password.
   - Keeping that session, sign in to the same test account in the other browser profile. Choose **Account → Change password** in one profile. Confirm both sessions and the previous password are rejected. Sign in with the new password in both profiles, choose **Account → Sign out on all devices**, and confirm both profiles require a fresh sign-in.
5. Sign in to a separate test account. From **Toy setup**, pair a compatible device with Lovense Remote, select it, check a movement, verify Stop and save the device preferences you use. Save a sample story with **Save to my account** and sign in from a second browser profile. Confirm the story and preferences appear there. Check that a browser-only story stays in the original browser and that a different account cannot see the sample story. Delete the sample data when finished.
6. If sending fails, check SES region, the verified sender, IAM permissions and SES account sending status before editing Access. If the new screen never appears, check the Worker name, the deployment and the exact value `true`.

## 3. Open the reader origin

1. In **Zero Trust → Access → Applications**, locate the application that matches the entire `app.satinlore.com` hostname. Record its current destinations and policy so you can restore them. Check **Workers & Pages → satinlore-private-app → Access** as well if there is any broader rule covering the Worker. [Cloudflare Access scopes](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
2. Configure the [private testing path](../../docs/launch-rollout.md#private-beta-access) and protect the founder billing and research paths before updating the whole-host rule. Remove only the whole-host `app.satinlore.com` destination from Access. Keep `beta.satinlore.com` and its existing audience and policies if it shares that application. Keep the existing Alpha and administrator authentication and any separate Access policies.
3. Open a fresh private window and visit [the public reader](https://app.satinlore.com/). Confirm the reader opens directly with **Sign in** in the toolbar. Sign in with an inbox you control. Open a story, check the reading controls and switch between Loom and Nocturne from an account with AI credits. Send a sample feedback note and sign out. Confirm both beta destinations need Cloudflare Access and the founder feedback inbox rejects a signed-out visitor and a non-founder account.
4. As founder, open [the feedback inbox](https://beta.satinlore.com/feedback-admin), search for the synthetic note, set **In review**, and choose **Save status**. Return to **Feedback → Your recent notes** in the app and refresh to see the change. Choose **Delete my feedback** on your synthetic account and confirm the note disappears from both views.

Existing browser stories stay in the browser library until explicitly saved to an account. Public accounts keep their own story library, reading settings and presets. The beta and Alpha identities keep their existing data and access rules. Guests can open and read their own text. Device pairing, feedback, account storage, link imports and Nocturne require sign-in.

Keep `PUBLIC_READER_OTP_KEY` in Bitwarden across rollbacks and redeploys. It also derives stable, pseudonymous account identities. Plan an account migration before rotating it so existing users retain access to their presets.

The feedback inbox lists the newest 200 notes sent since the inbox went live and lets the founder filter them by status, category and text. Readers can export or delete feedback from **Feedback**. Notes and review statuses expire after 30 days. The inbox stores the note, chosen category and optional rating alongside its review status and dates. It receives no automatic story or device context. Notes previously submitted with an Access login remain with that login until expiry.

## Roll back the public opening

Restore the previous whole-host Access destination and verify the login prompt in a fresh private window. Then set `PUBLIC_READER_ENABLED=false` and deploy. Keep the Durable Object migrations and account storage in place. This rollback preserves public-account records for a later reopening.

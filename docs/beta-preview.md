# Test the SatinLore launch on /beta

Deploy the reader branch `launch/accounts-usage-commerce` to the separate `satinlore-private-beta` Worker. Its two routes sit in front of the production custom domain for the beta paths. Keep `satinlore-private-app` and `satinlore-website` on `main`. Every deploy to the beta Worker gets the branch revision you checked out locally.

| Address | Environment |
| --- | --- |
| [app.satinlore.com/beta/](https://app.satinlore.com/beta/) | Private preview of the launch reader, with separate registrations, sessions, saved stories, Stripe objects and usage ledgers |
| [app.satinlore.com/beta/billing](https://app.satinlore.com/beta/billing) | Sandbox plans, checkout, order status, portal and usage |
| [app.satinlore.com/beta/billing-admin](https://app.satinlore.com/beta/billing-admin) | Founder-only sandbox billing admin |
| [app.satinlore.com/beta/simulator](https://app.satinlore.com/beta/simulator) | Device simulator for approved testers |
| [app.satinlore.com/beta/simulator-lab](https://app.satinlore.com/beta/simulator-lab) | Simulator scenarios and fault testing |
| [app.satinlore.com/alpha](https://app.satinlore.com/alpha) and [beta.satinlore.com](https://beta.satinlore.com/) | Existing Alpha and recording programmes |
| [app.satinlore.com](https://app.satinlore.com/) and [satinlore.com](https://satinlore.com/) | Production reader and homepage on `main` |

Use `/beta/` with the trailing slash for links to the beta homepage. Cloudflare matches a request with a query string only through a wildcard Workers route. The bare `/beta` entry redirects after Access. [Cloudflare Workers routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)

## 1. Set up Cloudflare Access

1. Open [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Access controls → Applications**. Create a **Self-hosted** app named **SatinLore private beta**. Add both public destinations, `app.satinlore.com/beta` and `app.satinlore.com/beta/*`, to the same application. If that exact scoped application already exists, edit it in place. A wildcard does not cover the parent path. [Access path rules](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
2. Add an **Allow** policy with **Include → Emails**. Enter your founder address and each invited tester. Save and copy the app's 64-character **Application Audience (AUD)** from its details. It must differ from the production reader audience and any separate `beta.satinlore.com` audience.
3. Create a second **Self-hosted** application for exactly `app.satinlore.com/beta/api/billing/stripe/webhook`, with **Bypass → Include → Everyone**. This is the endpoint Stripe calls directly. The Worker accepts only signed Stripe sandbox POSTs there. Keep the path free of wildcards, and keep your existing production Access settings. [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)

## 2. Deploy the launch branch to beta

Run from the SatinLore reader repository using Node.js 24 or newer. The first deploy provisions the beta Worker and six independent SQLite Durable Object namespaces. Check **Workers & Pages → satinlore-private-beta → Settings → Domains & Routes** for the exact and wildcard routes after the deploy. The app hostname stays on its existing proxied custom domain.

```sh
git fetch origin
git switch launch/accounts-usage-commerce
git pull --ff-only origin launch/accounts-usage-commerce
npm ci --ignore-scripts
npm run build:worker
npx wrangler deploy --config wrangler.beta.jsonc --dry-run
npx wrangler login
npx wrangler deploy --config wrangler.beta.jsonc
```

If the local branch does not exist, use `git switch --track origin/launch/accounts-usage-commerce`. The beta Worker has no public preview hostname. From here, repeat the fetch, pull, build and deployment commands to publish another beta candidate. Use [the launch rollout](launch-rollout.md) after accepting a candidate.

## 3. Enable accounts and email

1. In Amazon SES, choose the region with your verified sending identity. If SES is still in its sandbox, verify each test inbox in that region before testing delivery. For wider invitations, follow the [reader email setup](../deploy/cloudflare/public-reader.md#1-prepare-transactional-email) for production sending access and a dedicated sending identity in IAM.
2. In **Workers & Pages → satinlore-private-beta → Settings → Variables & Secrets**, add these runtime settings and deploy the settings. Generate a fresh beta OTP key using Node.js, `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`, and save it privately for future beta deployments.

   | Setting | Type | Value |
   | --- | --- | --- |
   | `PRIVATE_APP_ENABLED` | Text | `true` |
   | `PUBLIC_READER_ENABLED` | Text | `true` |
   | `ACCESS_TEAM_DOMAIN` | Text | Your existing team hostname ending in `.cloudflareaccess.com`, without `https://` |
   | `APP_BETA_ACCESS_AUD` | Text | The AUD from step 1 |
   | `FOUNDER_EMAIL` | Text | Your Cloudflare Access founder email |
   | `BETA_TESTER_EMAILS` | Text | The same approved tester emails as the Access policy, comma-separated, up to 20 |
   | `AUTH_SES_REGION` | Text | The region where your sending identity is verified |
   | `AUTH_SES_FROM_EMAIL` | Text | The bare sender address allowed in IAM, for example `team@satinlore.com` |
   | `PUBLIC_READER_OTP_KEY` | Secret | The unique beta 64-character hex key |
   | `AUTH_SES_ACCESS_KEY_ID` | Secret | Credentials for the beta sender identity |
   | `AUTH_SES_SECRET_ACCESS_KEY` | Secret | The matching IAM secret |
   | `AUTH_SES_SESSION_TOKEN` | Secret | Add only when using temporary IAM credentials |

3. In a fresh browser profile, open [beta signup](https://app.satinlore.com/beta/signup) and complete Cloudflare Access. Confirm the account setup page opens before entering the reader. Create a SatinLore test account, verify its email and sign in. Save a neutral sample story to the account and confirm you can reopen it in another profile with both sign-ins. Change the password, try a password reset, and test sign-out everywhere. Cloudflare Access controls who enters the preview and the SatinLore account controls the reader session.
4. Use a second test inbox to verify it sees an empty library and zero starting credits. Test signed-out Access in a fresh profile, a tester's inability to reach beta billing admin, and separation from the production site's session and browser data.

## 4. Configure Stripe sandbox checkout

1. In the [Stripe Dashboard](https://dashboard.stripe.com/), switch to a **Sandbox** for SatinLore. Copy its server secret key starting with `sk_test_`. Configure **Billing → Customer portal** in the sandbox for cancellation at the end of the paid period and leave plan switching disabled. Turn off **Adaptive Pricing** for Checkout so charges stay in USD. The Worker builds the prices from its own catalog. [Customer portal](https://docs.stripe.com/customer-management/configure-portal) · [Adaptive Pricing](https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing)
2. In sandbox **Workbench → Webhooks → Create an event destination**, select **Your account**, **Snapshot**, API version `2024-06-20`, and **Webhook endpoint**. Set the URL to `https://app.satinlore.com/beta/api/billing/stripe/webhook`. Add `payment_intent.succeeded`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`, `refund.created`, `refund.updated`, and `charge.dispute.closed`. Reveal its signing secret, starting with `whsec_`. [Stripe webhooks](https://docs.stripe.com/webhooks)
   - If Workbench omits `2024-06-20`, use Stripe's [Create a webhook endpoint API](https://docs.stripe.com/api/webhook_endpoints/create) with the sandbox key, the same `url` and `enabled_events`, and `api_version=2024-06-20`. Save the `secret` value from the creation response.
3. Add these settings to **satinlore-private-beta**. Add the keys and postback setting first. Enable checkout when the sandbox endpoint can reach the Worker.

   | Setting | Type | Value |
   | --- | --- | --- |
   | `STRIPE_SECRET_KEY` | Secret | The sandbox `sk_test_` key |
   | `STRIPE_WEBHOOK_SECRET` | Secret | The signing secret from the beta sandbox destination |
   | `STRIPE_PORTAL_CONFIGURATION_ID` | Text, optional | The sandbox portal configuration ID. Leave unset to use the sandbox default. |
   | `LAUNCH_BILLING_POSTBACK_ENABLED` | Text | `true` |
   | `LAUNCH_BILLING_ADMIN_ENABLED` | Text | `true` for the founder |
   | `LAUNCH_BILLING_ENABLED` | Text | `true` after the sandbox settings are ready |

   The beta deployment pins Stripe to `test` and enables credit metering by default. Use the sandbox's [test cards](https://docs.stripe.com/testing#cards) for checkout.
4. Sign in to a disposable beta account and open [Plans & usage](https://app.satinlore.com/beta/billing). Buy a $4.99 Starter top-up using `4242 4242 4242 4242`, a future expiry and any three-digit CVC. Confirm that Stripe sends you back to `/beta/billing`, its webhook delivery shows HTTP 200, and the account gets 100 credits once. Replay that same delivery to confirm the balance stays at 100. Cancel a separate checkout and confirm it adds zero credits.
5. Start the $9.99 monthly plan and confirm its paid invoice adds 200 monthly credits. Try a declined test card and confirm no credits post. Open the portal and schedule cancellation. Confirm the portal returns to beta and entitlement remains through the paid period. Run a sandbox refund from Stripe and confirm its webhook reconciles the balance. Use a sandbox subscription to test a renewal and confirm it credits exactly 200 for the new period. Use Stripe's dispute test card on a separate purchase and close the dispute as lost to verify the reversal. [Stripe dispute tests](https://docs.stripe.com/testing#disputes)
6. In [beta billing admin](https://app.satinlore.com/beta/billing-admin), create a one-time-pack promo code and an affiliate code. Test them with a new beta signup using `https://app.satinlore.com/beta/signup?ref=YOURCODE`. Confirm the discount math at checkout, the affiliate entry after payment, and the reversal after refund. Check reconciliation by Stripe payment or order ID and download a test CSV. Open the admin URL as a tester to verify access is denied.
7. If Stripe reports a redirect or challenge for the webhook, check the exact Cloudflare Access Bypass path. If it reports a signature error, check the signing secret against that destination in the same sandbox and verify the snapshot API version. Take live payments only after Stripe confirms eligibility for the product and account. [Stripe UK business restrictions](https://stripe.com/gb/legal/restricted-businesses)

## 5. Check AI spending and physical playback

By default, sandbox checkout grants beta credits and paid provider calls are paused. For an end-to-end Nocturne test, add these runtime settings on **satinlore-private-beta**. A real OpenAI test incurs API charges in the separate project.

| Setting | Type | Value |
| --- | --- | --- |
| `BETA_OPENAI_ENABLED` | Text | `true` |
| `BETA_OPENAI_API_KEY` | Secret | API key from a separate OpenAI project for beta |
| `LAUNCH_AI_APP_MONTHLY_CAP_NANO_USD` | Text | `1000000000` for a $1 beta cap per UTC month, or your chosen positive amount |
| `LAUNCH_AI_PAUSED` | Text | `false` while testing. Set `true` to pause beta model calls. |

Check that an unfunded reader can't request paid analysis. Use a funded beta reader and a short neutral passage, select **Nocturne**, and verify one successful analysis reduces credits by measured provider cost. Compare the beta usage screen with project activity. Switch off `BETA_OPENAI_ENABLED` when finished. Use the offline meter tests for cap, retry, and uncertain settlement scenarios.

For a physical pairing test, add beta `LOVENSE_DEVELOPER_TOKEN` and a separate 64-character hex `LOVENSE_UID_SECRET` as Secrets, plus `LOVENSE_PLATFORM` as Text using the registered website name. Follow the [Lovense setup and device checks](../deploy/cloudflare/README.md) with a compatible device you control. Test pairing, Pause, Stop and disconnect. Run the simulator tests from [the beta lab](https://app.satinlore.com/beta/simulator-lab).

## 6. Accept the candidate and merge

1. Run the local checks from [the launch rollout](launch-rollout.md#local-checks) and record `git rev-parse HEAD` for the deployed beta candidate. Check the registration, billing, metering, admin and physical tests above. Check the separate [marketing homepage draft](https://github.com/adharasi/satinlore-website/blob/launch/accounts-usage-commerce/docs/launch-homepage.md) using its own preview instructions before publishing it.
2. Open or update a PR from `launch/accounts-usage-commerce` into `main` for the reader when those tests pass. Merge, then follow the production launch steps with the production variables, bindings and merchant settings. Keep the two beta routes on the beta Worker to test future branches.
3. To pause beta purchases, set `LAUNCH_BILLING_ENABLED=false` on the beta Worker and keep its sandbox webhook enabled for unsettled events. To take this launch preview offline, remove its two Workers routes after its sandbox events settle. Keep Access in place for `/beta` and `/beta/*`. Any enabled simulator fallback is then served by the production revision.

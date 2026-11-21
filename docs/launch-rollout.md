# SatinLore launch rollout

Keep both production Workers configured to build from `main`. The reader uses `adharasi/SatinLore` and the public homepage uses `adharasi/satinlore-website`. Test the `launch/accounts-usage-commerce` branch before merging it into `main`. [Cloudflare Workers build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)

## 1. Test the launch branch before merging

1. Run the local checks at the bottom of this guide on the reader launch branch. They cover the protected simulator route, signup and login, Stripe webhook handling and AI metering using fixtures. Run the homepage preview from the website launch branch. [Homepage test and deploy guide](https://github.com/adharasi/satinlore-website/blob/launch/accounts-usage-commerce/docs/launch-homepage.md)
2. The launch revision's `/beta` handler serves the simulator and `/beta/simulator-lab`. Signup uses `/signup` and `/api/auth/*`, billing uses `/billing` and `/api/billing/*`, and AI usage uses `/api/account/usage`. Cloudflare Access controls who can open a route. Worker routing and deployment determine which revision serves it.
3. A hosted beta for the full release requires a separate staging Worker running this branch, its own Durable Objects, an approved tester policy, and a Stripe sandbox destination for that Worker. To use `/beta` as the entry to that environment, implement and verify the staging origin and routes first. The current branch pins the reader origins and Stripe return URLs to the production app.
4. Merge each release to `main` after its agreed tests pass. Check that the reader's main-branch deployment has `COMMERCE` and `LAUNCH_USAGE` bindings and the v6 migration. For the first production check, keep whole-host Access enabled and keep `LAUNCH_BILLING_ENABLED=false`. Retain `PRIVATE_APP_ENABLED=true`, `PUBLIC_APP_ORIGIN=https://app.satinlore.com`, the Lovense settings, and any existing `PUBLIC_READER_OTP_KEY`.

## Private beta access

Apply these settings when the simulator route is present on the Worker you intend to test. They grant access to the simulator and its lab.

1. In **Cloudflare Zero Trust → Access controls → Applications**, choose **Add an application → Self-hosted**. Name it **SatinLore private beta**.
2. In that one application add both public hostnames and paths:

   | Hostname | Path |
   | --- | --- |
   | `app.satinlore.com` | `/beta` |
   | `app.satinlore.com` | `/beta/*` |

   A wildcard path does not cover the parent path. Keep `beta.satinlore.com` out of this application. [Cloudflare Access path rules](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
3. Create an **Allow** policy and **Include → Emails**. List the founder and each approved tester. Use the team's current login method. Save the application, then copy its **Application Audience (AUD)** from the application's details.
4. In **Workers & Pages → satinlore-private-app → Settings → Variables & Secrets** set:

   | Text variable | Value |
   | --- | --- |
   | `APP_BETA_ACCESS_AUD` | 64-character audience for this exact new application. It must differ from `ACCESS_AUD` and `BETA_ACCESS_AUD`. |
   | `ACCESS_TEAM_DOMAIN` | Existing team hostname ending in `.cloudflareaccess.com`, without `https://`. |
   | `FOUNDER_EMAIL` | Your existing founder login address. |
   | `BETA_TESTER_EMAILS` | Comma-separated approved tester emails. Up to 20. They must also appear in the Cloudflare Allow policy. |

5. Open `https://app.satinlore.com/beta` in a fresh private window. Check that an anonymous visitor gets challenged, a regular reader email session alone cannot enter, and a listed tester with the new Access login can enter. As the tester, verify `/beta/simulator-lab` works. Check that `/simulator-lab` on the public root returns 404 and that root Help and setup show physical pairing only.
6. For founder billing, keep `/billing-admin`, `/billing-admin/*`, `/api/billing-admin`, and `/api/billing-admin/*` behind the founder-only Access application that uses `ACCESS_AUD`. Verify access from a founder browser and denial from an ordinary reader. Enable `LAUNCH_BILLING_ADMIN_ENABLED=true` when the founder policy is in place. Testers do not need founder permissions.
7. At production rollout, follow the [email and reader setup](../deploy/cloudflare/public-reader.md). Confirm SES delivery, check signup and login with two browser profiles, and check pairing, Pause and Stop with a supported device. Open the public reader after these checks by removing only the whole-host Access destination for `app.satinlore.com`. Keep the exact beta and founder policies and the separately hosted beta, Alpha and research scopes. Verify `/signup` and `/login` again from a fresh browser.

## 3. Control AI spending

A credit represents $0.01 of measured Luna API spend. The meter counts actual billable input, cached input and output at the configured Standard GPT-6 Luna short-context rates. It reserves an upper estimate before sending a request. An uncertain request holds that reservation instead of assuming that the provider did not bill it. [Luna pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)

| Purchase | Customer pays | Credits | Provider budget |
| --- | ---: | ---: | ---: |
| SatinLore Monthly | $9.99 per month | 200 each paid month | $2.00 |
| Starter top-up | $4.99 once | 100 | $1.00 |
| Plus top-up | $9.49 once | 200 | $2.00 |
| Stock-up top-up | $17.99 once | 400 | $4.00 |

Included credits are used first and expire at the end of each paid period. Top-ups carry over. Paid Nocturne access starts at zero. Keep the catalog default to use the values above.

1. In the OpenAI API platform, create a production project and dedicated service-account key for this reader. Use separate test credentials and projects where possible. Add the production key to the reader Worker as a runtime secret named `OPENAI_API_KEY`. Set an OpenAI project budget and alerts. A project budget is an alert threshold and requests can continue after it is reached. Use the Worker cap below to stop new launch requests. [OpenAI project settings](https://help.openai.com/en/articles/9186755-managing-your-work-in-the-api-platform-with-projects)
2. Set these as **Text** in Cloudflare. All monetary caps use nano-USD, with 1,000,000,000 nano-USD per $1.

   | Variable | Suggested initial value | Effect |
   | --- | ---: | --- |
   | `LAUNCH_AI_COST_METERING_ENABLED` | `true` | Applies the priced ledger to public Nocturne. |
   | `LAUNCH_AI_APP_MONTHLY_CAP_NANO_USD` | `50000000000` | $50 of public Nocturne spend per UTC calendar month across accounts. Choose the threshold you are willing to fund. |
   | `LAUNCH_AI_MONTHLY_CAP_NANO_USD` | `10000000000` | $10 per verified reader per UTC month. It covers both subscription and top-up credits. |
   | `LAUNCH_AI_TRIAL_NANO_USD` | `0` | No free paid-inference allowance. |
   | `LAUNCH_AI_ACCOUNT_REQUESTS_PER_DAY` | `100` | Daily request count for each reader. |
   | `LAUNCH_AI_APP_REQUESTS_PER_DAY` | `1000` | Daily application request count. |
   | `LAUNCH_AI_APP_REQUESTS_PER_MONTH` | `15000` | Monthly application request count. |
   | `LAUNCH_AI_PAUSED` | `false` | Set to `true` to pause new public paid model calls. |

3. Verify a new account starts at zero. Test reservations and the app cap with the local model fixture. After live activation, use a funded account you control to run one request, check **Plans & usage**, and compare the OpenAI activity. All app-wide accounting starts with this code version. Founder and research traffic follows separate limits. The app cap does not cover other services sharing the OpenAI project. Set `LAUNCH_AI_PAUSED=true` during an incident and keep metering on.

## 4. Configure Stripe

Stripe is the selected provider. Its UK policy lists adult content and services as prohibited, including mature literature intended for sexual gratification. Get Stripe's written decision for the actual adult-reading and device-sync product, subscriptions and service-only AI usage credits on your exact account before accepting live payments. An existing account alone only establishes access to Stripe. Reader registration and homepage deployment can proceed with purchases off. [Stripe UK policy](https://stripe.com/gb/legal/restricted-businesses) · [Stripe Support](https://support.stripe.com/contact)

> Can Stripe Payments support SatinLore and can I use my existing account? It is an 18+ browser reader where users import their own adult fiction and can sync compatible devices including Lovense as they read. We charge $9.99 per month for the software and sell nontransferable AI usage credits redeemable only in SatinLore. We do not sell hardware or operate a story marketplace.

1. In a Stripe sandbox, set your customer-facing business details and configure **Settings → Billing → Customer portal** so subscribers can cancel at the end of the paid period. Disable plan changes from the portal unless you have tested them with SatinLore's price and entitlement rules. Save the portal configuration. [Stripe portal settings](https://docs.stripe.com/customer-management/configure-portal)
2. The Worker creates USD card checkout sessions from its own catalog, including the monthly renewal interval and any one-time discount. There are no Stripe Price IDs to copy. Turn off Adaptive Pricing for Checkout in each mode so the signed invoice currency agrees with the catalog. Keep the standard Stripe-hosted Checkout and Customer Portal URLs. [Stripe Adaptive Pricing settings](https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing)
3. Once the staging Worker is available, in **Stripe → Workbench → Webhooks** add a sandbox event destination for its webhook URL. The live endpoint is `https://app.satinlore.com/api/billing/stripe/webhook`. Use Snapshot events and API version `2024-06-20`. Choose the event types below and copy the destination's signing secret. Stripe needs to reach the exact webhook path without a reader session or an Access prompt. Keep Access on founder and beta pages. [Stripe webhooks](https://docs.stripe.com/webhooks)

   Subscribe to `payment_intent.succeeded`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`, `refund.created`, `refund.updated`, and `charge.dispute.closed`. A lost dispute reverses the applicable credits and commissions after Stripe closes it.

4. In the staging Worker's **Variables & Secrets**, use the sandbox values below. Apply the live values to the production reader when ready to enable live payments.

   | Setting | Type | Example |
   | --- | --- | --- |
   | `LAUNCH_PAYMENT_PROVIDER` | Text | `stripe` |
   | `STRIPE_MODE` | Text | `test` for the sandbox, `live` only after merchant approval. |
   | `STRIPE_SECRET_KEY` | Secret | Server key matching the selected Stripe mode. |
   | `STRIPE_WEBHOOK_SECRET` | Secret | Signing secret for that Stripe endpoint and mode. |
   | `STRIPE_PORTAL_CONFIGURATION_ID` | Text | Optional Stripe configuration ID. With it unset, the selected account's default portal configuration is used. |
   | `LAUNCH_BILLING_POSTBACK_ENABLED` | Text | `true` to receive the configured provider's signed callbacks. |
   | `LAUNCH_BILLING_ENABLED` | Text | `false` during setup. Turn on only for the isolated test or after live acceptance. |

5. Keep sandbox checkout behind your own Access policy and use a disposable reader account. Stripe test mode stores billing and credit balances separately from live mode and blocks new public paid model calls. The webhook still needs to be reachable at its exact path. Exercise one-time purchase, first subscription payment, duplicate signed delivery, failed payment, successful renewal, cancel at period end, refund and dispute. Verify 200 monthly credits appear only after a paid invoice and renew once per paid period. Verify one-time packs carry over and no amount is granted from the browser return alone. Use the merchant dashboard to replay test events and check delivery. Keep live checkout off until this passes. [Stripe subscription events](https://docs.stripe.com/billing/subscriptions/webhooks)
6. After Stripe's decision and sandbox acceptance, create the live webhook destination with the same API version and event list. Replace secrets and any portal configuration ID with their live counterparts. Set `STRIPE_MODE=live` and enable postbacks before enabling charges. Verify a controlled live payment, refund and a portal cancellation with your own approved account. Once live subscriptions exist, keep the production Worker in live mode so Stripe can reconcile them. Run later sandbox tests against a separate test deployment. Keep the live signing secret connected when pausing new purchases.

In **Billing admin → Payment reconciliation**, use the SatinLore checkout reference or a Stripe payment intent, invoice, subscription, charge, refund or dispute ID. Review the date range and records requiring attention before downloading CSV. Issue refunds from the Stripe dashboard so signed events can reconcile the credits and affiliate commissions. Promotional codes apply to one-time packs. Affiliate commission uses the discounted payment after reversals before processor fees and taxes. It applies to attributable top-ups and first subscription payments.

Review offer and renewal terms, tax display and applicable age-assurance requirements for the markets you plan to open. Signup records an 18+ declaration. [Ofcom age assurance](https://www.ofcom.org.uk/online-safety/protecting-children/age-assurance)

## 5. Publish the redesigned homepage

1. Merge the tested website branch into its `main` branch. Confirm the `satinlore-website` Worker deployed that main commit. That Worker serves both `satinlore.com` and `launch.satinlore.com`. [Cloudflare Workers build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
2. After testing production reader signup, set `MARKETING_LAUNCH_ENABLED=true` in the marketing Worker's **Variables & Secrets**. Keep `MARKETING_BILLING_ENABLED=false` until you have activated and tested live Stripe checkout. Check the public homepage, account and sign-in buttons, privacy links, waitlist destination and canonical URL.
3. After verified live billing, set `MARKETING_BILLING_ENABLED=true` so the public plans button links to the reader's protected billing area. Verify prices agree with the checkout. To pause purchases, switch this off, set `LAUNCH_BILLING_ENABLED=false` on the reader and leave webhooks enabled so existing payments and refunds continue to reconcile.

The [Nocturne recognition and hardware gates](nocturne-release-qualification.md) apply separately. Keep the app's private and billing pages out of search indexing.

## Local checks

```sh
python3 scripts/check.py
npm run build:worker
npm exec wrangler deploy -- --dry-run
node --test tests/private-worker.test.mjs tests/public-auth.test.mjs tests/launch-billing-worker.test.mjs tests/launch-usage.test.mjs tests/billing-ui.test.mjs
node scripts/launch-browser-check.mjs
```

These checks use synthetic inputs and payment fixtures. The browser smoke script uses the older Verotel fixture. The Stripe tests are in `tests/launch-billing-worker.test.mjs`. Run the separate merchant and hardware acceptance checks before opening paid playback on the production Worker.

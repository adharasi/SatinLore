# SatinLore launch rollout

Keep both production Workers configured to build from `main`. The reader uses `adharasi/SatinLore` and the public homepage uses `adharasi/satinlore-website`. Test the `launch/accounts-usage-commerce` branch before merging it into `main`. [Cloudflare Workers build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)

## 1. Test the launch branch before merging

1. Follow the [/beta setup and acceptance guide](beta-preview.md) to deploy this branch to `satinlore-private-beta`, test Stripe in its sandbox and check the isolated account and usage data.
2. Run the [homepage test and deploy guide](https://github.com/adharasi/satinlore-website/blob/launch/accounts-usage-commerce/docs/launch-homepage.md) on the separate website launch branch.
3. Merge each release to `main` after its agreed tests pass. Check that the reader's main-branch deployment has `COMMERCE` and `LAUNCH_USAGE` bindings and the v6 migration. For the first production check, keep whole-host Access enabled and keep `LAUNCH_BILLING_ENABLED=false`. Retain `PRIVATE_APP_ENABLED=true`, `PUBLIC_APP_ORIGIN=https://app.satinlore.com`, the Lovense settings, and any existing `PUBLIC_READER_OTP_KEY`.

## 2. Protect beta and open production

1. Keep the dedicated Access application for both `app.satinlore.com/beta` and `app.satinlore.com/beta/*`. Its policy and exact Stripe sandbox webhook exception are documented in the [beta preview guide](beta-preview.md#1-set-up-cloudflare-access).
2. For production founder billing, keep `/billing-admin`, `/billing-admin/*`, `/api/billing-admin`, and `/api/billing-admin/*` behind the founder-only Access application that uses production `ACCESS_AUD`. Enable `LAUNCH_BILLING_ADMIN_ENABLED=true` when the policy is in place. Check it in a founder browser and verify denial from an ordinary reader.
3. Follow the [email and reader setup](../deploy/cloudflare/public-reader.md) in production. Confirm SES delivery, check signup and login with two browser profiles, and check pairing, Pause and Stop with a supported device. Open the public reader after these checks by removing only the whole-host Access destination for `app.satinlore.com`. Keep the beta and founder policies and the separately hosted beta, Alpha and research scopes. Verify production signup and login from a fresh browser.

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
3. Complete the [sandbox checkout instructions](beta-preview.md#4-configure-stripe-sandbox-checkout) before configuring the live destination. In **Stripe → Workbench → Webhooks** the live endpoint is `https://app.satinlore.com/api/billing/stripe/webhook`. Use Snapshot events and API version `2024-06-20`. Choose the event types below and copy the destination's signing secret. Stripe needs to reach the exact webhook path without a reader session or an Access prompt. Keep Access on founder and beta pages. [Stripe webhooks](https://docs.stripe.com/webhooks)

   Subscribe to `payment_intent.succeeded`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`, `refund.created`, `refund.updated`, and `charge.dispute.closed`. A lost dispute reverses the applicable credits and commissions after Stripe closes it.

4. Apply these settings to the production reader when ready to enable live payments.

   | Setting | Type | Example |
   | --- | --- | --- |
   | `LAUNCH_PAYMENT_PROVIDER` | Text | `stripe` |
   | `STRIPE_MODE` | Text | `live` after merchant approval. |
   | `STRIPE_SECRET_KEY` | Secret | Server key matching the selected Stripe mode. |
   | `STRIPE_WEBHOOK_SECRET` | Secret | Signing secret for that Stripe endpoint and mode. |
   | `STRIPE_PORTAL_CONFIGURATION_ID` | Text | Optional Stripe configuration ID. With it unset, the selected account's default portal configuration is used. |
   | `LAUNCH_BILLING_POSTBACK_ENABLED` | Text | `true` to receive the configured provider's signed callbacks. |
   | `LAUNCH_BILLING_ENABLED` | Text | `false` during setup. Turn on only for the isolated test or after live acceptance. |

5. After Stripe's decision and sandbox acceptance, create the live webhook destination with the same API version and event list. Use the new live secrets and portal configuration ID. Set `STRIPE_MODE=live` and enable postbacks before enabling charges. Verify a controlled live payment, refund and a portal cancellation with your own approved account. Once live subscriptions exist, keep the production Worker in live mode so Stripe can reconcile them. Run later sandbox tests against a separate test deployment. Keep the live signing secret connected when pausing new purchases.

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
npx wrangler deploy --config wrangler.beta.jsonc --dry-run
npx wrangler deploy --config wrangler.jsonc --dry-run
node --test tests/private-worker.test.mjs tests/public-auth.test.mjs tests/launch-billing-worker.test.mjs tests/launch-usage.test.mjs tests/billing-ui.test.mjs
node scripts/launch-browser-check.mjs
```

These checks use synthetic inputs and payment fixtures. The browser smoke script uses the older Verotel fixture. The Stripe tests are in `tests/launch-billing-worker.test.mjs`. Run the separate merchant and hardware acceptance checks before opening paid playback on the production Worker.

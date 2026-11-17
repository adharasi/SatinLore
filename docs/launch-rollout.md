# SatinLore launch rollout

The reader Worker serves public registration, account recovery, the Luna usage meter, hosted checkout, top-up promotion codes and affiliate links. The marketing website has a separate deployment. Use this runbook to open the reader and activate payments from your own accounts.

## Launch pricing

All prices below are in USD. A SatinLore AI credit represents $0.01 of metered Luna API spend.

| Purchase | Customer price | AI credits | Luna budget | Billing |
| --- | ---: | ---: | ---: | --- |
| SatinLore Monthly | $9.99 | 200 | $2.00 | Renews each calendar month |
| Starter | $4.99 | 100 | $1.00 | One-time |
| Plus | $9.49 | 200 | $2.00 | One-time |
| Stock-up | $17.99 | 400 | $4.00 | One-time |

Stock-up saves about 10% against the $5-per-$1 baseline. The monthly price is about five times its included model budget before taxes, processor fees, promotions and commissions. Guests can read their own stories and registration is free. Device pairing requires a verified account and a compatible toy. Paid Nocturne access starts at zero credits.

Included credits from a subscription apply first and expire at the end of its paid period. Successful renewal gives that period a fresh 200 credits. Purchased top-ups carry over. Cancellation stops renewal through Verotel while the current paid period remains available. A checkout return displays pending until a signed provider payment confirmation arrives. Refunds and chargebacks reverse available credits and attributable commissions for the payment concerned.

The meter uses Standard GPT-6 Luna short-context input at $0.10 per million tokens, cached reads at $0.01 per million, and output at $0.50 per million. Output includes reported reasoning tokens. The Worker reserves an upper estimate before making an API call, then reconciles the reported usage. An ambiguous provider response retains its reserved cost. Request size and traffic ceilings also apply. Purchase amounts and balance records are held in integer nano-USD, so one dollar is 1,000,000,000 nano-USD and one displayed credit is 10,000,000. [Luna pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)

## 1. Review and deploy the reader Worker behind Access

1. Merge the tested launch changes into `main` when you are ready to deploy. Confirm Cloudflare deploys the `satinlore-private-app` Worker with its v6 Durable Object migration and the `COMMERCE` and `LAUNCH_USAGE` bindings. First keep the existing whole-host Cloudflare Access policy in place. Keep `LAUNCH_BILLING_ENABLED` false.
2. Follow the [reader rollout](../deploy/cloudflare/public-reader.md) for signup and email. In the SES region with a verified SatinLore sending identity, confirm production sending access and provision a dedicated IAM identity for `ses:SendEmail`. Add the region and From address as Worker variables. Add `AUTH_SES_ACCESS_KEY_ID`, `AUTH_SES_SECRET_ACCESS_KEY`, and the optional `AUTH_SES_SESSION_TOKEN` through **Settings → Variables & Secrets**. Keep the existing `PUBLIC_READER_OTP_KEY` if one is already in use. Its value also preserves account identities.
3. Keep a restricted OpenAI project key as the Worker secret `OPENAI_API_KEY` and set spend controls for that project. Enable `PUBLIC_READER_ENABLED=true` and `LAUNCH_AI_COST_METERING_ENABLED=true` together before opening the host. Keep `PRIVATE_APP_ENABLED`, `PUBLIC_APP_ORIGIN=https://app.satinlore.com`, SES delivery settings and the required production bindings in place. Check that a funded staging account can run Nocturne and that a new public account begins with zero paid credits.
4. Behind Access, use two browser profiles and a real inbox you control. Register at `/signup`, verify the email, and sign in at `/login`. Exercise password reset, password change and all-device sign-out. Verify that each ends the appropriate older sessions. Check story import and reading, account isolation for saved stories and billing records, and the founder page rejecting an ordinary reader. Run the end-to-end toy acceptance checks separately with compatible hardware.

| Optional runtime variable | Default and purpose |
| --- | --- |
| `LAUNCH_AI_MONTHLY_CAP_NANO_USD` | `10000000000` gives each verified reader a $10 metered API spend cap per UTC calendar month across subscriptions and top-ups. It applies separately from the $2 allowance granted by each paid subscription period. |
| `LAUNCH_AI_TRIAL_NANO_USD` | `0` gives no free paid AI. If configured, the initial grant is established once per account. |
| `LAUNCH_AI_ACCOUNT_REQUESTS_PER_DAY` | `100` metered requests per account per UTC day. |
| `LAUNCH_AI_APP_REQUESTS_PER_DAY` | `1000` metered requests across public accounts per UTC day. |
| `LAUNCH_AI_APP_REQUESTS_PER_MONTH` | `15000` metered requests across public accounts per UTC month. |
| `LAUNCH_PLAN_CATALOG` | Leave unset for the four prices above. A staged custom USD catalog uses integer `amountMinor` in cents, `credits` in nano-USD, and `kind` as `monthly` or `one-time`. A monthly entry must grant exactly $2 of Luna spend. |

The older launch staging meter used raw tokens. Use the new cost-metering flag and variables. Any old raw-token ledger will require a deliberate migration for a pre-existing paid balance. This is relevant only if that earlier branch accepted orders.

### Private beta access

1. In Cloudflare Zero Trust, create a separate Access application for `app.satinlore.com/beta` and `app.satinlore.com/beta/*` in the same app. The exact root and descendant paths both need coverage. Permit the founder and approved tester email addresses. [Cloudflare Access path scopes](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
2. Add the new app's 64-character audience as the Worker variable `APP_BETA_ACCESS_AUD`. It must differ from `ACCESS_AUD` and `BETA_ACCESS_AUD`. Reuse `ACCESS_TEAM_DOMAIN`, `FOUNDER_EMAIL` and the comma-separated Worker allowlist `BETA_TESTER_EMAILS`. Testers must be allowed at both layers. Keep `PRIVATE_APP_ENABLED=true` and `PUBLIC_APP_ORIGIN=https://app.satinlore.com`.
3. Check `/beta` in a signed-out browser, an ordinary reader session and an approved tester session. Only the tester or founder with a valid assertion for this audience can open the beta reader and `/beta/simulator-lab`. A missing or reused audience keeps the beta closed. The beta reader has its own browser library and preferences. Keep the existing `beta.satinlore.com` test and recording policies in place.

## 2. Obtain merchant approval and test payments

### Check eligibility with your existing Stripe account

Stripe UK lists adult content and services under prohibited businesses, including mature literature intended for sexual gratification. Its published policy does not specifically classify a private reader that syncs connected devices to user-imported fiction. An existing Stripe account covers the business Stripe reviewed for that account. Get a written answer from [Stripe Support](https://support.stripe.com/contact) about SatinLore's specific product and account before configuring live Stripe payments. [Stripe UK policy](https://stripe.com/gb/legal/restricted-businesses) · [Stripe eligibility FAQ](https://support.stripe.com/questions/prohibited-and-restricted-businesses-list-faqs)

Use this description in the support request and update it if the product scope changes.

> Can Stripe Payments support SatinLore, and would it require a separate account? SatinLore is an 18+ browser reader. Users import their own adult fiction and can sync compatible connected devices, including Lovense devices, to the story as they read. We charge $9.99 per month for the service and also offer nontransferable AI usage credits usable only in SatinLore. SatinLore does not sell hardware or operate a public story marketplace. Please confirm eligibility for recurring subscriptions and one-time credit packs for this exact product, and any conditions or market restrictions.

Keep `LAUNCH_BILLING_ENABLED=false` while the merchant decision is pending. Continue registration and reader testing from step 1. If Stripe confirms eligibility, the repo needs a Stripe adapter and a test-mode acceptance run before live checkout. The adapter must reconcile verified Stripe events into the existing payment and credit ledger for first payments, renewals, payment failures, cancellations, refunds and disputes. Preserve the current plan prices and entitlements. [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) · [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)

### Use the staged Verotel adapter if approved

1. Apply for **Verotel Premium** and ask for approval for SatinLore's adult reading and device-sync product, the $9.99 USD subscription and the one-time AI credits. Confirm that the approved account supports the implemented **FlexPay v4** adapter. Ask for the startup terms and a written quote that includes weekly minimums and fees, transaction fees, payout timing and any reserve. Verotel publishes a EUR 100 weekly processing requirement, a EUR 25 weekly fee below EUR 1,000 in volume and a six-month processing history requirement for Premium. CCBill serves adult startups and would need its own integration if you choose it. [FlexPay](https://controlcenter.verotel.com/flexpay-doc/subscription.html) · [Verotel eligibility](https://www.verotel.com/en/productchoice.html) · [CCBill adult processing](https://ccbill.com/industries/adult-business)
2. In a separate test environment, set `VEROTEL_SHOP_ID` as a Worker variable and `VEROTEL_SIGNATURE_KEY` as a Worker secret. Enable `LAUNCH_BILLING_POSTBACK_ENABLED=true`. Configure Verotel signed v2 postbacks to the test equivalent of `https://app.satinlore.com/api/billing/verotel/postback`. Give processor servers access to that route without a customer session or a whole-host Access challenge. Keep the signature key on the server. Avoid logging postback query strings.
3. Confirm with the merchant that its checkout renders the correct currency, price and calendar-month recurrence (`P1M`), and that signed v2 callbacks include the expected ID, price and calendar fields. Exercise initial payment, decline, renewal, duplicate callback, retry extension, refund, chargeback, cancellation and expiry. Check that the return before a callback grants zero, the first charge grants 200 credits, retry extension grants zero, a successful renewal grants 200 for the next period, and a duplicate never grants extra. Check cancellation from the hosted link and confirm the subscription keeps access until the end of its paid period. [Verotel signed postbacks](https://controlcenter.verotel.com/flexpay-doc/postbacks.html)
4. Confirm offer, renewal and cancellation terms, tax display, and applicable age-assurance rules for the markets you plan to open. Signup records an 18+ declaration. [Ofcom age assurance](https://www.ofcom.org.uk/online-safety/protecting-children/age-assurance)
5. Protect `/billing-admin` and `/api/billing-admin` and their subpaths with the founder Access policy and its matching Worker audience before enabling `LAUNCH_BILLING_ADMIN_ENABLED=true`. The founder can set promotion limits, dates, affiliate codes and commission rates there. Promotions apply to one-time packs. Referral links use `/billing?ref=CODE`, retain first valid attribution for 30 days, and preserve it through registration. Commission uses the discounted amount after reversals before processor fees and tax. It applies to attributable top-ups and the first subscription payment. Review and pay commissions manually.

In **Billing admin → Payment reconciliation**, search a checkout reference, FlexPay sale ID or transaction ID. Filter by date received in UTC or by records needing review, then download the matching payment history as CSV. The data reflects signed payment events received by SatinLore. Compare deposits and payout fees in the merchant dashboard. Process refunds in FlexPay so the signed postback updates credits and commission in SatinLore.

## 3. Open the reader and activate billing

1. Complete the [reader opening steps](../deploy/cloudflare/public-reader.md). Protect founder, research, Alpha and beta routes and their Access audiences before removing the whole-host Access rule for the public app. Verify signup again in a fresh browser and confirm ordinary readers cannot reach the protected surfaces.
2. Add the approved live merchant credentials and exact signed production postback URL. After merchant tests and email delivery pass, enable `LAUNCH_BILLING_POSTBACK_ENABLED=true`, then `LAUNCH_BILLING_ENABLED=true`. Verify a controlled purchase and cancellation with the provider, check the settlement ledger, and reconcile the amount on the processor dashboard. The browser never submits card numbers to SatinLore.
3. When publishing the separate homepage redesign, link the primary CTA to [Create an account](https://app.satinlore.com/signup). Use `/login` for existing accounts and link to `/billing` from an offer or account page. Publish the approved copy and crawlable AO3 import, device setup and reading controls guides separately. Keep checkout and private account pages out of search indexing.
4. To pause purchases, set `LAUNCH_BILLING_ENABLED=false`. Leave signed postbacks and the ledger running while reconciling existing orders. To close public registration, restore the whole-host Access policy before switching `PUBLIC_READER_ENABLED` off. Keep account storage, the auth key and the commerce ledger intact.

The [Nocturne recognition and hardware gates](nocturne-release-qualification.md) are evaluated separately. Use only measured behavior in the launch copy.

## Reproduce the staging checks

```sh
python3 scripts/check.py
npm run build:worker
npm exec wrangler deploy -- --dry-run
node scripts/launch-browser-check.mjs
```

The Worker tests cover account state, signed provider callbacks, subscription periods, credits, promotions, affiliates, refunds and usage metering with synthetic services. The browser runner uses a disposable Worker SQLite store, a synthetic merchant, synthetic SES and model replies. Complete a separate provider acceptance run before enabling live payments.

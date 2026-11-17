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

Stock-up saves about 10% against the $5-per-$1 baseline. The monthly price is about five times its included model budget before taxes, processor fees, promotions and commissions. Guests can use the simulator and registration is free. Paid Nocturne access starts at zero credits.

Included credits from a subscription apply first and expire at the end of its paid period. Successful renewal gives that period a fresh 200 credits. Purchased top-ups carry over. Cancellation stops renewal through Verotel while the current paid period remains available. A checkout return displays pending until a signed provider payment confirmation arrives. Refunds and chargebacks reverse available credits and attributable commissions for the payment concerned.

The meter uses Standard GPT-6 Luna short-context input at $0.10 per million tokens, cached reads at $0.01 per million, and output at $0.50 per million. Output includes reported reasoning tokens. The Worker reserves an upper estimate before making an API call, then reconciles the reported usage. An ambiguous provider response retains its reserved cost. Request size and traffic ceilings also apply. Purchase amounts and balance records are held in integer nano-USD, so one dollar is 1,000,000,000 nano-USD and one displayed credit is 10,000,000. [Luna pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)

## 1. Review and deploy the reader Worker behind Access

1. Merge the tested launch changes into `main` when you are ready to deploy. Confirm Cloudflare deploys the `satinlore-private-app` Worker with its v6 Durable Object migration and the `COMMERCE` and `LAUNCH_USAGE` bindings. First keep the existing whole-host Cloudflare Access policy in place. Keep `LAUNCH_BILLING_ENABLED` false.
2. Follow the [reader rollout](../deploy/cloudflare/public-reader.md) for signup and email. In the SES region with a verified SatinLore sending identity, confirm production sending access and provision a dedicated IAM identity for `ses:SendEmail`. Add the region and From address as Worker variables. Add `AUTH_SES_ACCESS_KEY_ID`, `AUTH_SES_SECRET_ACCESS_KEY`, and the optional `AUTH_SES_SESSION_TOKEN` through **Settings → Variables & Secrets**. Keep the existing `PUBLIC_READER_OTP_KEY` if one is already in use. Its value also preserves account identities.
3. Keep a restricted OpenAI project key as the Worker secret `OPENAI_API_KEY` and set spend controls for that project. Enable `PUBLIC_READER_ENABLED=true` and `LAUNCH_AI_COST_METERING_ENABLED=true` together before opening the host. Keep `PRIVATE_APP_ENABLED`, `PUBLIC_APP_ORIGIN=https://app.satinlore.com`, SES delivery settings and the required production bindings in place. Check that a funded staging account can run Nocturne and that a new public account begins with zero paid credits.
4. Behind Access, use two browser profiles and a real inbox you control. Register at `/signup`, verify the email, and sign in at `/login`. Exercise password reset, password change and all-device sign-out. Verify that each ends the appropriate older sessions. Check the simulator, the account being able to see only its own saved stories and billing records, and the founder page rejecting an ordinary reader.

| Optional runtime variable | Default and purpose |
| --- | --- |
| `LAUNCH_AI_MONTHLY_CAP_NANO_USD` | `10000000000` gives each verified reader a $10 metered API spend cap per UTC calendar month across subscriptions and top-ups. It applies separately from the $2 allowance granted by each paid subscription period. |
| `LAUNCH_AI_TRIAL_NANO_USD` | `0` gives no free paid AI. If configured, the initial grant is established once per account. |
| `LAUNCH_AI_ACCOUNT_REQUESTS_PER_DAY` | `100` metered requests per account per UTC day. |
| `LAUNCH_AI_APP_REQUESTS_PER_DAY` | `1000` metered requests across public accounts per UTC day. |
| `LAUNCH_AI_APP_REQUESTS_PER_MONTH` | `15000` metered requests across public accounts per UTC month. |
| `LAUNCH_PLAN_CATALOG` | Leave unset for the four prices above. A staged custom USD catalog uses integer `amountMinor` in cents, `credits` in nano-USD, and `kind` as `monthly` or `one-time`. A monthly entry must grant exactly $2 of Luna spend. |

The older launch staging meter used raw tokens. Use the new cost-metering flag and variables. Any old raw-token ledger will require a deliberate migration for a pre-existing paid balance. This is relevant only if that earlier branch accepted orders.

## 2. Obtain merchant approval and test payments

1. Get written approval for SatinLore's product and pricing from an acquiring processor. The implemented adapter is **Verotel FlexPay v4**. Confirm that the account is eligible for both one-time credits and a USD recurring plan. Verotel lists FlexPay under Premium with processing-history and volume criteria. CCBill serves adult startups and would need its own integration if you choose it. [FlexPay](https://controlcenter.verotel.com/flexpay-doc/subscription.html) · [Verotel eligibility](https://www.verotel.com/en/productchoice.html) · [CCBill adult processing](https://ccbill.com/industries/adult-business)
2. In a separate test environment, set `VEROTEL_SHOP_ID` as a Worker variable and `VEROTEL_SIGNATURE_KEY` as a Worker secret. Enable `LAUNCH_BILLING_POSTBACK_ENABLED=true`. Configure Verotel signed v2 postbacks to the test equivalent of `https://app.satinlore.com/api/billing/verotel/postback`. Give processor servers access to that route without a customer session or a whole-host Access challenge. Keep the signature key on the server. Avoid logging postback query strings.
3. Confirm with the merchant that its checkout renders the correct currency, price and calendar-month recurrence (`P1M`), and that signed v2 callbacks include the expected ID, price and calendar fields. Exercise initial payment, decline, renewal, duplicate callback, retry extension, refund, chargeback, cancellation and expiry. Check that the return before a callback grants zero, the first charge grants 200 credits, retry extension grants zero, a successful renewal grants 200 for the next period, and a duplicate never grants extra. Check cancellation from the hosted link and confirm the subscription keeps access until the end of its paid period. [Verotel signed postbacks](https://controlcenter.verotel.com/flexpay-doc/postbacks.html)
4. Confirm offer, renewal and cancellation terms, tax display, and applicable age-assurance rules for the markets you plan to open. Signup records an 18+ declaration. [Ofcom age assurance](https://www.ofcom.org.uk/online-safety/protecting-children/age-assurance)
5. Protect `/billing-admin*` and `/api/billing-admin*` with the founder Access policy and its matching Worker audience before enabling `LAUNCH_BILLING_ADMIN_ENABLED=true`. The founder can set promotion limits, dates, affiliate codes and commission rates there. Promotions apply to one-time packs. Referral links use `/billing?ref=CODE`, retain first valid attribution for 30 days, and preserve it through registration. Commission uses the discounted amount after reversals before processor fees and tax. It applies to attributable top-ups and the first subscription payment. Review and pay commissions manually.

## 3. Open the reader and activate billing

1. Complete the [reader opening steps](../deploy/cloudflare/public-reader.md). Protect founder, research, Alpha and beta routes and their Access audiences before removing the whole-host Access rule for the public app. Verify signup again in a fresh browser and confirm ordinary readers cannot reach the protected surfaces.
2. Add the approved live merchant credentials and exact signed production postback URL. After merchant tests and email delivery pass, enable `LAUNCH_BILLING_POSTBACK_ENABLED=true`, then `LAUNCH_BILLING_ENABLED=true`. Verify a controlled purchase and cancellation with the provider, check the settlement ledger, and reconcile the amount on the processor dashboard. The browser never submits card numbers to SatinLore.
3. When publishing the separate homepage redesign, link the primary CTA to [Create an account](https://app.satinlore.com/signup?next=billing). Use `/login` for existing accounts. Publish the approved copy and crawlable guide pages separately. Keep checkout and private account pages out of search indexing.
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

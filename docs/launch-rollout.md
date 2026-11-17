# SatinLore launch rollout

The reader is deployed from `adharasi/SatinLore`. The public homepage is deployed from `adharasi/satinlore-website`. Both release candidates use `launch/accounts-usage-commerce`. Configure the reader, private beta and Stripe before adding purchase links to the public homepage.

## 1. Deploy the reader from the launch branch

1. In Cloudflare, select **Workers & Pages → satinlore-private-app → Settings → Builds → Branch control**. Select `launch/accounts-usage-commerce` as the production branch when ready. Deploy the tip of that branch and check its commit in **Deployments**. If changing the branch does not trigger a build, use the build dashboard to deploy that commit, or from the authenticated launch checkout run `npm ci --ignore-scripts`, `npm run build:worker`, then `npx wrangler deploy`. Check for both `COMMERCE` and `LAUNCH_USAGE` Durable Object bindings and the v6 migration. [Cloudflare Workers build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
2. Keep the existing whole-host Access policy during setup. In **Settings → Variables & Secrets**, keep `PRIVATE_APP_ENABLED=true`, `PUBLIC_APP_ORIGIN=https://app.satinlore.com`, and the existing authentication and Lovense bindings. Keep `LAUNCH_BILLING_ENABLED=false` while setting up. Keep `PUBLIC_READER_OTP_KEY` if it already exists. It also preserves account identities.
3. Follow the [email and reader setup](../deploy/cloudflare/public-reader.md). Confirm SES production sending in the verified region, set `PUBLIC_READER_ENABLED=true`, and configure the public AI meter in step 3 below. Check signup, inbox verification, login, password reset and all-device sign-out in two browser profiles. Physically check a supported device, including Pause and Stop. [Lovense runtime settings](../deploy/cloudflare/README.md)
4. Apply the private beta and founder Access policies below before you remove the whole-host Access policy from the public app. Preserve any existing policies for the separately hosted beta, Alpha, founder and research routes.

## 2. Configure private beta

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
7. Once those checks pass, remove only the whole-host Access destination for `app.satinlore.com` so guests can reach the reader. Keep the exact path policies and the separate `beta.satinlore.com` application. Verify `/signup` and `/login` again from a fresh browser.

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
3. In **Stripe → Workbench → Webhooks**, add an account event destination for the sandbox equivalent of `https://app.satinlore.com/api/billing/stripe/webhook`. Use API version `2024-06-20`. Choose the event types below. Copy the endpoint-specific signing secret. The exact webhook path must be reachable by Stripe without a reader session or an Access prompt. Keep Access on founder and beta paths. [Stripe webhooks](https://docs.stripe.com/webhooks)

   Subscribe to `payment_intent.succeeded`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`, `refund.created`, `refund.updated`, and `charge.dispute.closed`. A lost dispute reverses the applicable credits and commissions after Stripe closes it.

4. In the reader Worker **Variables & Secrets**, set:

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

1. Open **Workers & Pages → satinlore-website → Settings → Builds → Branch control** in Cloudflare and select the marketing repository branch `launch/accounts-usage-commerce`. This is a separate Worker from the reader. Its configuration binds both `satinlore.com` and `launch.satinlore.com`, and a normal branch push to a non-production branch does not publish to them.
2. After testing reader signup, set `MARKETING_LAUNCH_ENABLED=true` in the marketing Worker's **Variables & Secrets**. Keep `MARKETING_BILLING_ENABLED=false` until you have activated and tested live Stripe checkout. Trigger or confirm the production deployment from the launch branch. Check the public homepage, account and sign-in buttons, privacy links, waitlist destination and canonical URL. [Cloudflare Workers build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
3. After verified live billing, set `MARKETING_BILLING_ENABLED=true` so the public plans button links to the reader's protected billing area. Verify prices agree with the checkout. To pause purchases, switch this off, set `LAUNCH_BILLING_ENABLED=false` on the reader and leave webhooks enabled so existing payments and refunds continue to reconcile.

The [Nocturne recognition and hardware gates](nocturne-release-qualification.md) apply separately. Keep the app's private and billing pages out of search indexing.

## Local checks

```sh
python3 scripts/check.py
npm run build:worker
npm exec wrangler deploy -- --dry-run
node scripts/launch-browser-check.mjs
```

These checks use synthetic inputs and payment fixtures. Run the separate merchant and hardware acceptance checks before opening paid playback on the production Worker.

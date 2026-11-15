# SatinLore launch staging

This branch adds accounts, metered AI access and one-time purchases to the reader Worker. The marketing website lives separately. The homepage design draft is an unpublished preview. It offers original SatinLore copy, an interactive simulator illustration, compatibility and privacy sections, FAQs, and editorial space for AO3 import, Lovense setup and simulator guides.

## Reader and founder workflows

| Surface | Intended behavior |
| --- | --- |
| Reader account | Guests can try the simulator. Account signup uses a password, 18+ declaration and email ownership verification. Verified readers can reset or change their password and sign out every session. Changing a password revokes existing sessions and pending reset challenges. |
| `/billing` | A verified reader sees remaining AI credits and the current UTC-month limit. Checkout needs a server-priced one-time pack and supports a promo code. The provider return shows pending until a trusted payment confirmation arrives. |
| `/billing-admin` | A verified Cloudflare Access founder can create, update or disable promotions and affiliate codes, copy referral links and inspect recent order and commission records. A public-reader cookie cannot authorize this page or its API. |
| Affiliate attribution | The affiliate URL is `/billing?ref=CODE`. Signup and sign-in preserve the code during that journey. The first valid referral attached to checkout is retained for 30 days server-side. Commission uses the discounted order amount after customer reversals and before processor fees and tax. Payouts require manual reconciliation. |
| Payment | Verotel FlexPay is the implemented hosted adapter. A signed v2 postback must match the order, merchant, currency, provider transaction and sale ID. Card-entry takes place on the processor's site. The ledger limits each account to three open checkout holds, each valid for 30 minutes. Duplicate payments do not create extra credits. Refunds and chargebacks reverse attributable credits and commissions. A separate flag can suspend new purchases while signed events still reconcile. |

Credits are consumed by the provider's input and output tokens, including reasoning included in the reported total. The ledger reserves a conservative token amount before dispatch and enforces both the credit balance and monthly cap. A request known to be unsent releases its hold. Missing or ambiguous provider usage consumes the original reservation. A verified report can settle the same held attempt. A one-time trial grant is pinned when a verified account first opens a configured ledger. Set it to zero for launch without a trial. The existing per-reader and global request budgets still apply. This is separate from the founder benchmark and existing research spend controls.

## Configure an isolated staging environment

Use separate storage, an approved test merchant and a separate SES identity and model project if testing those providers. The Worker checks the exact app origin. Browser fixtures exercise that production contract with synthetic services. An internet-accessible staging deployment requires dedicated host configuration and restricted edge access. Keep production flags off while testing.

| Setting | Where and what to supply |
| --- | --- |
| `PUBLIC_READER_ENABLED`, `PRIVATE_APP_ENABLED`, `PUBLIC_APP_ORIGIN` | Existing [reader rollout instructions](../deploy/cloudflare/public-reader.md). Verify signup, verification, login, reset and cross-device revocation before making checkout available. |
| `PUBLIC_READER_OTP_KEY`, `AUTH_SES_ACCESS_KEY_ID`, `AUTH_SES_SECRET_ACCESS_KEY` and optional `AUTH_SES_SESSION_TOKEN` | Worker secrets. Set SES origin, region and verified From address per the reader rollout. Test delivery and bounce handling with a real staging inbox. |
| `OPENAI_API_KEY` | Restricted project key as a Worker secret. Keep the existing budget store and project spend controls. A user's project key never enters browser code. |
| `LAUNCH_AI_USAGE_ENABLED`, `LAUNCH_AI_MONTHLY_TOKEN_CAP`, `LAUNCH_AI_TRIAL_TOKENS` | Turn on metering only with a confirmed positive monthly ceiling. Choose the optional one-time trial in tokens, default zero. Existing unmetered behavior continues with the feature flag unset. |
| `LAUNCH_PLAN_CATALOG` | Worker variable containing an approved JSON array of packs. Each entry uses `id`, `name`, `currency`, integer `amountMinor` and integer `credits`. No production amounts or credit quantities are preset. |
| `VEROTEL_SHOP_ID`, `VEROTEL_SIGNATURE_KEY` | Confirmed merchant site ID and a server-only Worker secret. Ask the processor to confirm signed purchase, credit and chargeback postbacks (including v2 transaction and parent IDs), minimum order amount and the duplicate-reference/retry contract. |
| `LAUNCH_BILLING_ADMIN_ENABLED` | Enable founder campaign administration only after a valid Access audience protects `/billing-admin*` and `/api/billing-admin*` at the edge and in the Worker. |
| `LAUNCH_BILLING_POSTBACK_ENABLED`, `LAUNCH_BILLING_ENABLED` | Start with the postback flag. Make only `/api/billing/verotel/postback` reachable by processor servers without a reader session. Keep keys in the Worker and do not log the postback query. Enable purchases after staging accounting and merchant tests. |

The v6 SQLite migration adds separate commerce and AI usage Durable Object bindings. Verify it through a Worker dry run and a separate staging deployment before production changes. For a purchase incident, turn off new checkout first and preserve postbacks and the settlement ledger for reconciliation. Order totals, opaque merchant references and attributed commission need a documented retention and refund process, including after reader account deletion.

## Provider and release decisions

- Verotel documents signed FlexPay for prepaid credits, but lists it as Premium-only with processing-history and minimum-volume requirements. Obtain acceptance and merchant test credentials before enabling this adapter. CCBill explicitly serves adult startups and is a stronger underwriting route if Verotel's requirements rule it out. Its Webhooks and reconciliation contract would need a separate adapter and test. [Verotel FlexPay](https://controlcenter.verotel.com/flexpay-doc/purchase.html) · [Verotel eligibility](https://www.verotel.com/en/productchoice.html) · [CCBill adult processing](https://ccbill.com/industries/adult-business)
- Approve currency, pack prices, token allowance, tax display, credit/refund terms and affiliate commission rules before publishing plans. Recurring renewals and automatic affiliate payouts are outside the one-time pack integration.
- Check the product's launch scope and any applicable age-assurance requirements with the exact product and markets. The account checkbox records a self-declaration. [Ofcom](https://www.ofcom.org.uk/online-safety/protecting-children/age-assurance)
- Keep the live marketing site separately managed. On an approved rollout, connect the draft's signup CTA to the real reader, confirm availability copy, publish dedicated crawlable pages for the three guide topics and add the approved URLs to the marketing sitemap. Decide the indexed canonical URL, social metadata and internal links during that publication. Keep billing and account pages out of search indexing.
- [Nocturne recognition and hardware gates](nocturne-release-qualification.md) are separate from working account and billing flows. Describe the simulator, supported setup and AI behavior within the evidence already measured.

## Reproduce local tests

```sh
python3 scripts/check.py
npm run build:worker
npm exec wrangler deploy -- --dry-run
node scripts/launch-browser-check.mjs
```

The browser test uses Chromium with a synthetic merchant, synthetic SES and model replies, and isolated Worker SQLite. The account, billing and token tests can also run directly with `node --test tests/public-auth.test.mjs tests/public-account-ui.test.mjs tests/launch-billing-worker.test.mjs tests/commerce.test.mjs tests/launch-usage.test.mjs`.

The managed Chromium rehearsal on 15 November 2026 created a test promotion and referral, registered a disposable reader, verified the mock email, signed in and returned to the referral. The fixture quote discounted £10.00 to £8.00. Repeated signed payment callbacks granted exactly 30,000 fixture credits once. The fixture refund returned credits to zero and reversed the £1.60 attributed commission. All-device sign-out returned the reader to the sign-in form. The standalone draft's simulator, zero ceiling, Stop preview, AO3 guide and local-only signup control were exercised separately. The direct terminal browser runner was blocked by the workspace's Chromium process restrictions. The managed browser journey covered the stated UI actions, and the Worker tests covered token reservations, concurrency and usage settlement with synthetic provider responses.

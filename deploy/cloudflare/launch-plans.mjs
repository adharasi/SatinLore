// USD price is in cents. The provider-cost balance is tracked in nano dollars.
const credit = 10_000_000;
export const MONTHLY_PERIOD = "P1M";
export const LAUNCH_PLANS = Object.freeze([
  {id: "monthly", name: "SatinLore Monthly", kind: "monthly", currency: "USD", amountMinor: 999, credits: 200 * credit},
  {id: "starter-top-up", name: "Starter Top-up", kind: "one-time", currency: "USD", amountMinor: 499, credits: 100 * credit},
  {id: "plus-top-up", name: "Plus Top-up", kind: "one-time", currency: "USD", amountMinor: 949, credits: 200 * credit},
  {id: "stock-up", name: "Stock-up", kind: "one-time", currency: "USD", amountMinor: 1799, credits: 400 * credit},
].map(plan => Object.freeze(plan)));

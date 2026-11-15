const node = id => document.getElementById(id);
const status = node("admin-status"), promotion = node("promotion-form"), affiliate = node("affiliate-form");
let busy = false;

async function call(path = "", body) {
  const response = await fetch(`/api/billing-admin${path}`, {
    credentials: "same-origin", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
    ...(body ? {method: "POST", body: JSON.stringify(body), headers: {"Content-Type": "application/json"}} : {}),
  });
  if (!response.ok) throw new Error(response.status === 403 ? "Sign in through founder access." : "The billing request could not be confirmed.");
  return response.json();
}

const dateValue = value => new Date(value).toISOString().slice(0, 16);
const money = (currency, minor) => new Intl.NumberFormat(undefined, {style: "currency", currency}).format(minor / 100);

function fill(form, values) {
  for (const [name, value] of Object.entries(values)) {
    const input = form.elements.namedItem(name);
    if (typeof value === "boolean") input.checked = value;
    else input.value = value;
  }
  form.elements.namedItem("code").focus();
}

function render(id, entries, content) {
  const list = node(id);
  list.replaceChildren();
  for (const entry of entries) {
    const item = document.createElement("li");
    item.append(...content(entry));
    list.append(item);
  }
  if (!entries.length) {
    const item = document.createElement("li");
    item.textContent = "No records yet.";
    list.append(item);
  }
}

function edit(action) {
  const button = document.createElement("button");
  button.type = "button"; button.textContent = "Edit"; button.addEventListener("click", action);
  return button;
}

async function reload() {
  const {promotions, affiliates, checkouts} = await call();
  render("promotions-list", promotions, row => [
    `${row.code} · ${row.discountBps / 100}% off · ${row.claimed}/${row.maxRedemptions} claimed · ${row.enabled ? "Active" : "Disabled"} `,
    edit(() => fill(promotion, {code: row.code, percent: row.discountBps / 100, limit: row.maxRedemptions,
      planId: row.planId ?? "", from: dateValue(row.validFrom), until: dateValue(row.validUntil), enabled: row.enabled})),
  ]);
  render("affiliates-list", affiliates, row => {
    const link = document.createElement("a");
    const path = `/billing?ref=${encodeURIComponent(row.code)}`;
    link.href = path; link.textContent = new URL(path, window.location.origin).href;
    return [`${row.code} · ${row.commissionBps / 100}% · ${row.enabled ? "Active" : "Disabled"} · `, link, " ",
      edit(() => fill(affiliate, {code: row.code, percent: row.commissionBps / 100, enabled: row.enabled}))];
  });
  render("orders-list", checkouts, row => [
    `${row.id} · ${row.planId} · ${row.status} · ${money(row.currency, row.amountMinor)} · ${row.grantedCredits} credits` +
    (row.affiliateCode ? ` · ${row.affiliateCode}: ${money(row.currency, row.commissionMinor)} commission` : "") +
    (row.reviewReason ? ` · Review: ${row.reviewReason}` : ""),
  ]);
}

async function perform(action, completed = "") {
  if (busy) return;
  busy = true; status.textContent = "Working…";
  try { await action(); status.textContent = completed; }
  catch (error) { status.textContent = error.message; }
  finally { busy = false; }
}
promotion.addEventListener("submit", event => {
  event.preventDefault();
  const data = new FormData(promotion), planId = data.get("planId").trim();
  return perform(async () => {
    await call("/promotion", {code: data.get("code").trim(), discountBps: Math.round(Number(data.get("percent")) * 100),
      maxRedemptions: Number(data.get("limit")), validFrom: Date.parse(`${data.get("from")}Z`),
      validUntil: Date.parse(`${data.get("until")}Z`), enabled: data.has("enabled"), ...(planId ? {planId} : {})});
    await reload();
  }, "Promotion saved.");
});
affiliate.addEventListener("submit", event => {
  event.preventDefault();
  const data = new FormData(affiliate);
  return perform(async () => {
    await call("/affiliate", {code: data.get("code").trim(), commissionBps: Math.round(Number(data.get("percent")) * 100),
      enabled: data.has("enabled")});
    await reload();
  }, "Affiliate saved.");
});
node("reload-billing").addEventListener("click", () => void perform(reload));
await perform(reload);

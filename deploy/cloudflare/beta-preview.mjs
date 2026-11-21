import { ACCOUNT_ROUTES } from "./accounts.mjs";
import { BETA_ONLY_ASSET_PATHS, PRIVATE_ASSET_PATHS } from "./assets.mjs";
import { BILLING_API, BILLING_ADMIN_API } from "./launch-billing.mjs";
import { LAUNCH_USAGE_PATH } from "./launch-usage.mjs";
import { APP_ORIGIN, BETA_READER_COOKIE } from "./public-auth.mjs";
import { STRIPE_WEBHOOK_PATH } from "./stripe-billing.mjs";
import { createPrivateAppWorker, privateAppConfiguration, verifyFounder } from "./worker.mjs";

export { PrivateFeedback, ReaderAccount, SceneAnalysisBudget, PublicReaderAuth, SatinLoreCommerce, LaunchUsage } from "./worker.mjs";

const PREFIX = "/beta";
const SIMULATOR = `${PREFIX}/simulator`;
const SESSION = `${BETA_READER_COOKIE}=`;
const SESSION_VALUE = /^[a-f0-9]{64}$/u;
const SESSION_COOKIE = /^(?:[a-f0-9]{64})?; Path=\/beta; Secure; HttpOnly; SameSite=Lax(?:; Max-Age=\d+)?$/u;
const STATIC_PATHS = PRIVATE_ASSET_PATHS.filter(path => path.startsWith("/static/") && !path.startsWith("/static/beta-admin"));
const SIMULATOR_STATIC = new Set(STATIC_PATHS.filter(path => !path.startsWith("/static/billing")));
const APP_STATIC = new Set(STATIC_PATHS.filter(path => !BETA_ONLY_ASSET_PATHS.includes(path)));
const ADMIN_DOCUMENTS = new Set(["/billing-admin", "/billing-admin.html", "/billing-admin/app.mjs"]);
const APP_PATHS = new Set([
  "/", "/index.html", "/signup", "/login", "/help", "/help.html", "/support", "/feedback.html",
  "/billing", "/billing.html", "/device-bridge", "/device-bridge.html",
  "/api/access", "/api/health", "/api/feedback", "/api/my-data", "/api/my-data/delete", "/api/story-import",
  "/api/scene-analysis", "/api/lovense/status", "/api/lovense/session", LAUNCH_USAGE_PATH, ...ACCOUNT_ROUTES,
  ...["plans", "quote", "checkout", "order", "subscription", "cancel-subscription"].map(path => `${BILLING_API}/${path}`),
]);

function simulatorPath(path) {
  if (path === SIMULATOR || path === `${SIMULATOR}/`) return PREFIX;
  if (path === `${PREFIX}/simulator-lab`) return `${PREFIX}/simulator-lab`;
  if (path === `${SIMULATOR}/api/access`) return `${PREFIX}/api/access`;
  const asset = path.slice(SIMULATOR.length);
  return path.startsWith(`${SIMULATOR}/static/`) && SIMULATOR_STATIC.has(asset) ? `${PREFIX}${asset}` : null;
}

function delegateRequest(request, url, path, { webhook = false } = {}) {
  const headers = new Headers(request.headers);
  const cookies = (headers.get("Cookie") || "").split(";").map(value => value.trim())
    .filter(value => value.startsWith(SESSION));
  headers.delete("Cookie");
  if (!webhook && cookies.length === 1 && SESSION_VALUE.test(cookies[0].slice(SESSION.length))) {
    headers.set("Cookie", cookies[0]);
  }
  if (webhook) headers.delete("Cf-Access-Jwt-Assertion");
  url.pathname = path;
  return new Request(url, new Request(request, { headers }));
}

function previewLocation(value, base) {
  try {
    const url = new URL(value, base);
    if (url.origin !== APP_ORIGIN || url.username || url.password) return null;
    const path = url.pathname.startsWith(`${PREFIX}/`) ? url.pathname :
      url.pathname === PREFIX ? `${PREFIX}/` : `${PREFIX}${url.pathname}`;
    return `${path}${url.search}${url.hash}`;
  } catch { return null; }
}

function previewResponse(response, request, { base, webhook = false } = {}) {
  const headers = new Headers(response.headers);
  const cookies = headers.getSetCookie?.() ?? headers.getAll("Set-Cookie");
  headers.delete("Set-Cookie");
  if (!webhook && cookies.length === 1 && cookies[0].startsWith(SESSION) && SESSION_COOKIE.test(cookies[0].slice(SESSION.length))) {
    headers.set("Set-Cookie", cookies[0]);
  }
  const location = headers.get("Location");
  if (location) {
    const scoped = previewLocation(location, base ?? request.url);
    if (!scoped) return unavailable(request, 502, "The beta redirect is unavailable.");
    headers.set("Location", scoped);
  }
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status, statusText: response.statusText, headers,
  });
}

function unavailable(request, status, error, headers) {
  return previewResponse(Response.json({ error }, { status, headers }), request);
}

export function createBetaPreviewWorker(options = {}) {
  const app = createPrivateAppWorker(options);
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const { pathname } = url;
      if (url.origin !== APP_ORIGIN || (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`))) {
        return unavailable(request, 404, "Not found.");
      }

      const path = pathname.slice(PREFIX.length) || "/";
      const webhook = path === STRIPE_WEBHOOK_PATH;
      const simulator = simulatorPath(pathname);
      const admin = ADMIN_DOCUMENTS.has(path) || path === BILLING_ADMIN_API || path.startsWith(`${BILLING_ADMIN_API}/`);
      if (!webhook && !simulator && !admin && !APP_PATHS.has(path) && !APP_STATIC.has(path) &&
          !/^\/api\/auth\/[a-z-]+$/u.test(path)) return unavailable(request, 404, "Not found.");
      const config = privateAppConfiguration(env, APP_ORIGIN, { appBeta: true });
      if (!config) return unavailable(request, 503, "Beta testing is temporarily unavailable.");

      if (webhook) {
        if (request.method !== "POST") return unavailable(request, 405, "Use POST for Stripe events.", { Allow: "POST" });
        if (url.search) return unavailable(request, 400, "The Stripe webhook does not accept a query string.");
      } else {
        const session = await verifyFounder(request, config, options.keyResolver);
        if (!session || (admin && !session.isFounder)) {
          return unavailable(request, 403, admin ? "Founder access required." : "Beta tester access required.");
        }
        if (pathname === PREFIX && ["GET", "HEAD"].includes(request.method)) {
          return previewResponse(new Response(null, { status: 302, headers: { Location: `${PREFIX}/${url.search}` } }), request);
        }
        if (!simulator && !admin && env.PUBLIC_READER_ENABLED !== "true") {
          return unavailable(request, 503, "Beta account sign-in is temporarily unavailable.");
        }
      }

      // Staging cannot use a production OpenAI key or send live Stripe requests.
      // Inherited email, billing and optional beta AI flags remain operator-controlled.
      const { OPENAI_API_KEY, ...bindings } = env;
      const stage = { ...bindings, BETA_PREVIEW_PREFIX: PREFIX, LAUNCH_PAYMENT_PROVIDER: "stripe", STRIPE_MODE: "test" };
      if (!simulator) stage.ACCESS_AUD = config.audience;
      const delegated = delegateRequest(request, url, simulator ?? path, { webhook });
      return previewResponse(await app.fetch(delegated, stage, ctx), request, { base: delegated.url, webhook });
    },
  };
}

export default createBetaPreviewWorker();

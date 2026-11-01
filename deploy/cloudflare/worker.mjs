import { createRemoteJWKSet, jwtVerify } from "jose";
import { PRIVATE_ASSET_PATHS, PRIVATE_DOCUMENT_ROUTES } from "./assets.mjs";
import { feedbackJson, normalizeFeedback, FeedbackError } from "./feedback.mjs";
export { PrivateFeedback } from "./feedback.mjs";

const APP_ORIGIN = "https://app.satinlore.com";
const ASSET_PATHS = new Set(PRIVATE_ASSET_PATHS);
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[a-zA-Z]{2,}$/;
const cachedKeys = new Map();
const FEEDBACK_METHODS = new Map([
  ["/api/feedback", ["GET", "POST"]], ["/api/my-data", ["GET"]], ["/api/my-data/delete", ["POST"]],
]);
const CONTENT_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

/** No production defaults can turn a missing Access configuration into a public app. */
export function privateAppConfiguration(env) {
  if (env.PRIVATE_APP_ENABLED !== "true" || env.PUBLIC_APP_ORIGIN !== APP_ORIGIN) return null;
  const team = typeof env.ACCESS_TEAM_DOMAIN === "string" ? env.ACCESS_TEAM_DOMAIN.trim().toLowerCase() : "";
  const audience = typeof env.ACCESS_AUD === "string" ? env.ACCESS_AUD.trim() : "";
  const email = typeof env.FOUNDER_EMAIL === "string" ? env.FOUNDER_EMAIL.trim().toLowerCase() : "";
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(team)) return null;
  if (!/^[a-f0-9]{64}$/.test(audience) || /^0+$/.test(audience)) return null;
  if (!EMAIL.test(email) || email.length > 254) return null;
  return { origin: APP_ORIGIN, issuer: `https://${team}`, audience, email };
}

function secure(response, { head = false } = {}) {
  const result = new Response(head ? null : response.body, response);
  result.headers.set("Cache-Control", "no-store");
  result.headers.set("Referrer-Policy", "no-referrer");
  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("X-Frame-Options", "DENY");
  result.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  result.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  result.headers.set("Content-Security-Policy", CONTENT_POLICY);
  return result;
}

function json(body, status = 200) { return Response.json(body, { status }); }

/** Resolver injection is used by signed-token tests; the deployed export always fetches fixed-team keys. */
export async function verifyFounder(request, config, keyResolver) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 16_384) return null;
  try {
    let keys = keyResolver;
    if (!keys) {
      keys = cachedKeys.get(config.issuer);
      if (!keys) {
        keys = createRemoteJWKSet(new URL(`${config.issuer}/cdn-cgi/access/certs`), {
          timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 600_000,
        });
        if (cachedKeys.size >= 4) cachedKeys.clear();
        cachedKeys.set(config.issuer, keys);
      }
    }
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ["RS256"], issuer: config.issuer, audience: config.audience,
      requiredClaims: ["exp", "iat", "sub", "email"],
    });
    const now = Math.floor(Date.now() / 1000);
    if (payload.type !== "app" || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 512) return null;
    if (typeof payload.email !== "string" || !EMAIL.test(payload.email) || payload.email.toLowerCase() !== config.email) return null;
    if (!Number.isSafeInteger(payload.iat) || payload.iat > now + 30 || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.exp * 1000)) return null;
    return { expiresAt: payload.exp * 1000, subject: payload.sub };
  } catch {
    // Never echo tokens, claims, key URLs or verification exceptions.
    return null;
  }
}

export function createPrivateAppWorker({ keyResolver } = {}) {
  return {
    async fetch(request, env) {
      const head = request.method === "HEAD";
      const finish = response => secure(response, { head });
      const config = privateAppConfiguration(env);
      if (!config) return finish(json({ error: "The private preview is not available." }, 503));
      const url = new URL(request.url);
      // A valid token must not make workers.dev, version URLs or another hostname an origin bypass.
      if (url.origin !== config.origin) return finish(json({ error: "Founder access required." }, 403));
      const session = await verifyFounder(request, config, keyResolver);
      if (!session) return finish(json({ error: "Founder access required." }, 403));
      if (FEEDBACK_METHODS.has(url.pathname)) {
        const allowed = FEEDBACK_METHODS.get(url.pathname);
        if (!allowed.includes(request.method)) {
          const response = json({ error: "This action is not available." }, 405);
          response.headers.set("Allow", allowed.join(", "));
          return finish(response);
        }
        if (request.method === "POST" && (request.headers.get("Origin") !== config.origin ||
            ["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site")))) {
          return finish(json({ error: "Please use the form on the SatinLore app." }, 403));
        }
        if (!env.PRIVATE_FEEDBACK || typeof env.PRIVATE_FEEDBACK.idFromName !== "function" || typeof env.PRIVATE_FEEDBACK.get !== "function") {
          return finish(json({ error: "Feedback is temporarily unavailable. Your note has not been confirmed as sent." }, 503));
        }
        try {
          let payload;
          if (request.method === "POST") {
            const value = await feedbackJson(request);
            if (url.pathname === "/api/feedback") payload = normalizeFeedback(value);
            else {
              if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || value.confirm !== true) {
                return finish(json({ error: "Confirm deletion before removing your app feedback." }, 400));
              }
              payload = { confirm: true };
            }
          }
          if (Date.now() >= session.expiresAt) return finish(json({ error: "Founder access required." }, 403));
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`satinlore:feedback:v1:${config.audience}:${session.subject}`));
          const name = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
          const stub = env.PRIVATE_FEEDBACK.get(env.PRIVATE_FEEDBACK.idFromName(name));
          // The durable store receives no identity, cookies, JWTs, query values or automatic story context.
          const headers = new Headers({ Origin: config.origin });
          if (payload !== undefined) headers.set("Content-Type", "application/json");
          return finish(await stub.fetch(new Request(`https://feedback.internal${url.pathname}`, {
            method: request.method, headers, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
          })));
        } catch (error) {
          if (error instanceof FeedbackError) return finish(json({ error: error.message }, error.status));
          return finish(json({ error: "Feedback is temporarily unavailable. Please retry the same note." }, 503));
        }
      }
      if (!["GET", "HEAD"].includes(request.method)) {
        const denied = json({ error: "This preview is read-only." }, 405);
        denied.headers.set("Allow", "GET, HEAD");
        return finish(denied);
      }
      if (url.pathname === "/api/access") return finish(json({ authenticated: true, expiresAt: session.expiresAt }));
      if (url.pathname === "/api/health") return finish(json({ status: "ok", device_mode: "simulator", beta_ready: false }));
      const path = PRIVATE_DOCUMENT_ROUTES[url.pathname] ?? url.pathname;
      if (!ASSET_PATHS.has(path)) return finish(json({ error: "This page is not part of the private simulator." }, 404));
      if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") return finish(json({ error: "The private preview is not available." }, 503));
      try {
        const assetUrl = new URL(path, config.origin);
        // No bearer assertion, cookies, user query values or reader content enter an asset request.
        const asset = await env.ASSETS.fetch(new Request(assetUrl, { method: request.method }));
        if (asset.status !== 200) return finish(json({ error: "The preview asset is unavailable." }, 404));
        return finish(asset);
      } catch {
        return finish(json({ error: "The preview asset is unavailable." }, 503));
      }
    },
  };
}

export default createPrivateAppWorker();

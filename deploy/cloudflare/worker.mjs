import { createRemoteJWKSet, jwtVerify } from "jose";
import { PRIVATE_ASSET_PATHS, PRIVATE_DOCUMENT_ROUTES, ALPHA_STATIC_PATHS } from "./assets.mjs";
import { feedbackJson, normalizeFeedback, normalizeFeedbackReview, FeedbackError, FEEDBACK_INBOX_NAME } from "./feedback.mjs";
import { storyImportJson, importPublicStory, StoryImportError } from "./story-import.mjs";
import { emptyLovenseRequest, issueLovenseToken, lovenseConfiguration, lovenseReadiness, lovenseIdentity, LovenseServiceError } from "./lovense.mjs";
import { handleAccount } from "./accounts.mjs";
import { handleBetaRecordings } from "./beta-recordings.mjs";
import { alphaConfigured, handleAlphaApi, verifyAlphaSession } from "./alpha-study.mjs";
import { handleDecisionsBenchmark, handleSceneAnalysis } from "./scene-analysis.mjs";
import { APP_ORIGIN, handlePublicAuth, publicReaderConfiguration, revokePublicReader, verifyPublicReader } from "./public-auth.mjs";
export { PrivateFeedback } from "./feedback.mjs";
export { ReaderAccount } from "./accounts.mjs";
export { BetaRecordings } from "./beta-recordings.mjs";
export { AlphaStudy } from "./alpha-study.mjs";
export { SceneAnalysisBudget } from "./scene-analysis.mjs";
export { PublicReaderAuth } from "./public-auth.mjs";

export const BETA_ORIGIN = "https://beta.satinlore.com";
const ASSET_PATHS = new Set(PRIVATE_ASSET_PATHS);
const ALPHA_ASSET_PATHS = new Set(ALPHA_STATIC_PATHS);
const ALPHA_ADMIN_PATHS = new Set(["/admin", "/admin/"]);
const ALPHA_ADMIN_ASSETS = new Set(["/alpha/static/alpha-admin.mjs", "/alpha/static/alpha-admin.css"]);
const BETA_ADMIN_PATHS = new Set(["/admin", "/admin/", "/beta-admin.html", "/static/beta-admin.mjs", "/static/beta-admin.css"]);
const PUBLIC_DOCUMENTS = new Set(["/index.html", "/help.html", "/feedback.html", "/simulation.html"]);
const PUBLIC_ASSET_PATHS = new Set(PRIVATE_ASSET_PATHS.filter(path => PUBLIC_DOCUMENTS.has(path) ||
  (path.startsWith("/static/") && !BETA_ADMIN_PATHS.has(path))));
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[a-zA-Z]{2,}$/;
const cachedKeys = new Map();
const FEEDBACK_METHODS = new Map([
  ["/api/feedback", ["GET", "POST"]], ["/api/my-data", ["GET"]], ["/api/my-data/delete", ["POST"]],
]);
const FEEDBACK_ADMIN_PATHS = new Map([
  ["/feedback-admin", "/feedback-admin/index.html"],
  ["/feedback-admin/", "/feedback-admin/index.html"],
  ["/feedback-admin/index.html", "/feedback-admin/index.html"],
  ["/feedback-admin/review.mjs", "/feedback-admin/review.mjs"],
]);
const CONTENT_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: https://*.lovense-api.com https://*.lovense.com; font-src 'self'; frame-src https://app.satinlore.com/device-bridge https://app.satinlore.com/device-bridge.html; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const BRIDGE_VENDOR_HTTPS = "https://*.lovense.com https://*.lovense-api.com https://*.lovense.club:*";
const BRIDGE_VENDOR_WSS = "wss://*.lovense.com wss://*.lovense-api.com wss://*.lovense.club:*";

/** No production defaults can turn a missing Access configuration into a public app. */
export function privateAppConfiguration(env, origin = APP_ORIGIN) {
  if (env.PRIVATE_APP_ENABLED !== "true" || env.PUBLIC_APP_ORIGIN !== APP_ORIGIN) return null;
  if (![APP_ORIGIN, BETA_ORIGIN].includes(origin)) return null;
  const team = typeof env.ACCESS_TEAM_DOMAIN === "string" ? env.ACCESS_TEAM_DOMAIN.trim().toLowerCase() : "";
  // The same Access application can cover both hostnames. A separate beta
  // application may instead supply its own exact audience without accepting
  // both audiences on either hostname.
  const configuredAudience = origin === BETA_ORIGIN && env.BETA_ACCESS_AUD !== undefined ? env.BETA_ACCESS_AUD : env.ACCESS_AUD;
  const audience = typeof configuredAudience === "string" ? configuredAudience.trim() : "";
  const email = typeof env.FOUNDER_EMAIL === "string" ? env.FOUNDER_EMAIL.trim().toLowerCase() : "";
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(team)) return null;
  if (!/^[a-f0-9]{64}$/.test(audience) || /^0+$/.test(audience)) return null;
  if (!EMAIL.test(email) || email.length > 254) return null;
  const testerValue = env.BETA_TESTER_EMAILS;
  if (testerValue !== undefined && (typeof testerValue !== "string" || testerValue.length > 6000)) return null;
  const testerEmails = (testerValue || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  if (testerEmails.length > 20 || testerEmails.some(value => value.length > 254 || !EMAIL.test(value))) return null;
  return { origin, issuer: `https://${team}`, audience, email,
    ...(origin === BETA_ORIGIN ? { beta: true } : {}),
    ...(testerEmails.length ? { testerEmails: [...new Set(testerEmails)] } : {}) };
}

function secure(response, { head = false, bridgeHash = null, origin = APP_ORIGIN, alphaPage = false, alphaAdmin = false } = {}) {
  const result = new Response(head ? null : response.body, response);
  result.headers.set("Cache-Control", "no-store");
  result.headers.set("Referrer-Policy", "no-referrer");
  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("X-Frame-Options", bridgeHash ? "SAMEORIGIN" : "DENY");
  result.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  result.headers.set("Permissions-Policy", `camera=(), microphone=(), geolocation=(), display-capture=${alphaPage ? "(self)" : "()"}`);
  let pagePolicy = CONTENT_POLICY.replaceAll(APP_ORIGIN, origin);
  if (alphaPage || alphaAdmin) pagePolicy += "; media-src 'self' blob:";
  if (alphaPage) pagePolicy = pagePolicy.replace(/frame-src [^;]+/, `frame-src ${APP_ORIGIN}/alpha/device-bridge`);
  result.headers.set("Content-Security-Policy", bridgeHash ?
    `default-src 'none'; sandbox allow-scripts; script-src 'sha256-${bridgeHash}' https://*.lovense.com https://*.lovense-api.com; connect-src ${BRIDGE_VENDOR_HTTPS} ${BRIDGE_VENDOR_WSS}; img-src ${BRIDGE_VENDOR_HTTPS}; object-src 'none'; frame-ancestors ${origin}; base-uri 'none'; form-action 'none'` : pagePolicy);
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
    if (typeof payload.email !== "string" || !EMAIL.test(payload.email) ||
        ![config.email, ...(config.testerEmails || [])].includes(payload.email.toLowerCase())) return null;
    if (!Number.isSafeInteger(payload.iat) || payload.iat > now + 30 || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.exp * 1000)) return null;
    return { expiresAt: payload.exp * 1000, subject: payload.sub,
      email: payload.email.toLowerCase(), isFounder: payload.email.toLowerCase() === config.email };
  } catch {
    // Never echo tokens, claims, key URLs or verification exceptions.
    return null;
  }
}

async function handleLovense(request, env, { config, session, reverify, lovenseFetcher }) {
  const url = new URL(request.url);
  const finish = response => secure(response, { head: request.method === "HEAD", origin: config.origin });
  const status = url.pathname.endsWith("/status");
  const methods = status ? ["GET", "HEAD"] : ["POST"];
  if (!methods.includes(request.method)) {
    const response = json({ error: "Use the connection controls on SatinLore." }, 405);
    response.headers.set("Allow", methods.join(", "));
    return finish(response);
  }
  if (url.search) return finish(json({ error: "Use the connection controls on SatinLore." }, 400));
  const vendorConfig = lovenseConfiguration(env);
  const quotaAvailable = env.PRIVATE_FEEDBACK && typeof env.PRIVATE_FEEDBACK.idFromName === "function" && typeof env.PRIVATE_FEEDBACK.get === "function";
  const readiness = lovenseReadiness(env, quotaAvailable);
  const available = Boolean(vendorConfig && readiness.available);
  const unavailable = readiness.message;
  if (status) return finish(json(readiness));
  if (request.headers.get("Origin") !== config.origin ||
      ["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site"))) {
    return finish(json({ error: "Please use the connection controls on SatinLore." }, 403));
  }
  try {
    await emptyLovenseRequest(request);
    if (!available) return finish(json({ error: unavailable }, 503));
    const uid = await lovenseIdentity(session.subject, config.audience, vendorConfig.uidSecret);
    // Separate object namespace: quota state never joins feedback, email or stories.
    const quota = env.PRIVATE_FEEDBACK.get(env.PRIVATE_FEEDBACK.idFromName(`lovense-issue:v1:${uid}`));
    const permission = await quota.fetch(new Request("https://feedback.internal/internal/lovense-rate", {
      method: "POST", headers: { Origin: APP_ORIGIN, "Content-Type": "application/json" }, body: "{}",
    }));
    if (permission.status !== 200) {
      const limited = permission.status === 429;
      const response = json({ error: limited ? "A few connection attempts were made recently. Wait a minute and try again." : "Connection setup is temporarily unavailable. Try again shortly." }, limited ? 429 : 503);
      if (limited) response.headers.set("Retry-After", /^\d+$/.test(permission.headers.get("Retry-After") || "") ? permission.headers.get("Retry-After") : "60");
      return finish(response);
    }
    if (Date.now() >= session.expiresAt) return finish(json({ error: "Sign in again to connect your toy." }, 403));
    const authToken = await issueLovenseToken(vendorConfig, uid, lovenseFetcher ? { fetcher: lovenseFetcher } : {});
    // Authentication can expire/change while the vendor request is in flight.
    const renewed = await reverify();
    if (!renewed || renewed.subject !== session.subject || Date.now() >= renewed.expiresAt) return finish(json({ error: "Sign in again to connect your toy." }, 403));
    return finish(json({ uid, platform: vendorConfig.platform, authToken,
      expires_at: Math.floor(Math.min(renewed.expiresAt, Date.now() + 15 * 60_000) / 1000) }));
  } catch (error) {
    if (error instanceof LovenseServiceError) {
      return finish(json({
        error: error.message,
        ...(session.isFounder && error.diagnostic ? { diagnostic: error.diagnostic } : {}),
      }, error.status));
    }
    return finish(json({ error: "Connection setup is temporarily unavailable. Try again shortly." }, 503));
  }
}

async function serveAsset(request, env, path, { origin = APP_ORIGIN, alphaPage = false, alphaAdmin = false, publicAuth = false } = {}) {
  const head = request.method === "HEAD";
  const finish = response => secure(response, { head, origin, alphaPage, alphaAdmin });
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") return finish(json({ error: "The private preview is not available." }, 503));
  try {
    const assetUrl = new URL(path, origin);
    // No bearer assertion, cookies, user query values or reader content enter an asset request.
    const bridge = path === "/device-bridge.html";
    const asset = await env.ASSETS.fetch(new Request(assetUrl, { method: bridge ? "GET" : request.method }));
    if (asset.status !== 200) return finish(json({ error: "The preview asset is unavailable." }, 404));
    if (bridge) {
      const document = await asset.text();
      const script = document.match(/<script id="lovense-isolated-bundle">([\s\S]*?)<\/script>/)?.[1];
      if (!script || document.length > 500_000) return finish(json({ error: "The isolated connection bridge is unavailable." }, 503));
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(script));
      const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
      return secure(new Response(document, asset), { head, bridgeHash: hash, origin: origin });
    }
    if (publicAuth && !head && PUBLIC_DOCUMENTS.has(path)) {
      const document = await asset.text();
      const headers = new Headers(asset.headers);
      headers.delete("Content-Length");
      headers.delete("Content-Encoding");
      headers.delete("ETag");
      return finish(new Response(document.replace("</head>", '<meta name="satinlore-public-auth" content="true"></head>'),
        { status: asset.status, headers }));
    }
    return finish(asset);
  } catch {
    return finish(json({ error: "The preview asset is unavailable." }, 503));
  }
}

async function handleAlphaSurface(request, env, url, lovenseFetcher) {
  const { pathname } = url;
  const finish = response => secure(response, { head: request.method === "HEAD" });
  const read = request.method === "GET" || request.method === "HEAD";
  if (env.PRIVATE_APP_ENABLED !== "true" || env.PUBLIC_APP_ORIGIN !== APP_ORIGIN) {
    return finish(json({ error: "Alpha is temporarily unavailable." }, 503));
  }
  if (pathname.startsWith("/alpha/api/alpha/")) {
    const canonical = new URL(url);
    canonical.pathname = pathname.slice("/alpha".length);
    return finish(await handleAlphaApi(new Request(canonical, request), env) ?? json({ error: "Not found." }, 404));
  }
  if (read && (pathname === "/alpha" || pathname === "/alpha/")) {
    return serveAsset(request, env, "/alpha/index.html", { alphaPage: true });
  }
  if (read && ALPHA_ASSET_PATHS.has(pathname) && !ALPHA_ADMIN_ASSETS.has(pathname)) {
    return serveAsset(request, env, pathname);
  }
  const admin = ALPHA_ADMIN_PATHS.has(pathname) || ALPHA_ADMIN_ASSETS.has(pathname);
  const vendor = pathname === "/alpha/api/lovense/status" || pathname === "/alpha/api/lovense/session";
  const bridge = pathname === "/alpha/device-bridge";
  const probe = pathname === "/alpha/api/access";
  if (!admin && !vendor && !bridge && !probe) return finish(json({ error: "Not found." }, 404));
  if (!vendor && !read) return finish(json({ error: "Use the controls on SatinLore Alpha." }, 405));
  const session = await verifyAlphaSession(request, env);
  if (!session) {
    if (ALPHA_ADMIN_PATHS.has(pathname)) return finish(new Response(null, { status: 303, headers: { Location: "/alpha?next=admin" } }));
    return finish(json({ error: "Sign in to SatinLore Alpha." }, 401));
  }
  if (admin) {
    if (!session.isFounder) return finish(json({ error: "This page is restricted to the Alpha founder." }, 403));
    return serveAsset(request, env, ALPHA_ADMIN_PATHS.has(pathname) ? "/alpha/admin.html" : pathname, { alphaAdmin: true });
  }
  if (probe) return finish(json({ authenticated: true, expiresAt: session.expiresAt }));
  if (bridge) return serveAsset(request, env, "/device-bridge.html");
  return handleLovense(request, env, { session, lovenseFetcher,
    config: { origin: APP_ORIGIN, audience: "satinlore-alpha-v1" }, reverify: () => verifyAlphaSession(request, env) });
}

function feedbackRequest(stub, path, method, payload, owner) {
  const headers = new Headers({ Origin: APP_ORIGIN });
  if (owner) headers.set("X-Feedback-Owner", owner);
  if (payload !== undefined) headers.set("Content-Type", "application/json");
  return stub.fetch(new Request(`https://feedback.internal${path}`, {
    method, headers, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  }));
}

async function handleFeedbackAdmin(request, env, url, config, session) {
  if (config.origin !== BETA_ORIGIN || !session.isFounder) return json({ error: "Feedback review requires founder access." }, 403);
  if (url.pathname !== "/feedback-admin/api") {
    const asset = FEEDBACK_ADMIN_PATHS.get(url.pathname);
    if (!asset || !["GET", "HEAD"].includes(request.method)) return json({ error: "Not found." }, 404);
    return serveAsset(request, env, asset, { origin: config.origin });
  }
  if (!["GET", "PATCH"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, PATCH" } });
  if (request.method === "PATCH" && (request.headers.get("Origin") !== BETA_ORIGIN ||
      ["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site")))) {
    return json({ error: "Use the feedback review page to update notes." }, 403);
  }
  try {
    let update;
    if (request.method === "PATCH") {
      const headers = new Headers(request.headers);
      headers.set("Origin", APP_ORIGIN);
      update = normalizeFeedbackReview(await feedbackJson(new Request(request, { headers })));
    }
    if (Date.now() >= session.expiresAt) return json({ error: "Feedback review requires founder access." }, 403);
    const inbox = env.PRIVATE_FEEDBACK.get(env.PRIVATE_FEEDBACK.idFromName(FEEDBACK_INBOX_NAME));
    return await feedbackRequest(inbox, "/internal/inbox/review", request.method, update);
  } catch (error) {
    if (error instanceof FeedbackError) return json({ error: error.message }, error.status);
    return json({ error: "Feedback review is temporarily unavailable." }, 503);
  }
}

export function createPrivateAppWorker({ keyResolver, storyFetcher, storyParser, lovenseFetcher, analysisFetcher, emailFetcher } = {}) {
  return {
    async fetch(request, env, ctx) {
      const head = request.method === "HEAD";
      let responseOrigin = APP_ORIGIN;
      const finish = response => secure(response, { head, origin: responseOrigin });
      const url = new URL(request.url);
      if (url.origin === APP_ORIGIN && (url.pathname === "/alpha" || url.pathname.startsWith("/alpha/") ||
          (ALPHA_ADMIN_PATHS.has(url.pathname) && alphaConfigured(env)))) {
        return handleAlphaSurface(request, env, url, lovenseFetcher);
      }
      // A valid token must not make workers.dev, version URLs or another hostname an origin bypass.
      if (![APP_ORIGIN, BETA_ORIGIN].includes(url.origin)) return finish(json({ error: "Founder access required." }, 403));
      const decisionsBenchmark = url.pathname === "/api/scene-analysis/decisions-benchmark";
      const publicAuth = !decisionsBenchmark && url.origin === APP_ORIGIN && env.PUBLIC_READER_ENABLED === "true";
      const config = publicAuth ? publicReaderConfiguration(env) : privateAppConfiguration(env, url.origin);
      if (!config) return finish(json({ error: publicAuth ? "Email sign-in is temporarily unavailable." : "The private preview is not available." }, 503));
      responseOrigin = config.origin;
      if (publicAuth) {
        const authResponse = await handlePublicAuth(request, env, config, emailFetcher, ctx);
        if (authResponse) return finish(authResponse);
      }
      const read = ["GET", "HEAD"].includes(request.method);
      const path = PRIVATE_DOCUMENT_ROUTES[url.pathname] ?? url.pathname;
      if (publicAuth && BETA_ADMIN_PATHS.has(url.pathname)) return finish(json({ error: "Not found." }, 404));
      if (publicAuth && read && PUBLIC_ASSET_PATHS.has(path)) {
        return serveAsset(request, env, path, { origin: config.origin, publicAuth: true });
      }
      const reverify = publicAuth ? () => verifyPublicReader(request, config) : () => verifyFounder(request, config, keyResolver);
      const session = await reverify();
      if (publicAuth && read && url.pathname === "/api/access") {
        return finish(json({ authenticated: Boolean(session), expiresAt: session?.expiresAt ?? null }));
      }
      if (publicAuth && !session) return finish(json({ error: "Sign in to SatinLore to continue." }, 401));
      if (!session) return finish(json({ error: "Founder access required." }, 403));
      if (decisionsBenchmark) {
        const response = finish(await handleDecisionsBenchmark(request, env, { config, session, analysisFetcher, reverify }));
        // Same-origin form navigation must send the actual Origin for the POST check.
        if (read && response.ok) response.headers.set("Referrer-Policy", "same-origin");
        return response;
      }
      if (url.pathname === "/feedback-admin" || url.pathname.startsWith("/feedback-admin/")) {
        return finish(await handleFeedbackAdmin(request, env, url, config, session));
      }
      // These services select identity only from the verified session context.
      const accountResponse = await handleAccount(request, env, { config, session });
      if (accountResponse) {
        if (publicAuth && url.pathname === "/api/account/delete" && accountResponse.ok) {
          const cleared = await revokePublicReader(config, session);
          if (!cleared) return finish(json({ error: "Your account was removed, but sign-out could not be confirmed. Try signing out again." }, 503));
          const response = new Response(accountResponse.body, accountResponse);
          response.headers.set("Set-Cookie", cleared["Set-Cookie"]);
          return finish(response);
        }
        return finish(accountResponse);
      }
      const recordingResponse = await handleBetaRecordings(request, env, { config, session });
      if (recordingResponse) return finish(recordingResponse);
      if (BETA_ADMIN_PATHS.has(url.pathname) &&
          (config.origin !== BETA_ORIGIN || !session.isFounder)) return finish(json({ error: "This page is restricted to the beta administrator." }, 403));
      if (["/api/lovense/status", "/api/lovense/session"].includes(url.pathname)) {
        return handleLovense(request, env, { config, session, lovenseFetcher, reverify });
      }
      if (url.pathname === "/api/scene-analysis") {
        return finish(await handleSceneAnalysis(request, env, { config, session, analysisFetcher, reverify }));
      }
      if (url.pathname === "/api/story-import") {
        const expired = () => finish(json({ error: publicAuth ? "Sign in again to import a story." : "Founder access required." }, 403));
        if (request.method !== "POST") {
          const response = json({ error: "Use the story-link form to import a story." }, 405);
          response.headers.set("Allow", "POST");
          return finish(response);
        }
        if (request.headers.get("Origin") !== config.origin ||
            ["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site"))) {
          return finish(json({ error: "Please use the story-link form on the SatinLore app." }, 403));
        }
        try {
          // Exact public Origin was checked above; the parser keeps its existing
          // canonical internal contract on both authenticated reader hosts.
          const internalHeaders = new Headers(request.headers); internalHeaders.set("Origin", APP_ORIGIN);
          const source = await storyImportJson(new Request(request, { headers: internalHeaders }));
          if (Date.now() >= session.expiresAt) return expired();
          // Deliberate link imports are the sole exception to local-only story processing.
          // Only a canonical public AO3 URL enters this fetch; no cookies, assertions or local story data.
          const story = await importPublicStory(source, { ...(storyFetcher ? { fetcher: storyFetcher } : {}), ...(storyParser ? { parse: storyParser } : {}) });
          const renewed = await reverify();
          if (!renewed || renewed.subject !== session.subject || Date.now() >= renewed.expiresAt) return expired();
          return finish(json(story));
        } catch (error) {
          if (error instanceof StoryImportError) return finish(json({ error: error.message }, error.status));
          return finish(json({ error: "The story link could not be opened. Try an AO3 HTML download instead." }, 503));
        }
      }
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
            // Outer request passed the selected host's exact-Origin check.
            // Keep the existing internal feedback store's canonical protocol.
            const internalHeaders = new Headers(request.headers); internalHeaders.set("Origin", APP_ORIGIN);
            const value = await feedbackJson(new Request(request, { headers: internalHeaders }));
            if (url.pathname === "/api/feedback") payload = normalizeFeedback(value);
            else {
              if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || value.confirm !== true) {
                return finish(json({ error: "Confirm deletion before removing your app feedback." }, 400));
              }
              payload = { confirm: true };
            }
          }
          if (Date.now() >= session.expiresAt) return finish(json({ error: "Founder access required." }, 403));
          const ownerScope = session.authMode === "email" ? "email" : config.audience;
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`satinlore:feedback:v1:${ownerScope}:${session.subject}`));
          const name = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
          const inbox = env.PRIVATE_FEEDBACK.get(env.PRIVATE_FEEDBACK.idFromName(FEEDBACK_INBOX_NAME));
          const legacy = session.authMode === "email" ? null : env.PRIVATE_FEEDBACK.get(env.PRIVATE_FEEDBACK.idFromName(name));
          // No email, cookies, JWT, request query values or story context reach either store.
          if (request.method === "POST" && url.pathname === "/api/feedback") {
            if (legacy) {
              const prior = await feedbackRequest(legacy, "/internal/legacy-retry", "POST", payload);
              if (prior.status !== 404) return finish(prior);
            }
            return finish(await feedbackRequest(inbox, "/internal/inbox/feedback", "POST", payload, name));
          }
          if (request.method === "POST") {
            const cleared = await feedbackRequest(inbox, "/internal/inbox/delete", "POST", payload, name);
            if (!cleared.ok || !legacy) return finish(cleared);
            return finish(await feedbackRequest(legacy, "/api/my-data/delete", "POST", payload));
          }
          const current = await feedbackRequest(inbox, "/internal/inbox/feedback", "GET", undefined, name);
          if (!current.ok) return finish(current);
          const { feedback } = await current.json();
          if (legacy) {
            const previous = await feedbackRequest(legacy, "/api/feedback", "GET");
            if (!previous.ok) return finish(previous);
            feedback.push(...(await previous.json()).feedback);
            feedback.sort((first, second) => second.createdAt - first.createdAt);
          }
          if (url.pathname === "/api/my-data") {
            const exported = json({ scope: "SatinLore app feedback", exportedAt: Date.now(), feedback });
            exported.headers.set("Content-Disposition", 'attachment; filename="satinlore-feedback.json"');
            return finish(exported);
          }
          return finish(json({ feedback }));
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
      if (!ASSET_PATHS.has(path)) return finish(json({ error: "This page is not part of the private simulator." }, 404));
      return serveAsset(request, env, path, { origin: config.origin });
    },
  };
}

export default createPrivateAppWorker();

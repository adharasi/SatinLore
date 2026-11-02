/** Server-only Lovense credential exchange. No browser identity or developer secret is accepted from clients. */
export const LOVENSE_TOKEN_URL = "https://api.lovense-api.com/api/basicApi/getToken";
const MAX_VENDOR_BYTES = 16_384;
const ENCODER = new TextEncoder();

export class LovenseServiceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function lovenseConfiguration(env) {
  const developerToken = typeof env.LOVENSE_DEVELOPER_TOKEN === "string" ? env.LOVENSE_DEVELOPER_TOKEN : "";
  const platform = typeof env.LOVENSE_PLATFORM === "string" ? env.LOVENSE_PLATFORM.trim() : "";
  const uidSecret = typeof env.LOVENSE_UID_SECRET === "string" ? env.LOVENSE_UID_SECRET : "";
  if (developerToken.length < 16 || developerToken.length > 8192 || /[\u0000-\u001f\u007f]/.test(developerToken) ||
      platform.length < 1 || platform.length > 128 || /[\u0000-\u001f\u007f<>]/.test(platform) ||
      !/^[a-f0-9]{64}$/i.test(uidSecret)) return null;
  return { developerToken, platform, uidSecret };
}
export async function lovenseIdentity(subject, audience, secret) {
  const key = await crypto.subtle.importKey("raw", ENCODER.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, ENCODER.encode(`satinlore:lovense:v1:${audience}:${subject}`));
  return "sl_" + Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}
export async function emptyLovenseRequest(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) throw new LovenseServiceError("Use the connection controls on SatinLore.");
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 64)) throw new LovenseServiceError("The connection request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new LovenseServiceError("Use the connection controls on SatinLore.");
  const chunks = []; let size = 0;
  const timeout = setTimeout(() => { void reader.cancel().catch(() => {}); }, 5000);
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 64) { await reader.cancel(); throw new LovenseServiceError("The connection request is too large.", 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new LovenseServiceError("Use the connection controls on SatinLore."); }
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length) {
      throw new LovenseServiceError("This connection request accepts no identity or story fields.");
    }
  } finally { clearTimeout(timeout); }
}
export async function issueLovenseToken(config, uid, { fetcher = fetch } = {}) {
  try {
    const response = await fetcher(LOVENSE_TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token: config.developerToken, uid }), redirect: "error", credentials: "omit",
      signal: AbortSignal.timeout(8000),
    });
    if (response.status !== 200 || !response.body) throw new Error();
    const length = response.headers.get("Content-Length");
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_VENDOR_BYTES)) { await response.body.cancel(); throw new Error(); }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    const timeout = setTimeout(() => { void reader.cancel().catch(() => {}); }, 8000);
    let bytes;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_VENDOR_BYTES) { await reader.cancel(); throw new Error(); }
        chunks.push(value);
      }
      bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    } finally { clearTimeout(timeout); }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const token = value?.data?.authToken;
    if (value?.code !== 0 || typeof token !== "string" || !token.trim() || token.length > 8192 ||
        /[\u0000-\u001f\u007f]/.test(token) || token === config.developerToken) throw new Error();
    return token;
  } catch {
    // Vendor errors can contain credentials or private pairing data. Never expose them.
    throw new LovenseServiceError("Lovense could not establish a connection session. Try again shortly.", 502);
  }
}

/** Deliberate, private, bounded AO3 import. No cookies, login bypass, storage or background crawling. */
export const MAX_IMPORT_HTML_BYTES = 2_000_000;
export const MAX_IMPORT_TEXT_BYTES = 500_000;
export const MAX_IMPORT_PARAGRAPHS = 2_000;
const encoder = new TextEncoder();
const FALLBACK = "AO3 could not provide readable story text. Open it on AO3, choose Download → HTML, then upload that file here. Restricted works must be opened on AO3 first.";
export class StoryImportError extends Error {
  constructor(message, status = 422) { super(message); this.name = "StoryImportError"; this.status = status; }
}

export function ao3StoryUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) throw new StoryImportError("Paste an AO3 work or chapter link.", 400);
  let url;
  try { url = new URL(value.trim()); } catch { throw new StoryImportError("Paste a complete HTTPS story link.", 400); }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["archiveofourown.org", "www.archiveofourown.org", "ao3.org"].includes(url.hostname)) {
    throw new StoryImportError("Link import currently supports public AO3 works. For other sites, paste text you have permission to use or upload a supported file.", 400);
  }
  if (!/^\/(?:works\/[1-9]\d{0,15}(?:\/chapters\/[1-9]\d{0,15})?|chapters\/[1-9]\d{0,15})\/?$/.test(url.pathname)) {
    throw new StoryImportError("Use a link to one AO3 work or chapter, rather than a collection, search or sign-in page.", 400);
  }
  // Never forward private query values, fragments, login details, warning acknowledgements or arbitrary paths.
  const canonical = new URL(url.pathname.replace(/\/$/, ""), "https://archiveofourown.org");
  const scope = /^\/works\/\d+$/.test(canonical.pathname) ? "entire work" : "current chapter";
  if (scope === "entire work") canonical.searchParams.set("view_full_work", "true");
  return { url: canonical.href, source: "AO3", scope };
}

export async function boundedImportText(response, max = MAX_IMPORT_HTML_BYTES) {
  const declared = response.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) {
    await response.body?.cancel(); throw new StoryImportError("This story is too large. Try one chapter or a smaller file.", 413);
  }
  if (!response.body) return "";
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new StoryImportError("This story is too large. Try one chapter or a smaller file.", 413);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new StoryImportError("This page is not readable UTF-8 text. Try AO3's HTML download instead."); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function storyImportJson(request) {
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new StoryImportError("Use the story-link form to import a story.", 415);
  }
  let value;
  try { value = JSON.parse(await boundedImportText(request, 4096)); }
  catch (error) { if (error instanceof StoryImportError) throw error; throw new StoryImportError("Paste one story link and try again.", 400); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.url !== "string") {
    throw new StoryImportError("Paste one story link and try again.", 400);
  }
  return ao3StoryUrl(value.url);
}

const entities = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", emsp: " ", ensp: " " });
export function decodeStoryEntities(value) {
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,12});/gi, (match, name) => {
    if (name[0] !== "#") return entities[name] ?? match;
    const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "�";
  });
}
export function normalizeImportedStory(title, text) {
  const clean = text.replace(/\r\n?/g, "\n").replace(/[\t \u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean || /\u0000/.test(clean)) throw new StoryImportError(FALLBACK);
  const paragraphs = clean.split(/\n\s*\n/).filter(Boolean);
  if (encoder.encode(clean).length > MAX_IMPORT_TEXT_BYTES || paragraphs.length > MAX_IMPORT_PARAGRAPHS) {
    throw new StoryImportError("This story is too large. Try one chapter: up to 500 KB and 2,000 paragraphs.", 413);
  }
  return { title: String(title || "Imported story").replace(/\s+/g, " ").trim().slice(0, 120) || "Imported story", text: clean };
}

/** Select only AO3's chapter prose, not summaries, tags, author notes, navigation, scripts or media. */
export async function extractAo3Html(html, Rewriter = globalThis.HTMLRewriter) {
  if (typeof Rewriter !== "function") throw new StoryImportError("Link import is unavailable here. Upload AO3's HTML download or paste your story instead.", 503);
  const chunks = [], titles = []; let selected = 0, ignored = 0, titleDepth = 0;
  const roots = ["#chapters > .userstuff:not(.notes)", "#chapters > .chapter > .userstuff:not(.notes)"];
  const prose = roots.join(", ");
  const inside = tags => roots.flatMap(root => tags.map(tag => `${root} ${tag}`)).join(", ");
  const rewriter = new Rewriter()
    .on(prose, { element(element) { selected++; chunks.push("\n\n"); element.onEndTag(() => chunks.push("\n\n")); },
      text(chunk) { if (!ignored) chunks.push(chunk.text); } })
    .on(inside(["p", "div", "blockquote", "li", "h1", "h2", "h3", "h4", "hr"]), {
      element(element) { chunks.push("\n\n"); if (!["hr"].includes(element.tagName)) element.onEndTag(() => chunks.push("\n\n")); },
    })
    .on(inside(["br"]), { element() { chunks.push("\n"); } })
    .on(inside(["script", "style", "noscript", "template", "iframe", "svg", ".notes"]), {
      element(element) { ignored++; element.onEndTag(() => { ignored--; }); },
    })
    .on("h2.title, #preface h1", {
      element(element) { titleDepth++; element.onEndTag(() => { titleDepth--; }); },
      text(chunk) { if (titleDepth) titles.push(chunk.text); },
    });
  try { await rewriter.transform(new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })).arrayBuffer(); }
  catch { throw new StoryImportError(FALLBACK); }
  if (!selected) throw new StoryImportError(FALLBACK);
  return normalizeImportedStory(decodeStoryEntities(titles.join("")), decodeStoryEntities(chunks.join("")));
}

export async function importPublicStory(value, { fetcher = globalThis.fetch, parse = extractAo3Html, timeoutMs = 10_000 } = {}) {
  let description = typeof value === "string" ? ao3StoryUrl(value) : ao3StoryUrl(value?.url);
  const controller = new AbortController(); let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
    controller.abort(); reject(new StoryImportError("AO3 took too long to respond. Try its HTML download instead.", 504));
  }, timeoutMs); });
  const work = async () => {
    for (let hop = 0; hop <= 2; hop++) {
      const response = await fetcher(description.url, { method: "GET", redirect: "manual", credentials: "omit", cache: "no-store",
        headers: { Accept: "text/html", "User-Agent": "SatinLore/0.1 (private reader; single requested work)" }, signal: controller.signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("Location"); await response.body?.cancel();
        if (!location || hop === 2) throw new StoryImportError(FALLBACK);
        try { description = ao3StoryUrl(new URL(location, description.url).href); }
        catch { throw new StoryImportError(FALLBACK); }
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new StoryImportError(FALLBACK); }
      if (!/^text\/html(?:;|$)/i.test(response.headers.get("Content-Type") || "")) {
        await response.body?.cancel(); throw new StoryImportError(FALLBACK);
      }
      const html = await boundedImportText(response);
      const story = await parse(html);
      return { ...story, source: "AO3", scope: description.scope };
    }
    throw new StoryImportError(FALLBACK);
  };
  try { return await Promise.race([work(), timeout]); }
  catch (error) { if (error instanceof StoryImportError) throw error; throw new StoryImportError(FALLBACK); }
  finally { clearTimeout(timer); controller.abort(); }
}

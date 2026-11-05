import { MAX_TEXT_BYTES, splitText } from "./import.mjs";

const encoder = new TextEncoder();
const MAX_HTML_FILE_BYTES = 2_000_000;
const SOURCES = Object.freeze({ "www.literotica.com": "Literotica", "literotica.com": "Literotica",
  "www.royalroad.com": "Royal Road", "royalroad.com": "Royal Road", "www.wattpad.com": "Wattpad", "wattpad.com": "Wattpad",
  "www.fanfiction.net": "FanFiction.net", "fanfiction.net": "FanFiction.net", "www.inkitt.com": "Inkitt", "inkitt.com": "Inkitt" });
export function identifyStoryUrl(value) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Paste a complete HTTPS story link.");
  let url; try { url = new URL(value.trim()); } catch { throw new Error("Paste a complete HTTPS story link."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".") ||
      /^(?:\[|(?:\d{1,3}\.){3}\d{1,3}$)/.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname)) throw new Error("Use a public HTTPS story link without sign-in details.");
  const ao3 = ["archiveofourown.org", "www.archiveofourown.org", "ao3.org"].includes(url.hostname);
  if (ao3 && !/^\/(?:works\/[1-9]\d{0,15}(?:\/chapters\/[1-9]\d{0,15})?|chapters\/[1-9]\d{0,15})\/?$/.test(url.pathname)) {
    throw new Error("Use the link to one AO3 work or chapter.");
  }
  // Never keep private query values or fragments in an outbound source link or import request.
  url.search = ""; url.hash = "";
  if (ao3) url.hostname = "archiveofourown.org";
  const name = ao3 ? "AO3" : SOURCES[url.hostname] ?? "This site";
  return { kind: ao3 ? "ao3" : name === "Literotica" ? "literotica" : "other", name, url: url.href, automatic: ao3,
    guidance: ao3 ? "Public AO3 links can open directly. For a restricted work, use Download → HTML on AO3, then upload the file here." :
      name === "Literotica" ? "Open the story on Literotica. For analysis here, use your own text or material you have permission to analyse. Literotica’s terms restrict AI use of published stories." :
        `Open the story on ${name === "This site" ? "its original site" : name}. Paste text you have permission to use, or upload a supported download.` };
}
function validateResult(value) {
  if (!value || typeof value.title !== "string" || value.title.length > 120 || typeof value.text !== "string" ||
      value.source !== "AO3" || !["entire work", "current chapter"].includes(value.scope)) throw new Error("The import did not return a readable story. Try an HTML download instead.");
  const paragraphs = splitText(value.text);
  if (!paragraphs.length || paragraphs.length > 2000) throw new Error("Use a story of up to 500 KB and 2,000 paragraphs.");
  return { title: value.title || "Imported story", text: value.text, source: value.source, scope: value.scope };
}
async function readImportResponse(response, signal) {
  const maximum = 3_100_000;
  const declared = response.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    await response.body?.cancel(); throw new Error("This story is too large. Try one chapter instead.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("This story is too large. Try one chapter instead.");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export class WebStoryImporter {
  constructor({ fetcher = globalThis.fetch?.bind(globalThis), timeoutMs = 15_000 } = {}) {
    this.fetcher = fetcher; this.timeoutMs = timeoutMs; this.generation = 0; this.controller = null;
  }
  invalidate() { this.generation++; this.controller?.abort(); this.controller = null; }
  async read(value) {
    this.invalidate(); const generation = this.generation;
    const source = identifyStoryUrl(value);
    if (!source.automatic) throw new Error(source.guidance);
    const controller = new AbortController(); this.controller = controller; let timer;
    const work = async () => {
      const response = await this.fetcher("/api/story-import", { method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ url: source.url }), signal: controller.signal });
      if (generation !== this.generation) { await response.body?.cancel(); return null; }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel(); throw new Error("Check your SatinLore sign-in, then try the link again. Your current story is unchanged.");
      }
      if (!response.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
        await response.body?.cancel(); throw new Error("Link import is available on the hosted SatinLore app. You can upload an AO3 HTML download here.");
      }
      const body = await readImportResponse(response, controller.signal);
      if (generation !== this.generation) return null;
      let result; try { result = JSON.parse(body); } catch { throw new Error("The import did not return readable text. Try an HTML download instead."); }
      if (!response.ok) throw new Error(typeof result?.error === "string" && result.error.length <= 400 ? result.error : "The link could not be opened. Try an HTML download instead.");
      return validateResult(result);
    };
    try {
      return await Promise.race([work(), new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("The link took too long. Try an HTML download instead.")); }, this.timeoutMs);
      })]);
    } catch (error) { if (generation !== this.generation) return null; throw error; }
    finally { clearTimeout(timer); controller.abort(); if (this.controller === controller) this.controller = null; }
  }
}

/** Parse into an inert template in a detached document; never attach imported markup to the page. */
export function extractDownloadedStory(html, { parser = globalThis.DOMParser } = {}) {
  if (typeof html !== "string" || encoder.encode(html).length > MAX_HTML_FILE_BYTES) throw new Error("Choose an HTML download no larger than 2 MB.");
  if (typeof parser !== "function") throw new Error("HTML import is unavailable in this browser. Paste the story text instead.");
  // Every possible closing-template token in the input is neutralised before parsing, so remote media,
  // styles and scripts remain inside the inert template, including deliberately malformed documents.
  const wrapped = '<!doctype html><html><head></head><body><template id="satinlore-file-root">' +
    html.replace(/<\/template/gi, "<\\/template") + "</template></body></html>";
  const document = new parser().parseFromString(wrapped, "text/html");
  const content = document.querySelector("#satinlore-file-root")?.content;
  if (!content) throw new Error("This HTML download could not be read. Paste its story text instead.");
  const title = content.querySelector("h2.title, #preface h1")?.textContent || "Imported story";
  const prose = [...content.querySelectorAll("#chapters > .userstuff:not(.notes), #chapters > .chapter > .userstuff:not(.notes)")].filter(node => !node.parentElement?.closest(".userstuff"));
  if (!prose.length) throw new Error("Choose the HTML file from AO3's Download menu, or paste the story text instead.");
  const sections = [];
  for (const node of prose) {
    for (const ignored of node.querySelectorAll("script, style, noscript, template, iframe, svg, .notes")) ignored.remove();
    for (const br of node.querySelectorAll("br")) br.replaceWith(document.createTextNode("\n"));
    for (const block of node.querySelectorAll("p, div, blockquote, li, h1, h2, h3, h4, hr")) {
      block.before(document.createTextNode("\n\n")); block.after(document.createTextNode("\n\n"));
    }
    sections.push(node.textContent);
  }
  const text = sections.join("\n\n").replace(/\r\n?/g, "\n").replace(/[\t \u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const paragraphs = splitText(text);
  if (!paragraphs.length || paragraphs.length > 2000 || text.includes("\u0000")) throw new Error("Use a story of up to 500 KB and 2,000 paragraphs.");
  return { title: title.replace(/\s+/g, " ").trim().slice(0, 120) || "Imported story", text };
}
export async function readStoryFile(file, options = {}) {
  if (!file || typeof file.name !== "string" || !Number.isFinite(file.size)) throw new Error("Choose a story file.");
  const html = /\.html?$/i.test(file.name);
  if (!html && !/\.txt$/i.test(file.name)) throw new Error("Choose a text file or an AO3 HTML download.");
  if (file.size > (html ? MAX_HTML_FILE_BYTES : MAX_TEXT_BYTES)) throw new Error(html ? "Choose an HTML download no larger than 2 MB." : "Choose a story no larger than 500 KB.");
  let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
  catch { throw new Error("Choose a readable UTF-8 story file."); }
  if (html) return extractDownloadedStory(text, options);
  const paragraphs = splitText(text);
  if (!paragraphs.length || paragraphs.length > 2000) throw new Error("Use a story of up to 500 KB and 2,000 paragraphs.");
  return { title: file.name.replace(/\.[^.]+$/, "").trim().slice(0, 120) || "Untitled story", text };
}

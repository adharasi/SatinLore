import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { READER_ASSETS, BETA_ONLY_ASSET_PATHS, ALPHA_ASSETS, ALPHA_SESSION_ASSET_PATHS, CORPUS_STUDY_CLIENT_ASSET } from "../deploy/cloudflare/assets.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE = resolve(ROOT, "app/static");
const OUTPUT = resolve(ROOT, "dist/private-app");
const entries = [...READER_ASSETS, ...ALPHA_ASSETS,
  [resolve(ROOT,"deploy/cloudflare/corpus-study-client.mjs"),CORPUS_STUDY_CLIENT_ASSET]];
const paths = new Set(entries.map(([, path]) => path));
const betaOnlyPaths = new Set(BETA_ONLY_ASSET_PATHS);
const alphaSessionPaths = new Set(ALPHA_SESSION_ASSET_PATHS);
const assets = [];
let revision = process.env.WORKERS_CI_COMMIT_SHA ?? "";
if (!/^[a-f0-9]{40}$/.test(revision)) {
  try { revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { revision = "local"; }
}
if (!/^[a-f0-9]{40}$/.test(revision)) revision = "local";

// Read and validate the entire bundle before replacing a previous output.
for (const [source, target] of entries) {
  let content = await readFile(resolve(SOURCE, source), "utf8");
  if (source === "device-bridge.html") {
    // Opaque iframes cannot authenticate module subrequests with Access cookies.
    // Bundle only trusted connection code into its authenticated document instead.
    const bundle = await build({ entryPoints: [resolve(SOURCE, "device-bridge.mjs")], bundle: true,
      alias: {parseuri: resolve(SOURCE, "devices/safe-uri.cjs")},
      write: false, format: "iife", platform: "browser", target: "es2022", charset: "ascii", legalComments: "inline" });
    const code = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
    // The compiled code can contain replacement metacharacters such as a
    // regex end anchor followed by a backtick. Insert it literally.
    content = content.replace(/<script type="module" src="\/static\/device-bridge\.mjs"><\/script>/,
      () => `<script id="lovense-isolated-bundle">${code}</script>`);
    if (!content.includes('id="lovense-isolated-bundle"') || /<script[^>]+src=/i.test(content)) throw new Error("The device bridge must be self-contained.");
  }
  if (source.endsWith(".html")) {
    if (!content.includes("</head>")) throw new Error("The reader document has no head element.");
    content = content.replace("</head>", `  <meta name="satinlore-hosted-access" content="true">\n  <meta name="satinlore-build" content="${revision}">\n</head>`);
    content = content.replace(/<a\b[^>]*href=["']\/device-check["'][^>]*>[\s\S]*?<\/a>/g, "");
    // One fixed navigation link explains the optional analysis provider's data
    // controls. It is not an external script, image, style or network permission.
    const checked = source === "help.html" ? content.replace(
      '<a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noopener">OpenAI’s data controls</a>', "") : content;
    if (source !== "device-bridge.html" && /device-check|device-bridge|lovense\.mjs|https?:\/\//i.test(checked)) throw new Error("The hosted document references a non-reader surface.");
    for (const [, reference] of content.matchAll(/\b(?:src|href)=["'](\/[^"']+)["']/gu)) {
      if ((!betaOnlyPaths.has(target) && betaOnlyPaths.has(reference)) || alphaSessionPaths.has(reference)) {
        throw new Error(`The hosted document ${source} loads a protected dependency directly: ${reference}.`);
      }
    }
  }
  if (source.endsWith(".mjs")) {
    const imports = [
      ...Array.from(content.matchAll(/(?:^|\n)\s*(?:import\s+(?:[^;\n]+?\s+from\s+)?|export\s+[^;\n]+?\s+from\s+)["']([^"']+)["']/g),
        ([, path]) => ({ path, dynamic: false })),
      ...Array.from(content.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g), ([, path]) => ({ path, dynamic: true })),
    ];
    for (const { path: specifier, dynamic } of imports) {
      const dependency = new URL(specifier, "https://app.satinlore.com" + target);
      if (dependency.origin !== "https://app.satinlore.com" || !paths.has(dependency.pathname) ||
          (target.startsWith("/alpha/") && !dependency.pathname.startsWith("/alpha/static/"))) {
        throw new Error(`Unlisted module dependency in ${source}: ${specifier}.`);
      }
      if (!dynamic && ((!betaOnlyPaths.has(target) && betaOnlyPaths.has(dependency.pathname)) ||
          (!alphaSessionPaths.has(target) && alphaSessionPaths.has(dependency.pathname)))) {
        throw new Error(`${source} loads a protected dependency before access checks: ${specifier}.`);
      }
    }
  }
  assets.push([target.slice(1), content]);
}
await rm(OUTPUT, { recursive: true, force: true });
for (const [target, content] of assets) {
  const destination = resolve(OUTPUT, target);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}
console.log(`Private app bundle built: ${assets.length} allowlisted workspace files and an isolated connection bridge; no server source, credentials or story data in assets.`);

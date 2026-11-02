import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { READER_ASSETS } from "../deploy/cloudflare/assets.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE = resolve(ROOT, "app/static");
const OUTPUT = resolve(ROOT, "dist/private-app");
const paths = new Set(READER_ASSETS.map(([, path]) => path));
const assets = [];
let revision = process.env.WORKERS_CI_COMMIT_SHA ?? "";
if (!/^[a-f0-9]{40}$/.test(revision)) {
  try { revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { revision = "local"; }
}
if (!/^[a-f0-9]{40}$/.test(revision)) revision = "local";

// Read and validate the entire bundle before replacing a previous output.
for (const [source, target] of READER_ASSETS) {
  let content = await readFile(resolve(SOURCE, source), "utf8");
  if (source === "device-bridge.html") {
    // Opaque iframes cannot authenticate module subrequests with Access cookies.
    // Bundle only trusted connection code into its authenticated document instead.
    const bundle = await build({ entryPoints: [resolve(SOURCE, "device-bridge.mjs")], bundle: true,
      write: false, format: "iife", platform: "browser", target: "es2022", charset: "ascii", legalComments: "none" });
    const code = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
    content = content.replace(/<script type="module" src="\/static\/device-bridge\.mjs"><\/script>/,
      `<script id="lovense-isolated-bundle">${code}</script>`);
    if (!content.includes('id="lovense-isolated-bundle"') || /<script[^>]+src=/i.test(content)) throw new Error("The device bridge must be self-contained.");
  }
  if (source.endsWith(".html")) {
    if (!content.includes("</head>")) throw new Error("The reader document has no head element.");
    content = content.replace("</head>", `  <meta name="satinlore-hosted-access" content="true">\n  <meta name="satinlore-build" content="${revision}">\n</head>`);
    content = content.replace(/<a\b[^>]*href=["']\/device-check["'][^>]*>[\s\S]*?<\/a>/g, "");
    if (source !== "device-bridge.html" && /device-check|device-bridge|lovense\.mjs|https?:\/\//i.test(content)) throw new Error("The hosted document references a non-reader surface.");
  }
  if (source.endsWith(".mjs")) {
    const imports = [
      ...content.matchAll(/(?:^|\n)\s*import\s+(?:[^;\n]+?\s+from\s+)?["']([^"']+)["']/g),
      ...content.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g),
    ];
    for (const [, specifier] of imports) {
      const dependency = new URL(specifier, "https://app.satinlore.com" + target);
      if (dependency.origin !== "https://app.satinlore.com" || !paths.has(dependency.pathname)) throw new Error(`Unlisted reader module dependency in ${source}.`);
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

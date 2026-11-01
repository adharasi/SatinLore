import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { READER_ASSETS } from "../deploy/cloudflare/assets.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE = resolve(ROOT, "app/static");
const OUTPUT = resolve(ROOT, "dist/private-app");
const paths = new Set(READER_ASSETS.map(([, path]) => path));
const assets = [];

// Read and validate the entire bundle before replacing a previous output.
for (const [source, target] of READER_ASSETS) {
  let content = await readFile(resolve(SOURCE, source), "utf8");
  if (source === "index.html") {
    if (!content.includes("</head>")) throw new Error("The reader document has no head element.");
    content = content.replace("</head>", '  <meta name="satinlore-hosted-access" content="true">\n</head>');
    content = content.replace(/<a\b[^>]*href=["']\/device-check["'][^>]*>[\s\S]*?<\/a>/g, "");
    if (/device-check|device-bridge|lovense\.mjs|https?:\/\//i.test(content)) throw new Error("The hosted document references a non-reader surface.");
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
console.log(`Private simulator bundle built: ${assets.length} allowlisted reader files; no local device routes or database.`);

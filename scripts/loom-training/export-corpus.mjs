// Private subprocess protocol for train.py. Stdout is captured in memory by the trainer.
import {createHash} from "node:crypto";
import {readFile, realpath} from "node:fs/promises";
import {dirname, isAbsolute, relative, resolve, sep} from "node:path";
import {ANALYSIS_VERSION, ReaderModel} from "../../app/static/reader/model.mjs";

const validId = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,119}$/.test(value);
const frames = new Set(["current", "historical", "imagined", "reported", "neutral", "uncertain", "mixed"]);
const phases = new Set(["quiet", "build", "sustain", "peak", "recover", "abstain"]);
const digest = value => createHash("sha256").update(value).digest("hex");
const inside = (root, file) => {
  const path = relative(root, file);
  return path && !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
};

async function loadCorpus(manifestPath, split) {
  const root = dirname(await realpath(manifestPath));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest?.version !== 1 || !Array.isArray(manifest.works) || !manifest.works.length) {
    throw new Error("Invalid local corpus manifest.");
  }
  const rows = [], works = new Set(), excerpts = new Set(), digests = new Set();
  for (const work of manifest.works) {
    if (!validId(work?.id) || !validId(work.authorId) || work.split !== split || works.has(work.id) ||
        !Array.isArray(work.excerpts) || !work.excerpts.length) throw new Error("Invalid work or split.");
    works.add(work.id);
    for (const excerpt of work.excerpts) {
      if (!validId(excerpt?.id) || excerpts.has(excerpt.id) || !/^[0-9a-f]{64}$/.test(excerpt.sha256) ||
          digests.has(excerpt.sha256) || typeof excerpt.file !== "string" || !Array.isArray(excerpt.labels) ||
          !excerpt.labels.length) throw new Error("Invalid excerpt metadata.");
      excerpts.add(excerpt.id);
      digests.add(excerpt.sha256);
      const file = await realpath(resolve(root, excerpt.file));
      if (!inside(root, file)) throw new Error("Excerpt must remain in the corpus directory.");
      const text = new TextDecoder("utf-8", {fatal: true}).decode(await readFile(file)).replace(/\r\n?/g, "\n");
      if (digest(text) !== excerpt.sha256) throw new Error("Excerpt digest mismatch.");
      const paragraphs = new ReaderModel().load(text);
      if (paragraphs.length !== excerpt.labels.length) throw new Error("Excerpt paragraph count mismatch.");
      for (const [index, label] of excerpt.labels.entries()) {
        if (label?.paragraph !== index + 1 || typeof label.cueEligible !== "boolean" ||
            typeof label.boundary !== "boolean" ||
            !validId(label.category) || (label.eventKind != null && !frames.has(label.eventKind)) ||
            (label.phase != null && !phases.has(label.phase))) throw new Error("Invalid or misaligned cue annotation.");
        const paragraph = paragraphs[index];
        rows.push({work: work.id, author: work.authorId, excerpt: excerpt.id, excerptHash: excerpt.sha256,
          index, text: paragraph.text, unitHash: digest(paragraph.text), category: label.category,
          eventKind: label.eventKind ?? null, phase: label.phase ?? null,
          cue: label.cueEligible, boundary: label.boundary, ruleCue: paragraph.suggestedLevel > 0});
      }
    }
  }
  return {analysisVersion: ANALYSIS_VERSION, rows};
}

try {
  const [manifestPath, split, ...extra] = process.argv.slice(2);
  if (process.stdout.isTTY || !manifestPath || !["calibration", "holdout"].includes(split) || extra.length) throw new Error();
  process.stdout.write(JSON.stringify(await loadCorpus(manifestPath, split)));
} catch {
  // Decoder and filesystem errors can contain sensitive source material or paths.
  process.stderr.write("Local corpus validation failed. Check split, excerpt paths, SHA-256 and paragraph labels.\n");
  process.exitCode = 1;
}

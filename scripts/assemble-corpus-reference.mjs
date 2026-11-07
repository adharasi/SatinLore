import {createHash, randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {existsSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync} from "node:fs";
import {basename, dirname, join, resolve} from "node:path";
import {assembleFullCorpusReference, auditPriorReference} from "./lib/reference-assembly.mjs";

const usage = "node scripts/assemble-corpus-reference.mjs --source PRIVATE_SOURCE.json --checkpoint CHECKPOINT.json " +
  "[--checkpoint MORE.json] --output PRIVATE_REFERENCE.json --adjudication-output PRIVATE_SELECTION.json " +
  "[--prior PRIOR.json --prior-output PRIVATE_AUDIT.json]";
const maxInputBytes = 256 * 1024 * 1024;
const sha = value => createHash("sha256").update(value).digest("hex");

function privateOutputPath(path) {
  let outputDirectory;
  try { outputDirectory = realpathSync(dirname(path)); }
  catch { throw new TypeError("Cannot resolve the private output directory."); }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  env.LC_ALL = "C";
  for (let directory = outputDirectory; ; directory = dirname(directory)) {
    if (existsSync(join(directory, ".git"))) {
      const git = spawnSync("git", ["-C", directory, "rev-parse", "--is-inside-work-tree"],
        {env, encoding: "utf8", timeout: 5000, maxBuffer: 8192, windowsHide: true});
      if (git.status === 0) throw new TypeError("Write private results outside a Git checkout.");
      if (git.error || !git.stderr?.includes("not a git repository")) {
        throw new TypeError("Cannot verify that the private output directory is outside Git.");
      }
    }
    if (dirname(directory) === directory) break;
  }
  return join(outputDirectory, basename(path));
}

function optionsFrom(args) {
  const options = {checkpoints: [], priors: []};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i], value = args[i + 1];
    if (!value || value.startsWith("--")) throw new TypeError(usage);
    if (name === "--checkpoint") options.checkpoints.push(resolve(value));
    else if (name === "--prior") options.priors.push(resolve(value));
    else if (["--source", "--output", "--adjudication-output", "--prior-output"].includes(name) && !options[name]) options[name] = resolve(value);
    else throw new TypeError(usage);
  }
  if (!options["--source"] || !options["--output"] || !options["--adjudication-output"] || !options.checkpoints.length ||
      Boolean(options.priors.length) !== Boolean(options["--prior-output"])) throw new TypeError(usage);
  const inputs = [options["--source"], ...options.checkpoints, ...options.priors].map(path => {
    try { return realpathSync(path); } catch { return path; }
  });
  const outputKeys = ["--output", "--adjudication-output", "--prior-output"].filter(key => options[key]);
  for (const key of outputKeys) options[key] = privateOutputPath(options[key]);
  const outputs = outputKeys.map(key => options[key]);
  if (new Set(outputs).size !== outputs.length || outputs.some(path => inputs.includes(path))) throw new TypeError("Use separate private output paths.");
  return options;
}

function load(path) {
  let bytes, value;
  try {
    const info = statSync(path);
    if (!info.isFile() || info.size > maxInputBytes) throw new Error();
    bytes = readFileSync(path); value = JSON.parse(bytes);
  } catch { throw new TypeError("Cannot read a bounded input JSON file."); }
  return {value, sha256: sha(bytes)};
}

function save(path, value) {
  const temp = join(dirname(path), `.corpus-reference-${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify(value)}\n`, {flag: "wx", mode: 0o600});
    renameSync(temp, path);
  } finally { rmSync(temp, {force: true}); }
}

try {
  const options = optionsFrom(process.argv.slice(2));
  const source = load(options["--source"]), checkpoints = options.checkpoints.map(load);
  const {reference, adjudicationSelection} = assembleFullCorpusReference({corpus: source.value,
    checkpoints: checkpoints.map(item => item.value), sourceBundleSha256: source.sha256});
  const audit = options.priors.length ? {schema: 1, referenceSha256: reference.referenceSha256,
    priorAudits: options.priors.map(path => {
      const prior = load(path);
      return {priorSha256: prior.sha256, ...auditPriorReference(reference, prior.value)};
    })} : null;
  save(options["--output"], reference);
  save(options["--adjudication-output"], adjudicationSelection);
  if (audit) save(options["--prior-output"], audit);
  console.log(JSON.stringify({referenceSha256: reference.referenceSha256, ...reference.counts}));
} catch (error) {
  console.error(error instanceof TypeError ? error.message : "Reference assembly failed.");
  process.exitCode = 1;
}

import {open, readFile, realpath, unlink} from "node:fs/promises";
import {basename, dirname, join, resolve, relative} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {createLunaProtocolProvider, LUNA_PROTOCOL_MODEL} from "./lib/luna-protocol-provider.mjs";
import {createLunaShadowBudget, MAX_SHADOW_VERIFICATIONS, runLunaProtocolShadow} from "./lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, planIndexedWholeStoryContext} from "./lib/whole-story-context-planning.mjs";

const args = {
  editions: {type: "string"}, grants: {type: "string"}, output: {type: "string"},
  work: {type: "string", multiple: true}, live: {type: "boolean"}, arm: {type: "string", default: "windowed"},
  "max-attempts": {type: "string", default: "960"}, "max-payload-bytes": {type: "string", default: "5000000"},
  "max-micros": {type: "string", default: "1000000"}, "max-verification": {type: "string", default: "96"},
  "max-windows": {type: "string", default: "96"}, "prefix-units": {type: "string", default: "24"},
  "max-cue-checks": {type: "string", default: "6"},
  "verification-context": {type: "string", default: "attested"}, "target-roster": {type: "string"},
  "max-transition-verification": {type: "string", default: "32"}, "no-transition-verification": {type: "boolean"},
};
const repo = fileURLToPath(new URL("../", import.meta.url));
const read = async path => JSON.parse(await readFile(path, "utf8"));
const number = value => {
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid budget.");
  return Number(value);
};
const flags = () => parseArgs({options: args}).values;

async function main(options) {
  if (!options.editions || !options.output) throw new Error("Specify --editions and --output.");
  const requested = resolve(options.output);
  const output = join(await realpath(dirname(requested)), basename(requested));
  const path = relative(await realpath(repo), output);
  if (path !== ".." && !path.startsWith("../")) throw new Error("Write private study outputs outside the repository.");
  const {works} = await read(options.editions);
  const grantList = options.grants ? (await read(options.grants)).works : [];
  const rosterList = options["target-roster"] ? (await read(options["target-roster"])).works : [];
  if (![works, grantList, rosterList].every(Array.isArray)) throw new Error("Use input manifests with works arrays.");
  const selected = options.work ? works.filter(({id}) => options.work.includes(id)) : works;
  const byId = new Map(grantList.map(row => [row.id, row]));
  const roster = new Map(rosterList.map(row => [row.id, row]));
  if (!selected.length || new Set(selected.map(({id}) => id)).size !== selected.length ||
      options.work?.some(id => !selected.some(work => work.id === id)) || byId.size !== grantList.length ||
      roster.size !== rosterList.length || rosterList.some(row => !selected.some(work => work.id === row.id))) {
    throw new Error("Use distinct, matching work IDs.");
  }
  if (options.live && (!options.grants || !process.env.OPENAI_API_KEY?.trim())) {
    throw new Error("Live shadow requires a trusted exact-range grant manifest and an authorized OPENAI_API_KEY.");
  }
  const maxVerification = number(options["max-verification"]);
  const maxTransitionVerification = number(options["max-transition-verification"]);
  const maxCueChecks = number(options["max-cue-checks"]);
  const verifyTransitions = !options["no-transition-verification"];
  const prefixUnits = number(options["prefix-units"]);
  const verificationContext = options["verification-context"];
  const limits = {maxRequests: number(options["max-windows"])};
  const budget = createLunaShadowBudget({maxAttempts: number(options["max-attempts"]),
    maxSourceBytes: number(options["max-payload-bytes"]), maxMicros: number(options["max-micros"])});
  if (!["windowed", "complete"].includes(options.arm) || !["recent", "attested"].includes(verificationContext) ||
      Math.max(maxVerification, maxTransitionVerification) > MAX_SHADOW_VERIFICATIONS || maxCueChecks > 8 || prefixUnits < 1 || prefixUnits > 32) {
    throw new Error("Use a supported arm and bounded verification limit.");
  }
  // Validate the entire cohort before any dispatch. Clearance input comes from
  // the trusted operator separately from the editions and approved labels.
  for (const {id, text, sourceSha256} of selected) {
    const entry = byId.get(id);
    const grant = entry?.grant;
    const index = buildWholeStoryIndex(text);
    if (!/^[a-z0-9-]{1,48}$/iu.test(id) || typeof sourceSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sourceSha256) ||
        (options.live && !grant) ||
        (entry?.blockedIds !== undefined && (!Array.isArray(entry.blockedIds) ||
          !entry.blockedIds.every(id => Number.isSafeInteger(id) && id >= 0 && id < index.units.length)))) {
      throw new Error("Use source-pinned editions and a separate current grant for each live work.");
    }
    planIndexedWholeStoryContext(index, {grant, limits});
    const targets = roster.get(id);
    if (targets) {
      const approved = new Set(grant?.spans.map(({id}) => id) ?? []);
      const grantedTargets = (ids, max) => Array.isArray(ids) && ids.length <= max &&
        new Set(ids).size === ids.length && ids.every(id => approved.has(id));
      if (targets.editionDigest !== index.editionDigest || !grantedTargets(targets.targetIds, maxVerification) ||
          !grantedTargets(targets.transitionTargetIds ?? [], verifyTransitions ? maxTransitionVerification : 0)) {
        throw new Error("Use exact granted native targets.");
      }
    }
  }
  const file = await open(output, "wx", 0o600);
  let written = false;
  try {
    const provider = options.live ? createLunaProtocolProvider({apiKey: process.env.OPENAI_API_KEY}) : undefined;
    const signal = AbortSignal.timeout(1_200_000);
    const results = [];
    for (const {id, text, sourceSha256} of selected) {
      const {grant, blockedIds} = byId.get(id) ?? {};
      const verificationTargets = roster.get(id)?.targetIds ?? [];
      const transitionTargets = roster.get(id)?.transitionTargetIds ?? [];
      const pinnedTargets = [...verificationTargets, ...transitionTargets];
      results.push(await runLunaProtocolShadow({id, text, sourceSha256, grant, blockedIds, provider, budget, signal,
        arm: options.arm, maxVerification, maxCueChecks, limits, prefixUnits, verificationContext, verificationTargets,
        verifyTransitions, maxTransitionVerification, transitionTargets,
        startId: pinnedTargets.length ? Math.min(...pinnedTargets) : 0}));
    }
    const manifest = {method: options.live ? "luna-protocol-live" : "luna-protocol-offline",
      model: options.live ? LUNA_PROTOCOL_MODEL : null,
      dimensions: ["depiction", "frame", "narrativePhase", "transition", "cue", "pattern", "phase", "knownAt", "evidenceIds", "beatId", "sceneId"],
      budget: budget.snapshot(), works: results};
    await file.writeFile(JSON.stringify(manifest) + "\n");
    written = true;
    return {method: manifest.method, works: results.length,
      units: results.reduce((count, work) => count + work.units.length, 0), budget: manifest.budget};
  } finally {
    await file.close();
    if (!written) await unlink(output);
  }
}

try {
  console.log(JSON.stringify(await main(flags())));
} catch (error) {
  const messages = ["Specify --editions and --output.", "Live shadow requires a trusted exact-range grant manifest and an authorized OPENAI_API_KEY.",
    "Write private study outputs outside the repository.", "Use source-pinned editions and a separate current grant for each live work.",
    "Use exact granted native targets."];
  console.error(messages.includes(error.message) ? error.message : "The shadow run could not complete. Check private paths, exact grants and limits.");
  process.exitCode = 1;
}

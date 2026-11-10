import {parseArgs} from "node:util";
import {createLunaProtocolProvider} from "./lib/luna-protocol-provider.mjs";
import {runLunaProtocolNeutral} from "./lib/luna-protocol-neutral.mjs";

export {runLunaProtocolNeutral};

const usage = "Use node scripts/run-luna-protocol-neutral.mjs [--mock | --live] [--arm windowed | complete].";
const missingKey = "Live neutral diagnostics require an authorized OPENAI_API_KEY.";

async function main() {
  const {values} = parseArgs({options: {mock: {type: "boolean"}, live: {type: "boolean"}, arm: {type: "string"}}});
  if (values.mock && values.live || values.arm && !["windowed", "complete"].includes(values.arm)) throw new Error(usage);
  const mode = values.live ? "live" : values.mock ? "mock" : "offline";
  let provider, externalCalls = 0;
  if (values.live) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error(missingKey);
    provider = createLunaProtocolProvider({apiKey, fetchImpl(...args) {
      externalCalls++;
      return fetch(...args);
    }});
  }
  const report = await runLunaProtocolNeutral({mode, arm: values.arm, provider, maxCueChecks: mode === "offline" ? 0 : 6,
    signal: AbortSignal.timeout(300_000)});
  console.log(JSON.stringify({...report, externalCalls}, null, 2));
}

if (import.meta.main) {
  try { await main(); }
  catch (error) {
    console.error(error.message === missingKey ? missingKey : error.message === usage || error.code?.startsWith("ERR_PARSE_ARGS") ?
      usage : "The neutral diagnostic could not complete.");
    process.exitCode = 1;
  }
}

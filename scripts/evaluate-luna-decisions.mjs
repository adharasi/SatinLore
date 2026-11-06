import {runDecisionsBenchmark} from "../deploy/cloudflare/decisions-benchmark.mjs";

const key = process.env.OPENAI_API_KEY;
if (process.argv.length !== 3 || process.argv[2] !== "--live-provider") {
  console.error("Use node scripts/evaluate-luna-decisions.mjs --live-provider to run up to four paid fixture requests.");
  process.exitCode = 1;
} else if (!key) {
  console.error("Configure an authorized OpenAI project key privately in OPENAI_API_KEY before running the benchmark.");
  process.exitCode = 1;
} else {
  try {
    const result = await runDecisionsBenchmark({key, signal: AbortSignal.timeout(120_000)});
    console.log(JSON.stringify({measurement: "live-provider", ...result}, null, 2));
    const usable = arm => arm.validMap && arm.mappedUnits > 0 && arm.calls.every(call => call.result === "parsed");
    if (result.aborted || result.fixtures.some(row => !usable(row.responses) || !usable(row.decisions))) process.exitCode = 1;
  } catch {
    console.error("The benchmark failed. Check the project key, API access and network configuration.");
    process.exitCode = 1;
  }
}

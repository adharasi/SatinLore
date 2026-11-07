import {runBuiltInWholeStoryLunaComparison, runWholeStoryReferenceReplay} from "./compare-whole-story-luna.mjs";

async function main(args) {
  if (!args.length) return runWholeStoryReferenceReplay();
  if (args.length === 1 && args[0] === "--masked") return runWholeStoryReferenceReplay({masked: true});
  if (args[0] !== "--live" || args.length % 2 === 0) throw new Error("invalid_arguments");
  const options = {};
  for (let index = 1; index < args.length; index += 2) {
    const key = {"--max-usd": "maxUsd", "--max-attempts": "maxAttempts"}[args[index]];
    if (!key || Object.hasOwn(options, key) || !/^\d+(?:\.\d+)?$/u.test(args[index + 1])) {
      throw new Error("invalid_arguments");
    }
    options[key] = Number(args[index + 1]);
  }
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("missing_key");
  return runBuiltInWholeStoryLunaComparison({apiKey: process.env.OPENAI_API_KEY, ...options,
    signal: AbortSignal.timeout(300_000)});
}

try {
  console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2));
} catch (error) {
  console.error(error.message === "missing_key" ? "Live study requires an authorized project key in OPENAI_API_KEY." :
    error.message === "invalid_arguments" ? "Use no arguments, --masked, or --live [--max-usd USD] [--max-attempts N]." :
      "The whole-story study could not complete. Check its configuration and attempt limits.");
  process.exitCode = 1;
}

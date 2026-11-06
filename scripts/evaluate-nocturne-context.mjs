// Compare the same original fixtures through the actual Worker contract.
// The default mock intentionally supplies some unsupported current beats.
import {handleSceneAnalysis} from "../deploy/cloudflare/scene-analysis.mjs";
import {
  NOCTURNE_CONTEXT_VERSION, PREVIOUS_NOCTURNE_CONTEXT_VERSION, validateNocturneContext,
} from "../app/static/reader/nocturne-context-contract.mjs";

const live = process.argv[2] === "--live-provider";
if (process.argv.length !== (live ? 3 : 2)) throw new Error("Use node scripts/evaluate-nocturne-context.mjs [--live-provider].");
const key = live ? process.env.OPENAI_API_KEY : "sk-fixture-context-evaluation";
if (!key) throw new Error("Supply an authorized OpenAI project key privately in OPENAI_API_KEY.");

const origin = "https://app.satinlore.test";
const config = {origin, issuer: "https://fixture.cloudflareaccess.com"};
const env = {OPENAI_API_KEY: key, SCENE_ANALYSIS_BUDGET: {
  idFromName: name => name, get: () => ({fetch: async () => new Response(null, {status: 204})}),
}};
const row = (id, label, eventKind, evidence, supportId = id) => ({id, label, eventKind, evidence, supportId, confidence: 95, shape: "unspecified"});
const fixtures = [
  {
    name: "current exchange and unrelated detail",
    paragraphs: [
      {id: 0, text: "'I hoped we might have dinner, just the two of us,' Anya said, smiling at Sam."},
      {id: 1, text: "'I was hoping you would ask,' Sam replied, reaching for her hand."},
      {id: 2, text: "They stayed by the doorway, still holding hands as they settled on Friday."},
      {id: 3, text: "The streetlights came on along the avenue."},
      {id: 4, text: "Inside, the caretaker sorted the keys."},
    ],
    targets: [1, 2, 3, 4], positives: new Set([1, 2]),
    mock: [row(0, "romance.build", "current", "direct"), row(1, "romance.build", "current", "exchange", 0),
      row(2, "romance.sustain", "current", "carry", 1), row(3, "neutral.quiet", "neutral", "none"),
      row(4, "romance.sustain", "current", "carry", 2)],
  },
  {
    name: "reported event and new scene",
    paragraphs: [
      {id: 5, text: "At lunch, Mari told her friend about the letter she had received years ago."},
      {id: 6, text: "The letter had described a long evening together, and Mari could still recall it."},
      {id: 8, text: "Back in the present, Mari looked at Rae. 'I think I'm falling for you,' she said."},
      {id: 9, text: "Rae smiled and took her hand. 'I feel the same way.'"},
    ],
    targets: [5, 6, 8, 9], positives: new Set([8, 9]),
    mock: [row(5, "romance.sustain", "reported", "none"), row(6, "romance.sustain", "current", "carry", 5),
      row(8, "romance.build", "current", "direct"), row(9, "romance.sustain", "current", "exchange", 8)],
  },
];

async function run(fixture, version) {
  const grounded = version === NOCTURNE_CONTEXT_VERSION;
  const {paragraphs, targets, positives} = fixture;
  const session = {subject: "fixture-reader", expiresAt: Date.now() + 60_000};
  const body = {version, consent: true, paragraphs, ...(grounded ? {targets} : {})};
  let calls = 0;
  const start = performance.now();
  const response = await handleSceneAnalysis(new Request(`${origin}/api/scene-analysis`, {
    method: "POST", headers: {Origin: origin, "Content-Type": "application/json"}, body: JSON.stringify(body),
  }), env, {config, session, reverify: async () => session, analysisFetcher: (url, options) => {
    calls++;
    if (live) return fetch(url, options);
    const labels = grounded ? fixture.mock : fixture.mock.map(({evidence, supportId, ...label}) => label);
    return Response.json({status: "completed", output: [{type: "message", role: "assistant", content: [
      {type: "output_text", text: JSON.stringify({labels})},
    ]}]});
  }});
  const elapsedMs = Math.round(performance.now() - start);
  const payload = await response.json();
  const result = response.ok ? validateNocturneContext(grounded ? targets.map(id => ({id})) : paragraphs, payload) : null;
  let trueCues = 0, falseCues = 0, missedCues = 0, abstentions = 0;
  for (const id of targets) {
    const label = result?.labels.get(id);
    const active = label?.eventKind === "current" && label.phase !== "quiet" && label.category !== "abstain";
    if (!label || label.category === "abstain") abstentions++;
    if (positives.has(id)) {
      if (active) trueCues++;
      else missedCues++;
    } else if (active) falseCues++;
  }
  return {fixture: fixture.name, version, calls, elapsedMs, status: response.status, code: payload.code ?? null,
    trueCues, falseCues, missedCues, abstentions, usage: result?.usage ?? null};
}

const results = [];
for (const fixture of fixtures) {
  for (const version of [PREVIOUS_NOCTURNE_CONTEXT_VERSION, NOCTURNE_CONTEXT_VERSION]) results.push(await run(fixture, version));
}
console.log(JSON.stringify({provider: live ? "live Luna" : "fixed mock responses", results}, null, 2));

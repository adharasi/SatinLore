// An evaluation-only scene-map experiment. Only the original fixtures below
// can be sent. Mock results exercise the mechanics, not model quality.
import {handleSceneAnalysis} from "../deploy/cloudflare/scene-analysis.mjs";
import {NOCTURNE_CONTEXT_VERSION, validateNocturneContext} from "../app/static/reader/nocturne-context-contract.mjs";
import {buildSceneUnits, compileSceneMap} from "../app/static/reader/scene-map.mjs";
import {analyzeNocturneSceneMap} from "./lib/nocturne-scene-analysis.mjs";

const live = process.argv[2] === "--live-provider";
if (process.argv.length !== (live ? 3 : 2)) throw new Error("Use node scripts/evaluate-nocturne-scene-map.mjs [--live-provider].");
const key = live ? process.env.OPENAI_API_KEY : "sk-fixture-scene-map";
if (!key) throw new Error("Supply an authorized OpenAI project key privately in OPENAI_API_KEY.");

const origin = "https://app.satinlore.test";
const config = {origin, issuer: "https://fixture.cloudflareaccess.com"};
const env = {OPENAI_API_KEY: key, SCENE_ANALYSIS_BUDGET: {
  idFromName: name => name, get: () => ({fetch: async () => new Response(null, {status: 204})}),
}};
const row = (id, label, eventKind, evidence, supportId = id) => ({id, label, eventKind, evidence, supportId, confidence: 95, shape: "unspecified"});
const beat = (first, last, phase, evidence = [first]) => ({first, last, phase, evidence,
  category: phase === "boundary" ? "neutral" : "romance", emphasis: phase === "boundary" ? 0 : 1});
const scene = (first, last, frame, beats = []) => ({first, last, frame, beats});
const fixtures = [
  {
    name: "implied invitation and interruption",
    paragraphs: [
      ["Rain tapped the windows.", "Sam put a second cup beside Anya's."],
      ["'I hoped you'd stay for dinner,' Sam said.", "'Only if it is just us,' Anya replied."],
      ["Sam reached for Anya's hand and she took it.", "The doorbell rang and they both stepped away."],
      ["The courier asked where to put the box."],
    ],
    positives: [2, 3, 4], boundaries: [5],
    mockV3: [row(0, "neutral.quiet", "neutral", "none"), row(1, "romance.build", "current", "direct"),
      row(2, "romance.sustain", "current", "exchange", 1), row(3, "neutral.quiet", "neutral", "none")],
    mockScenes: [scene(0, 6, "current", [beat(2, 3, "build", [2, 3]), beat(4, 4, "sustain"), beat(5, 5, "boundary"), beat(6, 6, "sustain")])],
    mockReject: [3],
  },
  {
    name: "report, return and reciprocation",
    paragraphs: [
      ["Years later, Mari told Rae about a dance.", "In her account the dancer had drawn closer."],
      ["Mari set the photograph aside and turned to Rae."],
      ["Mari asked, 'Would you dance with me now?'", "'I thought you'd never ask,' Rae said."],
      ["They joined hands and began to dance."],
    ],
    positives: [3, 4, 5], boundaries: [2],
    mockV3: [row(0, "romance.sustain", "reported", "none"), row(1, "neutral.quiet", "neutral", "boundary"),
      row(2, "romance.build", "current", "direct"), row(3, "romance.sustain", "current", "exchange", 2)],
    mockScenes: [scene(0, 1, "reported"), scene(2, 5, "current", [beat(2, 2, "boundary"), beat(3, 5, "sustain", [3, 4, 5])])],
    mockReject: [],
  },
];

function compare(expected, predicted) {
  const actual = new Set(predicted);
  return {
    found: expected.filter(id => actual.has(id)).length,
    missed: expected.filter(id => !actual.has(id)).length,
    false: [...actual].filter(id => !expected.includes(id)).length,
  };
}

function compareBeats(map, units, fixture) {
  const timeline = map ? compileSceneMap(map, units) : [];
  const positive = timeline.filter(item => item.emphasis > 0).map(item => item.id);
  const boundaries = timeline.filter(item => item.boundary).map(item => item.id);
  const toParagraphs = ids => [...new Set(ids.map(id => units[id].paragraph))];
  return {
    sentenceCues: compare(fixture.positives, positive),
    paragraphCues: compare(toParagraphs(fixture.positives), toParagraphs(positive)),
    sentenceBoundaries: compare(fixture.boundaries, boundaries),
  };
}

function fixtureResponse(value) {
  return Response.json({status: "completed", output: [{type: "message", role: "assistant",
    content: [{type: "output_text", text: JSON.stringify(value)}]}]});
}

async function baseline(fixture, paragraphs, units) {
  const source = paragraphs.map((text, id) => ({id, text}));
  const targets = source.map(row => row.id);
  const session = {subject: "fixture-reader", expiresAt: Date.now() + 60_000};
  const started = performance.now();
  let calls = 0;
  const response = await handleSceneAnalysis(new Request(`${origin}/api/scene-analysis`, {
    method: "POST", headers: {Origin: origin, "Content-Type": "application/json"},
    body: JSON.stringify({version: NOCTURNE_CONTEXT_VERSION, consent: true, paragraphs: source, targets}),
  }), env, {config, session, reverify: async () => session, analysisFetcher: (url, options) => {
    calls++;
    return live ? fetch(url, options) : fixtureResponse({labels: fixture.mockV3});
  }});
  const payload = await response.json();
  const result = response.ok ? validateNocturneContext(source, payload) : null;
  const labels = result ? [...result.labels.values()] : [];
  const isActive = label => label.eventKind === "current" && label.phase !== "quiet";
  const positiveParagraphs = [...new Set(fixture.positives.map(id => units[id].paragraph))];
  const boundaryParagraphs = new Set(fixture.boundaries.map(id => units[id].paragraph));
  return {calls, elapsedMs: Math.round(performance.now() - started), status: response.status, code: payload.code ?? null,
    usage: result?.usage ?? null, paragraphCues: compare(positiveParagraphs, labels.filter(isActive).map(label => label.id)),
    boundaryParagraphs: boundaryParagraphs.size,
    // The Worker discards boundary evidence. An active mixed paragraph can
    // hide an interruption even though its paragraph cue is a true positive.
    boundarySentencesInActiveParagraphs: fixture.boundaries.filter(id => labels.some(label =>
      isActive(label) && units[id].paragraph === label.id)).length};
}

async function sceneMap(fixture, units) {
  const provider = (request, {signal, phase}) => {
    if (live) return fetch("https://api.openai.com/v1/responses", {
      method: "POST", redirect: "error", signal,
      headers: {Authorization: `Bearer ${key}`, "Content-Type": "application/json"}, body: JSON.stringify(request),
    });
    if (phase === "extract") return fixtureResponse({scenes: fixture.mockScenes});
    const {beats} = JSON.parse(request.input);
    return fixtureResponse({decisions: beats.map(({id}) => ({id, verdict: fixture.mockReject.includes(id) ? "reject" : "keep"}))});
  };
  const {proposed, accepted, trace} = await analyzeNocturneSceneMap({
    units, approvedIds: units.map(unit => unit.id), provider, verify: true, signal: AbortSignal.timeout(180_000),
  });
  return {trace, extraction: compareBeats(proposed, units, fixture), afterReview: compareBeats(accepted, units, fixture)};
}

const results = [];
for (const fixture of fixtures) {
  const paragraphs = fixture.paragraphs.map(sentences => sentences.join(" "));
  const units = buildSceneUnits(paragraphs);
  if (units.length !== fixture.paragraphs.flat().length) throw new Error("The fixture's source units changed.");
  const v3 = await baseline(fixture, paragraphs, units);
  const map = await sceneMap(fixture, units);
  results.push({fixture: fixture.name, v3, sceneMap: map});
}
console.log(JSON.stringify({provider: live ? "live Luna" : "scripted fixtures, mechanics only", results}, null, 2));

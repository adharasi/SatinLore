import assert from "node:assert/strict";
import test from "node:test";
import {digestDecisionsCorpusWindow} from "../deploy/cloudflare/decisions-corpus-pins.mjs";
import {runDecisionsStoryStudy, validateStoryStudyPayload} from "../deploy/cloudflare/decisions-story-study.mjs";

const key = "sk-study-mock-0123456789";
const version = "story-study-mock-v1";
const sentence = "Only the pinned source can enter a request.";

function makeStory(id, texts, positives = [], boundaries = []) {
  const units = texts.map((text, index) => ({id: index, paragraph: index, start: 0, end: text.length, text,
    structuralBoundary: text === "***"}));
  return {id, units, positives, boundaries};
}

async function fixtures(calibration, holdout) {
  const pinsFor = stories => Promise.all(stories.map(async ({id, units, positives, boundaries}) => ({id,
    sha256: await digestDecisionsCorpusWindow(units), unitCount: units.length, positives, boundaries})));
  const pins = {version, calibration: await pinsFor(calibration), holdout: await pinsFor(holdout)};
  const payload = {version, split: "calibration", stories: calibration.map(({id, units}) => ({id, units}))};
  return {pins, payload};
}

function answer(question, choice) {
  return choice === null ? {type: "refusal", name: question.name, privateDetail: "private provider refusal"} :
    {type: "choice", name: question.name, choice, confidence: 1, probabilities: [{value: choice, probability: 1}]};
}

test("story study uses identical gapped source for both prompts and separates boundary votes from applied boundaries", async () => {
  const options = await fixtures([
    makeStory("first", [sentence, "The window rattled.", "The caretaker ended their private conversation."], [0], [2]),
    makeStory("second", ["They leaned toward each other.", "A siren broke into the moment.", "***"], [0], [1]),
  ], [makeStory("held", ["Held-out text never leaves in calibration."])]);
  const observed = [];
  const report = await runDecisionsStoryStudy({key, ...options, analysisFetcher: (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/decisions");
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    assert.equal(init.redirect, "manual");
    const {input, questions} = JSON.parse(init.body);
    const units = input[1].content[0].data.units;
    assert.doesNotMatch(init.body, /Held-out text/);
    const candidate = questions.some(item => item.name.endsWith("-boundary"));
    observed.push({units, candidate});
    const answers = questions.map(question => {
      const [, id, field] = /^u(\d+)-(joint|boundary)$/u.exec(question.name);
      const joint = field === "joint";
      const choice = joint ? {0: "build-romance", 1: candidate ? null : "quiet-neutral", 2: candidate ? "quiet-current" : "boundary",
        4: "sustain-romance", 5: "quiet-current"}[id] : ["2", "4", "5"].includes(id) ? "boundary" : "uncertain";
      return answer(question, choice);
    });
    return Response.json({model: "gpt-6-luna", answers, usage: {input_tokens: 30, output_tokens: 0, total_tokens: 30},
      privateDetail: "private provider body"});
  }});
  assert.equal(report.plannedProviderCalls, 2);
  assert.deepEqual(observed.map(item => item.candidate), [false, true]);
  assert.deepEqual(observed[0].units.map(unit => unit.id), [0, 1, 2, 4, 5, 6]);
  assert.deepEqual(observed[0].units, observed[1].units);
  assert.equal(report.totals.baseline.parsedCalls, 1);
  assert.equal(report.totals.candidate.parsedCalls, 1);
  assert.equal(report.totals.baseline.sentenceCues.found, 2);
  assert.equal(report.totals.candidate.sentenceCues.found, 2);
  assert.equal(report.totals.baseline.sentenceBoundaries.recall, .5);
  assert.equal(report.totals.baseline.independentBoundaryVotes, null);
  assert.equal(report.totals.candidate.sentenceBoundaries.recall, 1);
  assert.equal(report.totals.candidate.sentenceBoundaries.false, 0);
  assert.equal(report.totals.candidate.independentBoundaryVotes.false, 1);
  assert.equal(report.totals.candidate.answerCounts.boundaryConflicts, 1);
  assert.equal(report.totals.candidate.answerCounts.refusedUnits, 1);
  assert.equal(report.totals.candidate.mappedCoverage, 5 / 6);
  assert.equal(report.totals.candidate.usage.inputTokens.total, 30);
  assert.equal(report.stories[1].candidate.sentenceBoundaries.found, 1);
  assert.doesNotMatch(JSON.stringify(report), /Only the pinned source|private provider|sk-study-mock|boundaryIds/);
});

test("story study packs whole stories by size and preflights both split request bounds", async () => {
  const repeated = size => Array.from({length: size}, () => sentence);
  const options = await fixtures([makeStory("s1", repeated(23)), makeStory("s2", repeated(26)), makeStory("s3", repeated(22))],
    [makeStory("held", [sentence])]);
  const run = await validateStoryStudyPayload(options.payload, options.pins);
  assert.equal(run.plannedProviderCalls, 4);
  const calls = [];
  const report = await runDecisionsStoryStudy({key, ...options, analysisFetcher: (_, init) => {
    const {questions, input} = JSON.parse(init.body);
    calls.push([input[1].content[0].data.units.length, questions.some(item => item.name.endsWith("-boundary"))]);
    return new Response(null, {status: 429});
  }});
  assert.deepEqual(calls, [[48, false], [48, true], [23, true], [23, false]]);
  assert.deepEqual(report.batches.map(batch => batch.stories), [["s2", "s3"], ["s1"]]);
  assert.equal(report.totals.baseline.calls, 2);
  assert.equal(report.totals.baseline.parsedCalls, 0);
  assert.equal(report.totals.baseline.mappedCoverage, 0);
  assert.equal(report.totals.candidate.usage.inputTokens.total, null);

  const full = prefix => Array.from({length: 6}, (_, index) => makeStory(`${prefix}-${index}`, repeated(48)));
  const tooMany = await fixtures(full("development"), full("held"));
  await assert.rejects(validateStoryStudyPayload(tooMany.payload, tooMany.pins), TypeError);
  const tooManyInSplit = await fixtures([...full("development"), makeStory("other", [sentence])],
    [makeStory("held", [sentence])]);
  await assert.rejects(validateStoryStudyPayload(tooManyInSplit.payload, tooManyInSplit.pins), TypeError);
});

test("story study rejects text or order changes before calling either prompt", async () => {
  const options = await fixtures([makeStory("first", [sentence]), makeStory("second", ["Second story."])],
    [makeStory("held", ["Holdout story."])]);
  const changed = structuredClone(options.payload);
  changed.stories[1].units[0].text = "Random story.";
  let calls = 0;
  for (const payload of [changed, {...options.payload, stories: [...options.payload.stories].reverse()},
    {...options.payload, split: "unknown"}, {...options.payload, metadata: true}]) {
    await assert.rejects(runDecisionsStoryStudy({key, ...options, payload, analysisFetcher: () => { calls++; }}), TypeError);
  }
  assert.equal(calls, 0);
});

test("grounded retest spends one call per calibration batch and keeps holdout matched", async () => {
  const held = makeStory("held", ["They drew together.", "The bell ended the moment."], [0], [1]);
  const options = await fixtures([makeStory("first", [sentence, "The alarm interrupted them."], [0], [1])], [held]);
  const holdout = {version, split: "holdout", stories: [{id: held.id, units: held.units}]};
  const calls = [];
  const analysisFetcher = (_, init) => {
    const {input, questions} = JSON.parse(init.body);
    const candidate = questions.some(question => question.name.endsWith("-boundary"));
    calls.push({candidate, units: input[1].content[0].data.units});
    const answers = questions.map(question => {
      if (question.name.endsWith("-boundary")) {
        assert.deepEqual(question.choices.map(choice => choice.value), ["ends-beat", "returns-to-present", "no-boundary", "uncertain"]);
        return answer(question, question.name.startsWith("u1-") ? "ends-beat" : "no-boundary");
      }
      return answer(question, question.name.startsWith("u0-") ? "build-romance" : "quiet-current");
    });
    return Response.json({model: "gpt-6-luna", answers});
  };

  await assert.rejects(runDecisionsStoryStudy({key, ...options, analysisFetcher, candidateOnly: true}), TypeError);
  await assert.rejects(runDecisionsStoryStudy({key, ...options, payload: holdout, analysisFetcher,
    groundedCandidate: true, candidateOnly: true}), TypeError);
  assert.equal(calls.length, 0);
  const planned = await validateStoryStudyPayload(options.payload, options.pins, {candidateOnly: true});
  assert.equal(planned.plannedProviderCalls, 1);
  const retest = await runDecisionsStoryStudy({key, ...options, analysisFetcher, groundedCandidate: true, candidateOnly: true});
  assert.deepEqual(retest.prompts, {candidate: "joint-label-v4-grounded-boundary"});
  assert.deepEqual(Object.keys(retest.totals), ["candidate"]);
  assert.equal(retest.totals.candidate.parsedCalls, 1);
  assert.equal(retest.totals.candidate.independentBoundaryVotes.found, 1);
  assert.equal(retest.stories[0].baseline, undefined);
  assert.equal(retest.batches[0].baseline, undefined);
  assert.equal(calls[0].units[0].text, sentence);
  assert.equal(calls.length, 1);

  const matched = await runDecisionsStoryStudy({key, ...options, payload: holdout, analysisFetcher, groundedCandidate: true});
  assert.deepEqual(matched.prompts, {baseline: "joint-label-v2", candidate: "joint-label-v4-grounded-boundary"});
  assert.equal(matched.plannedProviderCalls, 2);
  assert.equal(matched.totals.baseline.parsedCalls, 1);
  assert.equal(matched.totals.candidate.parsedCalls, 1);
  assert.deepEqual(calls.map(call => call.candidate), [true, false, true]);
  assert.deepEqual(calls[1].units, calls[2].units);
  assert.equal(calls[1].units[0].text, held.units[0].text);
});

test("cue continuity compares only the first pinned calibration batch with identical source and questions", async () => {
  const first = makeStory("first", ["The adults shared a mutual moment.", "They held their embrace.",
    "The alarm made them pull apart.", ...Array(23).fill(sentence)], [0, 1], [2]);
  const second = makeStory("second", Array(22).fill(sentence));
  const later = makeStory("later", Array(23).fill("Only a later calibration batch contains this."));
  const held = makeStory("held", ["Held-out text."]);
  const options = await fixtures([first, second, later], [held]);
  const holdout = {version, split: "holdout", stories: [{id: held.id, units: held.units}]};
  const calls = [];
  const analysisFetcher = (_, init) => {
    const {input, questions} = JSON.parse(init.body);
    const candidate = /without a new act/u.test(input[0].content);
    calls.push({input, questions, candidate});
    const answers = questions.map(question => answer(question, question.name.endsWith("-boundary") ?
      question.name === "u2-boundary" ? "ends-beat" : "no-boundary" :
      question.name === "u0-joint" || candidate && question.name === "u1-joint" ? "sustain-romance" : "quiet-current"));
    return Response.json({model: "gpt-6-luna", answers});
  };

  const changed = structuredClone(options.payload);
  changed.stories[2].units[0].text = "Unapproved text.";
  for (const payload of [holdout, changed]) {
    await assert.rejects(runDecisionsStoryStudy({key, ...options, payload, analysisFetcher, cueContinuity: true}), TypeError);
  }
  assert.equal(calls.length, 0);
  const result = await runDecisionsStoryStudy({key, ...options, analysisFetcher, cueContinuity: true});
  assert.deepEqual(result.prompts, {baseline: "joint-label-v4-grounded-boundary", candidate: "joint-label-v5-cue-continuity"});
  assert.equal(result.plannedProviderCalls, 2);
  assert.deepEqual(result.stories.map(story => story.story), ["first", "second"]);
  assert.deepEqual(calls.map(call => call.candidate), [false, true]);
  assert.deepEqual(calls[0].input[1], calls[1].input[1]);
  assert.deepEqual(calls[0].questions, calls[1].questions);
  assert.match(calls[1].input[0].content, /does not establish adulthood, consent, current frame or phase/u);
  assert.doesNotMatch(JSON.stringify(calls), /Only a later calibration batch|Held-out text/u);
  assert.equal(result.totals.baseline.sentenceCues.found, 1);
  assert.equal(result.totals.candidate.sentenceCues.found, 2);
  assert.equal(result.totals.candidate.sentenceBoundaries.found, 1);
});

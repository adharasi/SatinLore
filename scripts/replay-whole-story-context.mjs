import {buildWholeStoryIndex, planWholeStoryContext, WHOLE_STORY_GRANT_PURPOSE}
  from "./lib/whole-story-context-planning.mjs";
import {executeWholeStoryContextPlan} from "./lib/whole-story-context-execution.mjs";
import {wholeStoryAnnotationFixtures} from "../tests/whole-story-annotation-fixtures.mjs";

const cases = [];
for (const {id, paragraphs, phases, evidence, events} of wholeStoryAnnotationFixtures) {
  const text = paragraphs.join("\n\n");
  const {editionDigest, segmentationVersion, units} = buildWholeStoryIndex(text);
  if (phases.length !== units.length) throw new Error("The neutral reference is out of sync with the sentence index.");
  const now = 1_000;
  const omitted = id === "first-dance" ? new Set([4]) : new Set();
  const spans = units.filter(unit => !omitted.has(unit.id)).map(({id, byteStart, byteEnd, digest}) =>
    ({id, byteStart, byteEnd, digest}));
  const grant = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: now + 1, spans};
  const plan = planWholeStoryContext(text, {grant, now, limits: {maxTargetsPerWindow: 4}});
  let inFlight = 0, maxInFlight = 0;
  const {windows, progress} = await executeWholeStoryContextPlan(plan, {
    async request(window) {
      const allowed = new Set([...window.contextIds, ...window.targetIds]);
      if ([...allowed].some(id => omitted.has(id))) throw new Error("A withheld sentence reached the mock transport.");
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setImmediate(resolve));
      inFlight--;
      // The mock replays the reference only where its evidence is available
      // to this request. It does not infer a cue or make a provider call.
      return {status: "annotated", annotations: window.targetIds.map(id => ({id,
        phase: (evidence[id] ?? []).every(anchor => anchor <= id && allowed.has(anchor)) ? phases[id] : "abstain"}))};
    },
  });
  cases.push({id, referenceUnits: phases.length, referenceCues: phases.filter(phase => phase !== "quiet").length,
    referenceEvents: Object.keys(events).length, planning: plan.summary, execution: progress, maxInFlight,
    mockAbstentions: windows.flatMap(window => window.annotations ?? []).filter(row => row.phase === "abstain").length});
}
console.log(JSON.stringify({measurement: "offline-whole-story-mock-transport", providerCalls: 0, cases}, null, 2));

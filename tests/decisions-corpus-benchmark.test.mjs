import assert from "node:assert/strict";
import test from "node:test";
import {runDecisionsCorpusBenchmark} from "../deploy/cloudflare/decisions-corpus-benchmark.mjs";
import {DECISIONS_CORPUS_PINS, DECISIONS_CORPUS_VERSION} from "../deploy/cloudflare/decisions-corpus-pins.mjs";

function unsignedCorpus() {
  const text = "Neutral test sentence.";
  return {version: DECISIONS_CORPUS_VERSION, windows: DECISIONS_CORPUS_PINS.map(({id, approvedUnitCount}) => ({
    id, units: Array.from({length: approvedUnitCount}, (_, index) => ({
      id: index, paragraph: index, start: 0, end: text.length, text, structuralBoundary: false,
    })),
  }))};
}

test("hosted corpus rejects unpinned units and unsupported envelopes without calling the provider", async () => {
  let calls = 0;
  const analysisFetcher = () => { calls++; };
  const unsigned = unsignedCorpus();
  for (const payload of [
    unsigned,
    {...unsigned, extra: true},
    {...unsigned, windows: unsigned.windows.slice(0, 2)},
    {...unsigned, windows: [...unsigned.windows].reverse()},
  ]) {
    await assert.rejects(runDecisionsCorpusBenchmark({key: "sk-test-approved-corpus-0123", analysisFetcher, payload}), TypeError);
  }
  assert.equal(calls, 0);
});

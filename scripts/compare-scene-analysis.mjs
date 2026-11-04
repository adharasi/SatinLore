// Compare two trusted local checkouts against the same original test stories.
import {realpath} from "node:fs/promises";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {isDeepStrictEqual} from "node:util";
import * as current from "../app/static/reader/model.mjs";
import {SCENE_EVALUATION_STORIES, evaluateSceneStory} from "../tests/scene-evaluation-fixtures.mjs";

const [baselineDirectory] = process.argv.slice(2);
if (!baselineDirectory || process.argv.length !== 3) {
  throw new Error("Use node scripts/compare-scene-analysis.mjs <trusted baseline checkout>.");
}

const baselinePath = join(await realpath(baselineDirectory), "app/static/reader/model.mjs");
const baseline = await import(pathToFileURL(baselinePath).href);

function report({ReaderModel, ANALYSIS_VERSION}) {
  const passages = SCENE_EVALUATION_STORIES.flatMap(story => evaluateSceneStory(ReaderModel, story));
  const mismatches = passages.filter(({expected, observed}) => !isDeepStrictEqual(expected, observed));
  return {
    version: ANALYSIS_VERSION,
    total: passages.length,
    matched: passages.length - mismatches.length,
    missedActivations: passages.filter(({expected, observed}) => expected.active && !observed.active).length,
    unexpectedActivations: passages.filter(({expected, observed}) => !expected.active && observed.active).length,
    movementMismatches: passages.filter(({expected, observed}) => expected.active && observed.active &&
      !isDeepStrictEqual(expected.movements, observed.movements)).length,
    mismatches,
  };
}

console.log(JSON.stringify({baseline: report(baseline), current: report(current)}, null, 2));

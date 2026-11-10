// Local stdin/stdout bridge for the offline Python-to-JavaScript parity check.
import {readFileSync} from "node:fs";
import {planStory} from "../../app/static/reader/beat-continuity.mjs";

try {
  const {schema, stories} = JSON.parse(readFileSync(0, "utf8"));
  if (schema !== "satinlore-approved-beat-inputs-v1" || !Array.isArray(stories)) {
    throw new Error("Expected normalized approved beat inputs.");
  }
  const outputs = stories.map(({story, units}) => ({story, rows: planStory(story, units)}));
  process.stdout.write(JSON.stringify(outputs));
} catch {
  console.error("The JavaScript planner could not replay the normalized approved inputs.");
  process.exitCode = 1;
}

# Founder whole story Luna comparison

This research harness compares GPT-6 Luna Responses on four digest-pinned original neutral fixtures. Its annotations have no reader or device authority. The input set is fixed in source and the hosted form accepts no story uploads.

The whole arm receives one exact cleared edition with sentence byte offsets. The paragraph arm receives up to two complete cleared paragraphs per request and runs up to two independent requests concurrently. The sentence arm checks each target against up to 24 preceding cleared sentences from the same uninterrupted run. All arms retain the same sentence target denominator and the scorer counts missing or unusable results.

The strict response schema has one annotation per target with `id`, `status`, `depiction`, `frame`, `action`, `phase`, `transition` and `evidenceIds`. Positive cues and transitions require valid source evidence. The sentence arm rejects future evidence. Responses return aggregate cue, transition, coverage, timing and token counts without source prose or provider error text.

Run the offline reference and masked admission checks from the repository root.

```sh
node scripts/run-whole-story-luna-study.mjs
node scripts/run-whole-story-luna-study.mjs --masked
node --test tests/whole-story-*.test.mjs tests/scene-analysis-worker.test.mjs
```

The reference replay returns known labels when their required source anchors are present. Its scores measure the planning and evaluation contract. Live provider quality requires the API run.

For the authorized founder API comparison, supply the project key privately as `OPENAI_API_KEY` and run the following command. The defaults bound the study at 96 attempted calls and an estimated $5 budget. Each attempt reserves its estimated usage before dispatch and retains the reservation when reported usage is missing.

```sh
node scripts/run-whole-story-luna-study.mjs --live --max-usd 5 --max-attempts 96
```

The hosted route is `/api/scene-analysis/whole-story-luna-study` on `app.satinlore.com`. Enable it with the runtime variable `WHOLE_STORY_LUNA_STUDY_ENABLED=true`. It requires the existing signed founder Cloudflare Access session, exact origin and the fixed study form. It reuses the server-side `OPENAI_API_KEY` secret and existing `SCENE_ANALYSIS_BUDGET` binding. No migration is required. The hosted run has a 64-attempt daily study allowance, an estimated $1 ceiling and a three-minute deadline, alongside the existing deployment-wide quotas. Disabling the variable hides the route.

Whole-edition admission is bounded at 500,000 source bytes, 750,000 encoded planner bytes and 1,200 sentence targets. The adapter scales the whole-arm output allowance with the target count, up to 128,000 tokens. Ordinary paragraph and sentence windows remain bounded at 12,000 source bytes and 16,384 encoded planner bytes. These bounds require live complete-output and latency measurements before expanding the corpus. A refusal blocks overlapping material across the remaining arms. Missing, refused and incomplete outputs remain explicit results.

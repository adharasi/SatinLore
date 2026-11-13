import { LUNA_PROTOCOL_RUBRIC_VERSION } from "../../scripts/lib/luna-protocol-provider.mjs";

export const LUNA_CORPUS_PAGE = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>SatinLore founder Luna corpus review</title>
<main><h1>SatinLore founder Luna corpus review</h1>
<p>Luna rubric ${LUNA_PROTOCOL_RUBRIC_VERSION.split("-").at(-1)} with local-action and scene-entry checks and bounded anchor repair.</p>
<p>Open a private review packet. The file is read in this browser. Review every sentence in a clip before approving it, including the sentences supplied as context.</p>
<p>Sealing sends clip fingerprints. Running sends the selected excerpts to the private Worker and OpenAI. One sealed run has a $3 estimated spend cap. Checkpoints include labels and evidence IDs for offline replay.</p>
<p><label>Review packet <input id="packet" type="file" accept=".json,application/json"></label></p>
<p id="status" role="status" aria-live="polite">Load a review packet to begin.</p>
<p><button id="selectall" type="button" disabled>Select all reviewed excerpts</button> <button id="seal" type="button" disabled>Seal selected excerpts</button> <button id="run" type="button" disabled>Run sealed excerpts</button>
<button id="pause" type="button" disabled>Pause after current clip</button> <button id="save" type="button" disabled>Download results checkpoint</button></p>
<section id="review" aria-label="Proposed excerpts"></section></main>
<script type="module" src="/api/scene-analysis/luna-corpus/client.mjs"></script></html>`;

export const LUNA_CORPUS_CLIENT = String.raw`
const base = "/api/scene-analysis/luna-corpus";
const byId = id => document.getElementById(id);
const packetInput = byId("packet"), message = byId("status"), review = byId("review");
const selectAll = byId("selectall");
const seal = byId("seal"), run = byId("run"), pause = byId("pause"), save = byId("save");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const digest = /^[a-f0-9]{64}$/u;
const workId = /^[a-z][a-z0-9-]{0,47}$/u;
const returned = new Set(["completed", "provider-refused", "provider-unavailable", "spend-cap", "timed-out"]);
const done = new Set([...returned, "unconfirmed", "budget-deferred"]);
const replayUnitKeys = ["id", "unitSha256", "status", "discoveryStatus", "verificationStatus", "transitionVerificationStatus",
  "boundaryVerificationStatus", "localActionVerificationStatus", "sceneEntryVerificationStatus", "cueRecoveryStatus",
  "cueRecoveryReason", "cueRecoveryCorrection",
  "independentBoundaryStatus", "sceneSituationVerificationStatus", "sceneOldPlaceVerificationStatus",
  "sceneArrivalVerificationStatus", "scenePlaceRecoveryStatus", "sustainConnectorVerificationStatus",
  "interruptionContinuationVerificationStatus", "uncertainContinuationVerificationStatus", "interruptionReleaseVerificationStatus",
  "playbackDisposition", "localActionApplication"];
const replayFactKeys = ["id", "unitId", "depiction", "frame", "narrativePhase", "action", "transition", "fact", "status", "scopeId", "evidenceIds", "priorAnchor"];
const replayBoundaryKeys = ["status", "reason", "previousId", "entryId"];
const replayLocalActionKeys = ["status", "frame", "action", "phase", "contrast", "targetId", "contextId"];
const replaySituationKeys = ["status", "earlierId", "currentId", "earlierBasis", "currentBasis"];
const replayPlaceKeys = ["status", "earlierId", "currentId"];
const replayTraceKeys = ["beat", "scene", "decision", "knownAt", "evidence", "holdWords", "fadeWords", "floorWords", "wordOffset"];
const replayFactStages = ["discovery", "primaryPrefix", "transitionVerification", "cueRecovery",
  "interruptionContinuationVerification", "uncertainContinuationVerification", "interruptionReleaseVerification", "sustainConnectorVerification"];
const encoder = new TextEncoder();
const natural = n => Number.isSafeInteger(n) && n >= 0;
let packet, packetDigest, state, busy = false, pausing = false;
const selections = new Map();

function canonicalClip(value) {
  const {id, storyId, sourceSha256, editionDigest, units, targetIds} = value ?? {};
  if (!uuid.test(id) || !workId.test(storyId) || !digest.test(sourceSha256) || !digest.test(editionDigest) ||
      !Array.isArray(units) || units.length < 1 || units.length > 24 || !Array.isArray(targetIds) ||
      targetIds.length < 1 || targetIds.length > 6) throw new Error("Invalid clip identity or bounds.");
  const canonicalUnits = units.map(({id, paragraph, byteStart, byteEnd, digest: hash, text}, i) => {
    if (!natural(id) || !natural(paragraph) || !natural(byteStart) || !natural(byteEnd) || byteStart >= byteEnd ||
        !digest.test(hash) || typeof text !== "string" || !text.trim() || encoder.encode(text).length !== byteEnd - byteStart ||
        i && (id !== units[i - 1].id + 1 || byteStart < units[i - 1].byteEnd || paragraph < units[i - 1].paragraph)) {
      throw new Error("Invalid excerpt coordinates.");
    }
    return {id, paragraph, byteStart, byteEnd, digest: hash, text};
  });
  if (canonicalUnits.reduce((bytes, unit) => bytes + encoder.encode(unit.text).length, 0) > 6000 ||
      targetIds.some((id, i) => !canonicalUnits.some(unit => unit.id === id) || i && id <= targetIds[i - 1])) {
    throw new Error("Invalid target roster or excerpt size.");
  }
  return {id, storyId, sourceSha256, editionDigest, units: canonicalUnits, targetIds};
}

async function fingerprint(clip) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(clip)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function key() { return "satinlore:luna-corpus:v1:" + packet.runId; }

function updateControls() {
  packetInput.disabled = busy;
  selectAll.disabled = busy || !packet || Boolean(state) || [...selections.values()].every(input => input.checked);
  seal.disabled = busy || !packet || Boolean(state) || ![...selections.values()].some(input => input.checked);
  run.disabled = busy || !state || state.haltReason || state.expiresAt <= Date.now() || !state.approved.some(row => !done.has(state.outcomes[row.id]));
  pause.disabled = !busy || !state || pausing;
  save.disabled = !state || busy;
  for (const input of selections.values()) input.disabled = busy || Boolean(state);
}

function persist() {
  try { localStorage.setItem(key(), JSON.stringify(state)); return true; }
  catch { return false; }
}

function render() {
  selections.clear();
  const fragment = document.createDocumentFragment();
  for (const clip of packet.clips) {
    const details = document.createElement("details"), heading = document.createElement("summary");
    const label = document.createElement("label"), input = document.createElement("input"), text = document.createElement("pre");
    heading.textContent = clip.storyId + " · units " + clip.units[0].id + "–" + clip.units.at(-1).id +
      " · targets " + clip.targetIds.join(", ") + (state ? " · " + (state.outcomes[clip.id] ?? "approved") : "");
    input.type = "checkbox";
    input.checked = Boolean(state?.approved.some(row => row.id === clip.id));
    input.addEventListener("change", updateControls);
    label.append(input, " Approve this exact excerpt and all context for this run");
    text.style.whiteSpace = "pre-wrap";
    text.textContent = clip.units.map(unit => (clip.targetIds.includes(unit.id) ? "Target " : "Context ") + unit.id + "\n" + unit.text).join("\n\n");
    details.append(heading, text, label);
    fragment.append(details);
    selections.set(clip.id, input);
  }
  review.replaceChildren(fragment);
  updateControls();
}

function post(path, data) {
  return fetch(base + path, {method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: {"Content-Type": "application/json"}, body: JSON.stringify(data)});
}

packetInput.addEventListener("change", async () => {
  const file = packetInput.files[0];
  if (!file) return;
  busy = true;
  packet = undefined;
  state = undefined;
  selections.clear();
  review.replaceChildren();
  updateControls();
  try {
    if (file.size > 2_000_000) throw new Error("The review packet is too large.");
    const source = JSON.parse(await file.text());
    if (source?.schema !== 1 || !uuid.test(source.runId) || !Array.isArray(source.clips) ||
        source.clips.length < 1 || source.clips.length > 123) throw new Error("Invalid review packet.");
    const clips = source.clips.map(canonicalClip);
    const ids = new Set(), targetKeys = new Set(), editions = new Map();
    for (const clip of clips) {
      const identity = clip.sourceSha256 + clip.editionDigest;
      if (ids.has(clip.id) || editions.has(clip.storyId) && editions.get(clip.storyId) !== identity ||
          clip.targetIds.some(id => targetKeys.has(clip.storyId + ":" + id))) throw new Error("Duplicate clip, target, or edition conflict.");
      ids.add(clip.id);
      editions.set(clip.storyId, identity);
      for (const id of clip.targetIds) targetKeys.add(clip.storyId + ":" + id);
    }
    packet = {runId: source.runId, clips};
    packetDigest = await fingerprint(packet);
    let retained;
    try { retained = localStorage.getItem(key()); } catch { /* A manual result download is still available. */ }
    if (retained) {
      const restored = JSON.parse(retained), byClip = new Map(clips.map(clip => [clip.id, clip]));
      if (restored.runId !== packet.runId || restored.packetDigest !== packetDigest || !Array.isArray(restored.approved) || !restored.approved.length ||
          !restored.outcomes || !restored.results || !natural(restored.expiresAt) ||
          !(await Promise.all(restored.approved.map(async row => byClip.has(row.id) && await fingerprint(byClip.get(row.id)) === row.digest))).every(Boolean)) {
        throw new Error("Saved checkpoint does not match these exact excerpts.");
      }
      state = restored;
      for (const row of state.approved) if (state.outcomes[row.id] === "in-flight") state.outcomes[row.id] = "unconfirmed";
      persist();
    }
    message.textContent = state ? "Matching checkpoint loaded. Unconfirmed clips will not be retried automatically." :
      clips.length + " proposed clips are loaded locally. Review and select the exact excerpts to approve.";
  } catch (error) {
    packet = undefined;
    state = undefined;
    message.textContent = error.message || "The review packet could not be read.";
  } finally {
    busy = false;
    if (packet) render();
    else updateControls();
  }
});

selectAll.addEventListener("click", () => {
  if (!packet || busy || state) return;
  for (const input of selections.values()) input.checked = true;
  updateControls();
});

seal.addEventListener("click", async () => {
  const selected = packet.clips.filter(clip => selections.get(clip.id).checked);
  if (!selected.length || state || busy) return;
  busy = true;
  updateControls();
  try {
    const approved = await Promise.all(selected.map(async clip => ({id: clip.id, digest: await fingerprint(clip)})));
    const response = await post("/approve", {runId: packet.runId, clips: approved, reviewConfirmed: true});
    const result = await response.json();
    if (!response.ok || result.runId !== packet.runId || result.clipCount !== approved.length || !natural(result.expiresAt)) {
      message.textContent = response.status === 409 ? "This run already has a different sealed roster." : "The roster was not sealed.";
      return;
    }
    const selectedIds = new Set(approved.map(row => row.id));
    state = {runId: packet.runId, packetDigest, approved, expiresAt: result.expiresAt, outcomes: Object.fromEntries(packet.clips
      .filter(clip => !selectedIds.has(clip.id)).map(clip => [clip.id, "withheld"])), results: {}};
    message.textContent = approved.length + " exact excerpts sealed. Start the run when ready.";
    persist();
  } catch {
    message.textContent = "Sealing could not be confirmed. Retry with the same selection.";
  } finally { busy = false; if (state) render(); else updateControls(); }
});

function validResult(result, clip, row) {
  return result?.runId === packet.runId && result.clipId === clip.id && result.clipDigest === row.digest &&
    result.storyId === clip.storyId && result.sourceSha256 === clip.sourceSha256 && result.editionDigest === clip.editionDigest &&
    returned.has(result.status) && typeof result.rubricVersion === "string" &&
    typeof result.model === "string" && Array.isArray(result.units) && Array.isArray(result.summary?.attempts) &&
    (!state.rubricVersion || state.rubricVersion === result.rubricVersion && state.model === result.model);
}

run.addEventListener("click", async () => {
  if (!state || busy || state.haltReason || state.expiresAt <= Date.now()) return;
  busy = true;
  pausing = false;
  updateControls();
  const byClip = new Map(packet.clips.map(clip => [clip.id, clip]));
  for (const row of state.approved) {
    if (pausing || state.expiresAt <= Date.now()) break;
    if (done.has(state.outcomes[row.id])) continue;
    const clip = byClip.get(row.id);
    state.outcomes[row.id] = "in-flight";
    persist();
    message.textContent = "Running excerpt for " + clip.storyId + ".";
    try {
      const response = await post("/shard", {runId: packet.runId, clip});
      const result = await response.json();
      if (response.ok && validResult(result, clip, row)) {
        state.rubricVersion = result.rubricVersion;
        state.model = result.model;
        state.results[row.id] = {units: result.units, attempts: result.summary.attempts, budget: result.summary.budget ?? result.budget,
          externalCalls: result.externalCalls, hostedSpend: result.hostedSpend};
        state.outcomes[row.id] = result.status;
        if (result.status === "provider-refused") state.haltReason = "Luna refused an excerpt. The sealed run is closed.";
        if (result.status === "provider-unavailable") state.haltReason = "Luna returned a terminal provider error. The sealed run is closed.";
        if (result.status === "spend-cap" || result.status === "timed-out" || result.hostedSpend?.settled === false || state.haltReason) pausing = true;
      } else if (result.code === "spend_cap" || result.code === "budget_exhausted") {
        state.outcomes[row.id] = "budget-deferred";
        state.haltReason = "The shared run spend cap was reached.";
        pausing = true;
      } else if (result.code === "shard_in_flight") {
        delete state.outcomes[row.id];
        pausing = true;
      } else {
        state.outcomes[row.id] = "unconfirmed";
        pausing = true;
      }
    } catch {
      state.outcomes[row.id] = "unconfirmed";
      pausing = true;
    }
    persist();
  }
  busy = false;
  const resolved = state.approved.filter(row => done.has(state.outcomes[row.id])).length;
  const stored = persist();
  message.textContent = (state.haltReason ? state.haltReason + " " : "") + resolved + " of " + state.approved.length +
    " selected excerpts have a recorded disposition. Download the results checkpoint." + (!stored ? " Automatic checkpoint storage is unavailable." : "");
  render();
});

pause.addEventListener("click", () => { pausing = true; updateControls(); });

function fields(row, keys) {
  return Object.fromEntries(keys.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
}

function replayUnit(row) {
  const result = fields(row, replayUnitKeys);
  if (row.trace) result.trace = fields(row.trace, replayTraceKeys);
  for (const stage of replayFactStages) if (row[stage]) result[stage] = fields(row[stage], replayFactKeys);
  if (row.transitionVerification?.sceneBoundary) {
    result.transitionVerification.sceneBoundary = fields(row.transitionVerification.sceneBoundary, replayBoundaryKeys);
  }
  if (row.boundaryVerification?.sceneBoundary) {
    result.boundaryVerification = {...fields(row.boundaryVerification, ["id", "unitId"]),
      sceneBoundary: fields(row.boundaryVerification.sceneBoundary, [...replayBoundaryKeys, "changeId", "contrast"])};
  }
  if (row.localActionVerification?.localAction) {
    result.localActionVerification = {...fields(row.localActionVerification, ["id", "unitId"]),
      localAction: fields(row.localActionVerification.localAction, replayLocalActionKeys)};
  }
  if (row.sceneEntryVerification?.sceneEntry) {
    result.sceneEntryVerification = {...fields(row.sceneEntryVerification, ["id", "unitId"]),
      sceneEntry: fields(row.sceneEntryVerification.sceneEntry, [...replayBoundaryKeys, "changeId"])};
  }
  if (row.sceneSituationVerification?.sceneSituation) {
    result.sceneSituationVerification = {...fields(row.sceneSituationVerification, ["id", "unitId"]),
      sceneSituation: fields(row.sceneSituationVerification.sceneSituation, replaySituationKeys)};
  }
  for (const stage of ["sceneOldPlaceVerification", "sceneArrivalVerification"]) if (row[stage]?.scenePlace) {
    result[stage] = {...fields(row[stage], ["id", "unitId"]), scenePlace: fields(row[stage].scenePlace, replayPlaceKeys)};
  }
  return result;
}

save.addEventListener("click", () => {
  const works = new Map();
  const replayClips = [];
  for (const clip of packet.clips) {
    if (!works.has(clip.storyId)) works.set(clip.storyId, {id: clip.storyId, sourceSha256: clip.sourceSha256,
      editionDigest: clip.editionDigest, units: [], summary: {attempts: []}});
    const result = state.results[clip.id];
    if (!result) continue;
    const work = works.get(clip.storyId);
    work.units.push(...result.units.filter(unit => clip.targetIds.includes(unit.id)));
    work.summary.attempts.push(...result.attempts);
    replayClips.push({id: clip.id, units: result.units.map(replayUnit), attempts: result.attempts});
  }
  for (const work of works.values()) work.units.sort((a, b) => a.id - b.id);
  const result = {schema: 1, measurement: "live-corpus-luna", sourceProseIncluded: false, runId: packet.runId,
    rubricVersion: state.rubricVersion ?? null, model: state.model ?? null, works: [...works.values()], replayClips,
    clips: packet.clips.map(clip => ({id: clip.id, storyId: clip.storyId, targetIds: clip.targetIds,
      status: state.outcomes[clip.id] ?? "not-dispatched", externalCalls: state.results[clip.id]?.externalCalls ?? 0,
      budget: state.results[clip.id]?.budget, hostedSpend: state.results[clip.id]?.hostedSpend}))};
  const url = URL.createObjectURL(new Blob([JSON.stringify(result)], {type: "application/json"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = "satinlore-luna-corpus-results.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
`;

import {MAX_TEXT_BYTES, MAX_TEXT_CHARACTERS} from "./import.mjs";

export const SCENE_FRAMES = Object.freeze(["current", "reported", "imagined", "historical", "neutral", "uncertain", "mixed"]);
export const BEAT_PHASES = Object.freeze(["build", "sustain", "peak", "recover", "boundary"]);
export const BEAT_CATEGORIES = Object.freeze(["neutral", "romance", "flirting", "tension", "intimacy", "explicit", "aftermath"]);
export const MAX_SCENE_UNITS = 20_000;
const MAX_SOURCE_PARAGRAPHS = 2_000;
const encoder = new TextEncoder();
const separator = /^(?:[\s*#~_—–-]{3,}|(?:chapter|part|book|scene)\s+(?:\d+|[ivxlcdm]{1,8}|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*[:.\-–—].*)?)$/iu;
const between = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const exactFields = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalidUnits = () => new TypeError("Invalid scene source units.");
const invalidMap = () => new TypeError("Invalid scene map.");

// IDs are ordinal within this loaded story. Offsets are half-open UTF-16
// indices into the original paragraph so consumers never have to resegment it.
export function buildSceneUnits(paragraphs) {
  if (!Array.isArray(paragraphs) || paragraphs.length > MAX_SOURCE_PARAGRAPHS) throw invalidUnits();
  const segmenter = new Intl.Segmenter("en", {granularity: "sentence"});
  const units = [];
  let bytes = 0;
  for (const [paragraph, input] of paragraphs.entries()) {
    const text = typeof input === "string" ? input : input?.text;
    if (typeof text !== "string" || text.length > MAX_TEXT_CHARACTERS) throw invalidUnits();
    bytes += encoder.encode(text).length;
    if (bytes > MAX_TEXT_BYTES) throw invalidUnits();
    const add = (source, offset, structuralBoundary) => {
      const content = source.trim();
      if (!content) return;
      if (units.length === MAX_SCENE_UNITS) throw invalidUnits();
      const start = offset + source.length - source.trimStart().length;
      units.push({id: units.length, paragraph, start, end: start + content.length, text: content, structuralBoundary});
    };
    const segment = (start, end) => {
      // Printed line wraps are not sentence breaks. Preserve the original
      // source and offsets by replacing each line-ending code unit in place.
      const view = text.slice(start, end).replace(/[\r\n]/g, " ");
      for (const {segment: sentence, index} of segmenter.segment(view)) {
        const offset = start + index;
        add(text.slice(offset, offset + sentence.length), offset, false);
      }
    };
    let start = 0, offset = 0;
    for (const line of text.split("\n")) {
      if (separator.test(line.trim())) {
        segment(start, offset);
        add(line, offset, true);
        start = offset + line.length + 1;
      }
      offset += line.length + 1;
    }
    segment(start, text.length);
  }
  return units;
}

function sourcePositions(units) {
  if (!Array.isArray(units) || units.length > MAX_SCENE_UNITS) throw invalidUnits();
  const positions = new Map();
  let priorId = -1, priorParagraph = -1, priorEnd = 0, bytes = 0;
  for (const [index, unit] of units.entries()) {
    if (!exactFields(unit, ["id", "paragraph", "start", "end", "text", "structuralBoundary"]) ||
        !between(unit.id, priorId + 1, MAX_SCENE_UNITS - 1) ||
        !between(unit.paragraph, priorParagraph < 0 ? 0 : priorParagraph, MAX_SOURCE_PARAGRAPHS - 1) ||
        !between(unit.start, unit.paragraph === priorParagraph ? priorEnd : 0, MAX_TEXT_CHARACTERS - 1) ||
        !between(unit.end, unit.start + 1, MAX_TEXT_CHARACTERS) ||
        typeof unit.text !== "string" || unit.text.length !== unit.end - unit.start || unit.text.trim() !== unit.text ||
        typeof unit.structuralBoundary !== "boolean") throw invalidUnits();
    bytes += encoder.encode(unit.text).length;
    if (bytes > MAX_TEXT_BYTES) throw invalidUnits();
    positions.set(unit.id, index);
    priorId = unit.id;
    priorParagraph = unit.paragraph;
    priorEnd = unit.end;
  }
  return positions;
}

export function validateSceneMap(map, units) {
  const positions = sourcePositions(units);
  if (!exactFields(map, ["scenes"]) || !Array.isArray(map.scenes) || map.scenes.length > units.length) throw invalidMap();
  let previous = -1;
  return {scenes: Array.from(map.scenes, scene => {
    if (!exactFields(scene, ["first", "last", "frame", "beats"])) throw invalidMap();
    const {first, last, frame, beats} = scene;
    const start = positions.get(first), end = positions.get(last);
    if (!between(first, previous + 1, MAX_SCENE_UNITS - 1) || !between(last, first, MAX_SCENE_UNITS - 1) ||
        start === undefined || end === undefined || end - start !== last - first ||
        !SCENE_FRAMES.includes(frame) || !Array.isArray(beats) || beats.length > last - first + 1) throw invalidMap();
    for (let index = start; index <= end; index++) {
      if (units[index].structuralBoundary && (first !== last || frame !== "neutral")) throw invalidMap();
    }
    previous = last;
    let lastBeat = first - 1;
    const checked = Array.from(beats, beat => {
      if (!exactFields(beat, ["first", "last", "phase", "category", "emphasis", "evidence"]) ||
          !between(beat.first, lastBeat + 1, last) || !between(beat.last, beat.first, last) ||
          !BEAT_PHASES.includes(beat.phase) || !BEAT_CATEGORIES.includes(beat.category) ||
          !Array.isArray(beat.evidence) || !between(beat.evidence.length, 1, 4)) throw invalidMap();
      const boundary = beat.phase === "boundary";
      if (boundary ? beat.category !== "neutral" || beat.emphasis !== 0 || beat.first !== beat.last :
        frame !== "current" || beat.category === "neutral" || !between(beat.emphasis, 1, 3)) throw invalidMap();
      let priorEvidence = first - 1;
      for (const id of beat.evidence) {
        if (!between(id, priorEvidence + 1, last)) throw invalidMap();
        priorEvidence = id;
      }
      if (!beat.evidence.some(id => between(id, beat.first, beat.last))) throw invalidMap();
      lastBeat = beat.last;
      return {...beat, evidence: [...beat.evidence]};
    });
    return {first, last, frame, beats: checked};
  })};
}

// Shadow output only. The relative emphasis is descriptive and the result
// contains neither source text nor any setting, ceiling or device command.
export function compileSceneMap(map, units, {quietParagraphs = []} = {}) {
  if (!Array.isArray(quietParagraphs) && !(quietParagraphs instanceof Set)) throw invalidUnits();
  const quiet = new Set(quietParagraphs);
  for (const paragraph of quiet) if (!between(paragraph, 0, MAX_SOURCE_PARAGRAPHS - 1)) throw invalidUnits();
  const {scenes} = validateSceneMap(map, units);
  let sceneIndex = 0, beatIndex = 0;
  return units.map(({id, paragraph, start, end, structuralBoundary}) => {
    while (sceneIndex < scenes.length && id > scenes[sceneIndex].last) {
      sceneIndex++;
      beatIndex = 0;
    }
    const nextScene = scenes[sceneIndex];
    const scene = nextScene && id >= nextScene.first ? nextScene : null;
    while (scene && beatIndex < scene.beats.length && id > scene.beats[beatIndex].last) beatIndex++;
    const nextBeat = scene?.beats[beatIndex];
    const beat = nextBeat && id >= nextBeat.first ? nextBeat : null;
    const localQuiet = quiet.has(paragraph);
    const boundary = structuralBoundary ? "structural" : beat?.phase === "boundary" ? "model" : null;
    const active = beat && !boundary && !localQuiet;
    return {id, paragraph, start, end, sceneId: scene?.first ?? null, frame: scene?.frame ?? null,
      phase: boundary ? "boundary" : active ? beat.phase : localQuiet || scene ? "quiet" : "unmapped",
      category: active ? beat.category : "neutral", emphasis: active ? beat.emphasis : 0, boundary, localQuiet};
  });
}

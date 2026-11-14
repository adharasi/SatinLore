// Exact frozen joins and independent playback expectations. No source text.
const hardProfiles = new Set(["Stop", "Reset", "Divider"]);
const hardEvents = new Set(["hard-stop", "scene-cut", "chapter-end", "memory-entry", "imagined-entry", "reported-entry",
  "present-return", "non-romantic-activity-stop", "declined-restart"]);

export function pinFrozenTarget(clip, id, work, roster) {
  const row = work?.units.find(unit => unit.id === id);
  const unit = clip.units.find(unit => unit.id === id);
  if (!work || !roster || !row || !unit || work.id !== clip.storyId || roster.id !== clip.storyId ||
      work.sourceSha256 !== clip.sourceSha256 || roster.sourceSha256 !== clip.sourceSha256 ||
      work.editionDigest !== clip.editionDigest || roster.editionDigest !== clip.editionDigest ||
      row.unitSha256 !== unit.digest || !roster.transitionTargetIds.includes(id)) {
    throw Error("Frozen target and packet source/edition/coordinate pins differ.");
  }
  return {pattern: row.pattern, phase: row.phase, transition: row.transition, cue: row.cue,
    cueScored: roster.targetIds.includes(id), transitionKnownAt: row.transitionKnownAt,
    // Frozen event and profile may disagree. Audit the first-knowable hard event
    // independently instead of silently replacing either frozen scoring lane.
    hardBoundary: hardProfiles.has(row.pattern) || hardEvents.has(row.transition) && row.transitionKnownAt === id};
}

export function assessReplayPlayback(conditions) {
  const expected = new Set([120, 240, 420].flatMap(wpm => [10, 1, 0].map(maximum => `${wpm}:${maximum}`)));
  const seen = new Set();
  let failed = false;
  for (const {wpm, maximum, after} of conditions) {
    const key = `${wpm}:${maximum}`;
    if (!expected.has(key) || seen.has(key) || !after ||
        !Array.isArray(after.compiledHardViolations) || !Array.isArray(after.frozenHardViolations) ||
        !Number.isSafeInteger(after.frozenHardTargets) || after.frozenHardTargets < 0 ||
        ![after.commandViolations, after.pauseViolation, after.capViolationMs,
          after.frozenHardTargetViolations, after.frozenHardOutputViolations].every(value => Number.isFinite(value) && value >= 0)) {
      return "incomplete";
    }
    seen.add(key);
    failed ||= after.compiledHardViolations.length > 0 || after.frozenHardViolations.length > 0 ||
      after.commandViolations > 0 || after.pauseViolation > 0 || after.capViolationMs > 0 ||
      after.frozenHardTargetViolations > 0 || after.frozenHardOutputViolations > 0;
  }
  return seen.size !== expected.size ? "incomplete" : failed ? "fail" : "pass";
}

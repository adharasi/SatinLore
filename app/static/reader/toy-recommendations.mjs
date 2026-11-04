import {channelLabel, TOY_PROFILES} from "../devices/toy-profiles.mjs";

const motionLabel = id => id === "fingering" ? "flexing (fingering)" : channelLabel(id).toLowerCase();
const joinMotions = new Intl.ListFormat("en", {style: "long", type: "conjunction"});

export function storyToyRecommendation(paragraphs) {
  const remaining = new Set();
  let hasActiveScene = false;
  for (const paragraph of paragraphs) {
    if (!paragraph.analysed || paragraph.quiet || paragraph.suggestedLevel <= 0) continue;
    hasActiveScene = true;
    for (const movement of paragraph.movements ?? []) remaining.add(movement);
  }
  if (!remaining.size) return hasActiveScene
    ? "Lush or another compatible vibration model can follow the intensity changes. No specific movement was detected."
    : "No model-specific movement was detected.";
  if (remaining.size === 1 && remaining.has("vibrate")) return "Lush or another compatible vibration model matches the detected vibration.";

  // Cover each detected movement with a documented match, preferring models
  // that cover several. Report-only capabilities depend on the paired unit.
  const matches = [];
  while (remaining.size) {
    let best = null;
    for (const profile of TOY_PROFILES) {
      const standard = profile.physicalChannels.filter(channel => remaining.has(channel));
      const extended = profile.socketChannels.filter(channel => remaining.has(channel));
      const motions = [...standard, ...extended];
      if (!motions.length || best && (motions.length < best.motions.length ||
        motions.length === best.motions.length && extended.length >= best.extended)) continue;
      best = {profile, motions, extended: extended.length};
    }
    if (!best) break;
    const suffix = best.extended ? " (extended Lovense connection needed)" : "";
    matches.push(`${best.profile.pickerLabel} — ${joinMotions.format(best.motions.map(motionLabel))}${suffix}.`);
    for (const motion of best.motions) remaining.delete(motion);
  }
  return matches.join(" ") || "No model-specific movement was detected.";
}

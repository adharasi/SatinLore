export const DEFAULT_EXPERIENCE = Object.freeze({
  quiet: "off", edging: false, maximum: 10, rhythm: "scene", peakPattern: "auto",
});

const quietModes = new Set(["off", "continuous", "edging"]);
const rhythms = new Set(["scene", "steady", "gentle", "dynamic"]);
const peakPatterns = new Set(["auto", "crest", "accents", "ease"]);
const edgePatterns = new Set(["auto", "ease", "off"]);

export function validateExperience(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => key !== "edgePattern" && !Object.hasOwn(DEFAULT_EXPERIENCE, key)) ||
      !Object.keys(DEFAULT_EXPERIENCE).every(key => Object.hasOwn(value, key)) ||
      !quietModes.has(value.quiet) || typeof value.edging !== "boolean" ||
      !Number.isInteger(value.maximum) || value.maximum < 1 || value.maximum > 20 ||
      !rhythms.has(value.rhythm) || !peakPatterns.has(value.peakPattern) ||
      (Object.hasOwn(value, "edgePattern") && !edgePatterns.has(value.edgePattern))) {
    throw new TypeError("Choose valid device preferences and a maximum from 1 to 20.");
  }
  const {quiet, edging, maximum, rhythm, peakPattern, edgePattern = "auto"} = value;
  return {quiet, edging, maximum, rhythm, peakPattern, ...(edgePattern === "auto" ? {} : {edgePattern})};
}

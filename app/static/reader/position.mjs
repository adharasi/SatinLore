// Geometry only: the UI supplies visible paragraph rectangles and handles settling.
export const MAX_ANCHOR_GAP = 240;

export function selectReadingParagraph(rects, anchorY, currentId, hysteresisPx = 24) {
  if (!Array.isArray(rects) || !Number.isFinite(anchorY) ||
      !Number.isFinite(hysteresisPx) || hysteresisPx < 0) return null;
  const candidates = rects.filter(rect => rect && typeof rect.id === "string" && rect.id &&
    Number.isFinite(rect.top) && Number.isFinite(rect.bottom) && rect.bottom > rect.top);
  const current = candidates.find(rect => rect.id === currentId);
  if (current && anchorY >= current.top - hysteresisPx && anchorY <= current.bottom + hysteresisPx) {
    return current.id;
  }
  let best = null;
  let bestDistance = Infinity;
  for (const rect of candidates) {
    const distance = Math.max(rect.top - anchorY, anchorY - rect.bottom, 0);
    if (distance < bestDistance) {
      best = rect.id;
      bestDistance = distance;
    }
  }
  return bestDistance <= MAX_ANCHOR_GAP ? best : null;
}

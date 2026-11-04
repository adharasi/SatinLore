// Library discovery uses titles and local metadata only; it never searches future story text.
export const LIBRARY_SORTS = Object.freeze(["updated", "title", "progress", "favorites"]);
const title = story => typeof story?.title === "string" ? story.title : "Untitled story";
const wordTotals = new WeakMap();
function paragraphCount(story) {
  return Math.max(0, Number(story?.model?.paragraphs?.length ?? story?.paragraphCount ?? 0) || 0);
}
function position(story, count = paragraphCount(story)) {
  return count ? Math.max(0, Math.min(count - 1, Number.isInteger(story?.position) ? story.position : 0)) : 0;
}
function progress(story) {
  const count = paragraphCount(story);
  return count ? (position(story, count) + 1) / count : 0;
}
function recent(story) {
  for (const value of [story?.lastOpenedAt, story?.updatedAt, story?.createdAt]) {
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}
function compareTitles(a, b) {
  return title(a).localeCompare(title(b), "en", {numeric: true, sensitivity: "base"});
}
export function selectLibraryStories(stories, {query = "", sort = "updated"} = {}) {
  const needle = typeof query === "string" ? query.trim().slice(0, 120).normalize("NFKC").toLocaleLowerCase("en") : "";
  const selected = Array.from(stories ?? []).filter(story => !needle || title(story).normalize("NFKC").toLocaleLowerCase("en").includes(needle));
  const kind = LIBRARY_SORTS.includes(sort) ? sort : "updated";
  // Stable original order breaks ties; do not change the caller's library or selection.
  return selected.sort((a, b) => {
    if (kind === "title") return compareTitles(a, b);
    if (kind === "favorites" && Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
    return (kind === "progress" ? progress(b) - progress(a) : recent(b) - recent(a)) || compareTitles(a, b);
  });
}
export function storyMetadata(story) {
  const paragraphs = paragraphCount(story);
  const sections = story?.model?.paragraphs;
  let words = Array.isArray(sections) ? wordTotals.get(sections) : 0;
  if (words === undefined) {
    words = sections.reduce((total, paragraph) => {
      const value = typeof paragraph?.text === "string" ? paragraph.text.trim() : "";
      return total + (value ? value.split(/\s+/u).length : 0);
    }, 0);
    // Loaded text is immutable. Keep only a count, and avoid rescanning a long story on every transport update.
    wordTotals.set(sections, words);
  }
  return {paragraphs, words, progressPercent: Math.floor(progress(story) * 100),
    positionLabel: paragraphs ? `Section ${position(story, paragraphs) + 1} of ${paragraphs}` : "No sections"};
}
export function renderStoryTabs(container, stories, {activeId = null, onSelect = () => {}, disabled = false} = {}) {
  if (!container) return;
  const document = container.ownerDocument;
  let selected = selectLibraryStories(stories).slice(0, 5);
  const active = stories.find(story => story.id === activeId);
  if (active && !selected.includes(active)) selected = [active, ...selected.slice(0, 4)];
  // Recency chooses membership, while the library's insertion order keeps visible tabs predictable.
  const included = new Set(selected);
  selected = stories.filter(story => included.has(story));
  const fragment = document.createDocumentFragment();
  selected.forEach(story => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "story-tab";
    button.dataset.storyId = story.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(story.id === activeId));
    button.setAttribute("aria-controls", "reading-workspace");
    button.tabIndex = story.id === activeId || (!active && story === selected[0]) ? 0 : -1;
    button.disabled = disabled || Boolean(story.deleting);
    button.textContent = title(story);
    button.addEventListener("click", () => onSelect(story.id));
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const buttons = [...container.querySelectorAll('[role="tab"]')].filter(node => !node.disabled);
      if (!buttons.length) return;
      event.preventDefault();
      const index = buttons.indexOf(button);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
        (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
      // Manual tab activation: moving focus never changes the story or interrupts reading.
    });
    fragment.append(button);
  });
  container.replaceChildren(fragment);
  container.hidden = !selected.length;
}

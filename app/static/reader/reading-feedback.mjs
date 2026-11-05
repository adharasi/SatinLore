export const READING_FEEDBACK_LABELS = Object.freeze({
  "too-strong": "Too strong",
  "too-weak": "Too weak",
  "missed-movement": "Expected movement here",
  "wrong-moment": "Wrong moment",
  "wrong-movement": "Wrong movement",
});

const MAX_MARKS = 32;
const validPosition = value => Number.isInteger(value) && value >= 0 && value < 2000;

export function normalizeReadingMark(issue, position) {
  return typeof issue === "string" && Object.hasOwn(READING_FEEDBACK_LABELS, issue) && validPosition(position) ? {issue, position} : null;
}

/** Keeps only explicit marks and visited section numbers in this tab. */
export function mountReadingFeedback({mount, shortcut, document = mount?.ownerDocument ?? globalThis.document,
  record = () => false, urls = globalThis.URL, schedule = globalThis.setTimeout} = {}) {
  if (!mount || !document) return {update() {}, sharing() {}, open() {}};
  const get = selector => mount.querySelector(selector);
  const section = get("select"), list = get("ul"), status = get('[role="status"]');
  const exportButton = get("#download-reading-feedback"), sharingNote = get("#reading-feedback-sharing");
  const sessions = new WeakMap();
  let current = null, optionsChanged = false, activeStory = null, shareRecording = false;

  const labelFor = ({issue, position}) => `Section ${position + 1} · ${READING_FEEDBACK_LABELS[issue]}`;
  function renderMarks() {
    list.replaceChildren(...current.marks.map(mark => {
      const item = document.createElement("li");
      item.textContent = labelFor(mark);
      return item;
    }));
    exportButton.hidden = !current.marks.length;
  }
  function mark(issue) {
    if (mount.hidden || !current || !mount.open || section.value === "") return;
    const item = normalizeReadingMark(issue, Number(section.value));
    if (!item || !current.played.has(item.position)) return;
    if (current.marks.some(mark => mark.position === item.position && mark.issue === item.issue)) {
      status.textContent = `${labelFor(item)} is already marked.`;
      return;
    }
    if (current.marks.length >= MAX_MARKS) {
      status.textContent = "The feedback list is full for this visit. You can download the marks below.";
      return;
    }
    current.marks.push(item);
    const queued = shareRecording && record({type: "reading-feedback", ...item}) === true;
    status.textContent = queued ? `${labelFor(item)} marked and queued in the beta recording.` : `${labelFor(item)} marked for this visit.`;
    renderMarks();
  }
  for (const button of mount.querySelectorAll("[data-reading-issue]")) {
    button.addEventListener("click", () => mark(button.dataset.readingIssue));
  }
  exportButton.addEventListener("click", () => {
    if (mount.hidden || !mount.open || !current?.marks.length) return;
    let url;
    try {
      const data = JSON.stringify({format: "satinlore-reading-feedback-v1", marks: current.marks.map(({issue, position}) => ({issue, section: position + 1}))}, null, 2);
      url = urls.createObjectURL(new Blob([data], {type: "application/json"}));
      const link = document.createElement("a");
      link.href = url;
      link.download = "satinlore-reading-feedback.json";
      link.hidden = true;
      document.body.append(link);
      try { link.click(); } finally { link.remove(); }
      schedule(() => urls.revokeObjectURL(url), 60000);
      status.textContent = "Feedback download started. Check your downloads.";
    } catch {
      if (url) urls?.revokeObjectURL?.(url);
      status.textContent = "The feedback download could not start. Your marks are still here.";
    }
  });

  return {
    update(story, {position, running, testing = false, readingSeeking = false}) {
      if (story !== activeStory) {
        activeStory = story;
        current = story ? sessions.get(story) ?? null : null;
        optionsChanged = true;
        mount.open = false;
        status.textContent = "";
      }
      if (story && running && !readingSeeking && validPosition(position)) {
        if (!current) {
          current = {played: new Set(), last: position, marks: []};
          sessions.set(story, current);
        }
        optionsChanged = true;
        current.played.add(position);
        current.last = position;
        mount.open = false;
      }
      mount.hidden = !current || running || testing;
      if (shortcut) shortcut.hidden = !current || testing;
      if (mount.hidden || !optionsChanged) return;
      const options = [...current.played].sort((a, b) => a - b).map(value => {
        const option = document.createElement("option");
        option.value = String(value);
        option.textContent = `Section ${value + 1}`;
        return option;
      });
      section.replaceChildren(...options);
      section.value = String(current.last);
      renderMarks();
      optionsChanged = false;
    },
    open(position) {
      if (mount.hidden || !current) return false;
      section.value = String(current.played.has(position) ? position : current.last);
      mount.open = true;
      section.focus();
      return true;
    },
    sharing(recording) { shareRecording = recording === true; sharingNote.hidden = !shareRecording; },
  };
}

const categories = { bug: "Issue", reading: "Reading experience", idea: "Idea", other: "Other" };
const statuses = { new: "New", reviewing: "In review", resolved: "Closed" };
const $ = id => document.getElementById(id);
const results = $("inbox-result");
const list = $("inbox-notes");
const refresh = $("inbox-refresh");
const search = $("inbox-search");
const category = $("inbox-category");
const statusFilter = $("inbox-status");
let notes = [];
let limited = false;
let busy = false;

function report(message, error = false) {
  results.textContent = message;
  results.dataset.error = String(error);
}

async function request(update) {
  const response = await fetch("/feedback-admin/api", {
    method: update ? "PATCH" : "GET", credentials: "same-origin", cache: "no-store",
    redirect: "error", signal: AbortSignal.timeout(10000),
    ...(update ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) } : {}),
  });
  if (response.status === 401 || response.status === 403) {
    notes = [];
    list.replaceChildren();
    throw new Error("Founder access expired. Reload this page to sign in.");
  }
  if (response.status === 404 && update) throw new Error("This note is gone. Refresh the inbox.");
  if (!response.ok) throw new Error("The inbox could not confirm this action. Try again.");
  try { return await response.json(); }
  catch { throw new Error("The inbox returned an unreadable result. Try again."); }
}

function render(message) {
  const query = search.value.trim().toLocaleLowerCase();
  const visible = notes.filter(note =>
    (!category.value || category.value === note.category) &&
    (!statusFilter.value || statusFilter.value === note.status) &&
    (!query || note.message.toLocaleLowerCase().includes(query)));
  const fragment = document.createDocumentFragment();
  for (const note of visible) {
    const article = document.createElement("article");
    const heading = document.createElement("h3");
    heading.textContent = categories[note.category];
    const meta = document.createElement("p");
    meta.className = "feedback-note-meta";
    meta.textContent = [new Date(note.createdAt).toLocaleString(),
      note.rating === null ? "" : `Rating ${note.rating} / 5`,
      `Expires ${new Date(note.expiresAt).toLocaleDateString()}`].filter(Boolean).join(" · ");
    const text = document.createElement("p");
    text.textContent = note.message;
    const form = document.createElement("form");
    form.className = "inbox-note-actions";
    const label = document.createElement("label");
    const status = document.createElement("select");
    status.id = `status-${note.id}`;
    label.htmlFor = status.id;
    label.textContent = "Review status";
    for (const [value, text] of Object.entries(statuses)) status.add(new Option(text, value));
    status.value = note.status;
    label.append(status);
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save status";
    save.disabled = true;
    status.addEventListener("change", () => { save.disabled = busy || status.value === note.status; });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || status.value === note.status) return;
      busy = true;
      save.disabled = true;
      status.disabled = true;
      refresh.disabled = true;
      try {
        const saved = await request({ id: note.id, status: status.value });
        if (saved.ok !== true || saved.id !== note.id || saved.status !== status.value) throw new Error("The change could not be confirmed. Refresh the inbox.");
        note.status = saved.status;
        render("Status updated.");
        ($(status.id) || statusFilter).focus();
      } catch (error) {
        report(error instanceof TypeError ? "The inbox could not be reached. Try again." : error.message, true);
      } finally {
        busy = false;
        status.disabled = false;
        save.disabled = status.value === note.status;
        refresh.disabled = false;
      }
    });
    form.append(label, save);
    article.append(heading, meta, text, form);
    fragment.append(article);
  }
  list.replaceChildren(fragment);
  const count = visible.length ? `${visible.length} of ${notes.length} notes shown.` : "No matching notes.";
  report([message, count, limited ? "Showing the latest 200 retained notes." : ""].filter(Boolean).join(" "));
}

async function load() {
  if (busy) return;
  busy = true;
  refresh.disabled = true;
  report("Loading feedback…");
  try {
    const data = await request();
    if (!Array.isArray(data.feedback)) throw new Error("The inbox did not return feedback. Try again.");
    notes = data.feedback;
    limited = data.limited === true;
    render();
  } catch (error) {
    notes = [];
    list.replaceChildren();
    report(error instanceof TypeError ? "The inbox could not be reached. Try again." : error.message, true);
  } finally {
    busy = false;
    refresh.disabled = false;
  }
}

refresh.addEventListener("click", () => void load());
for (const filter of [search, category, statusFilter]) filter.addEventListener("input", () => { if (!busy) render(); });
void load();

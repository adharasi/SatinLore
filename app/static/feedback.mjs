import { HostedAccessGuard } from "./access.mjs";
import { createStoryId } from "./reader/identity.mjs";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CATEGORIES = ["bug", "idea", "reading", "other"];
const UNKNOWN = "We could not confirm this just now. Please try again.";
const SIGN_IN = "Please check your sign-in again. Your action has not been confirmed.";
export function feedbackDraft(value) {
  const message = typeof value.message === "string" ? value.message.normalize("NFC").trim() : "";
  if (!CATEGORIES.includes(value.category) || message.length < 5 || message.length > 2000 || new TextEncoder().encode(message).byteLength > 2048 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(message)) throw Error("Use a note of 5–2,000 characters and no more than 2 KB. Leave out story text and private details.");
  const rating = value.rating === undefined || value.rating === null ? null : value.rating;
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw Error("Choose a rating from 1 to 5, or leave it blank.");
  return { category: value.category, message, rating };
}
function records(data) {
  if (!Array.isArray(data?.feedback) || data.feedback.length > 100 || data.feedback.some(row => !row || !UUID.test(row.id) || !CATEGORIES.includes(row.category) || typeof row.message !== "string" || row.message.length > 2000 || !Number.isSafeInteger(row.createdAt) || !Number.isSafeInteger(row.expiresAt) || !(row.rating === null || Number.isInteger(row.rating) && row.rating >= 1 && row.rating <= 5))) throw Error(UNKNOWN);
  return data.feedback;
}
export class FeedbackClient {
  constructor({ fetcher = (...args) => fetch(...args), makeKey = createStoryId, authorize = async () => false } = {}) {
    this.fetcher = fetcher; this.makeKey = makeKey; this.authorize = authorize;
    this.pending = null; this.busy = false; this.controllers = new Set(); this.generation = 0;
  }
  cancel() { ++this.generation; for (const controller of this.controllers) controller.abort(); }
  async authorized(generation) {
    if (!await this.authorize() || generation !== this.generation) throw Error(SIGN_IN);
  }
  async api(path, body) {
    const generation = this.generation;
    const controller = new AbortController(); this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.fetcher(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
      if (controller.signal.aborted || generation !== this.generation) throw Error(UNKNOWN);
      if (!response.ok || response.redirected) {
        const errors = { 400: "Check your feedback fields and try again.", 401: SIGN_IN, 403: SIGN_IN, 409: "This retry belongs to a different note. Refresh your saved feedback before sending again.", 413: "Your note is too large. Use no more than 2 KB of text.", 429: "You have sent a few notes recently, or reached the saved feedback limit. Please try again later." };
        throw Error(errors[response.status] || UNKNOWN);
      }
      const data = await response.json();
      if (controller.signal.aborted || generation !== this.generation) throw Error(UNKNOWN);
      return data;
    } catch (error) {
      if (error instanceof Error && [UNKNOWN, SIGN_IN, "Check your feedback fields and try again.", "This retry belongs to a different note. Refresh your saved feedback before sending again.", "Your note is too large. Use no more than 2 KB of text.", "You have sent a few notes recently, or reached the saved feedback limit. Please try again later."].includes(error.message)) throw error;
      throw Error(UNKNOWN);
    } finally { clearTimeout(timeout); this.controllers.delete(controller); }
  }
  async list() {
    await this.authorized(this.generation);
    return records(await this.api("/api/feedback"));
  }
  async submit(value) {
    if (this.busy) throw Error("Please wait for the current action to finish.");
    const draft = feedbackDraft(value), signature = JSON.stringify(draft);
    if (!this.pending || this.pending.signature !== signature) this.pending = { signature, key: this.makeKey() };
    this.busy = true;
    try {
      await this.authorized(this.generation);
      const saved = await this.api("/api/feedback", { ...draft, idempotencyKey: this.pending.key });
      if (saved?.ok !== true || !UUID.test(saved.id) || typeof saved.duplicate !== "boolean" || !Number.isSafeInteger(saved.createdAt) || !Number.isSafeInteger(saved.expiresAt)) throw Error(UNKNOWN);
      this.pending = null;
      return saved;
    } finally { this.busy = false; }
  }
  async export() {
    await this.authorized(this.generation);
    const data = await this.api("/api/my-data");
    if (data?.scope !== "SatinLore app feedback" || !Number.isSafeInteger(data.exportedAt)) throw Error(UNKNOWN);
    records(data); return data;
  }
  async erase({ confirm = false } = {}) {
    if (confirm !== true) throw Error("Confirm that you want to delete your saved feedback.");
    if (this.busy) throw Error("Please wait for the current action to finish.");
    this.busy = true;
    try {
      await this.authorized(this.generation);
      const data = await this.api("/api/my-data/delete", { confirm: true });
      if (data?.ok !== true || data.deleted !== true) throw Error(UNKNOWN);
      return data;
    } finally { this.busy = false; }
  }
}

export function initializeFeedbackPage() {
  const $ = id => document.getElementById(id);
  if (!$("feedback-form")) return;
  let allowed = false, serviceReady = false, busy = false, listEpoch = 0, deletedOpener = null;
  const status = (id, message, error = false) => { $(id).textContent = message; $(id).dataset.error = String(error); };
  const update = () => {
    for (const id of ["feedback-category", "feedback-rating", "feedback-message"]) $(id).disabled = busy;
    for (const id of ["feedback-send", "feedback-download", "feedback-delete-open"]) $(id).disabled = !allowed || !serviceReady || busy;
    $("feedback-refresh").disabled = !allowed || busy;
    $("feedback-delete").disabled = !allowed || !serviceReady || busy || !$("feedback-delete-confirm").checked;
    $("feedback-send").textContent = busy ? "Please wait…" : "Send feedback →";
    $("feedback-form").setAttribute("aria-busy", String(busy));
  };
  const client = new FeedbackClient({ authorize: async () => guard.check({ fresh: true }) });
  const guard = new HostedAccessGuard({
    onChange: state => { allowed = state.allowed; if (allowed) $("feedback-access").hidden = true; update(); },
    onLost: () => {
      allowed = false; client.cancel(); ++listEpoch;
      $("feedback-list").replaceChildren();
      status("feedback-history-status", "Check your sign-in to view saved feedback.");
      $("feedback-access").hidden = false; $("feedback-access").replaceChildren(document.createTextNode("Please check your sign-in to use feedback tools. "));
      const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Check sign-in again";
      retry.addEventListener("click", () => void reload());
      const login = document.createElement("a"); login.href = "/support"; login.textContent = "Reload to sign in";
      $("feedback-access").append(retry, login); update();
    },
  });
  function showNotes(notes) {
    const labels = { bug: "Something did not work", idea: "An idea", reading: "The reading experience", other: "Something else" };
    const fragment = document.createDocumentFragment();
    for (const note of notes) {
      const article = document.createElement("article"), heading = document.createElement("h3"), meta = document.createElement("p"), message = document.createElement("p");
      heading.textContent = labels[note.category]; meta.className = "feedback-note-meta";
      meta.textContent = new Date(note.createdAt).toLocaleString() + (note.rating === null ? "" : ` · Rating ${note.rating} / 5`) + ` · Kept until ${new Date(note.expiresAt).toLocaleDateString()}`;
      message.textContent = note.message; article.append(heading, meta, message); fragment.append(article);
    }
    $("feedback-list").replaceChildren(fragment);
    status("feedback-history-status", notes.length ? `${notes.length} saved ${notes.length === 1 ? "note" : "notes"}.` : "No saved feedback yet.");
  }
  async function reload() {
    const epoch = ++listEpoch;
    status("feedback-history-status", "Checking your saved feedback…");
    try {
      const notes = await client.list();
      if (epoch !== listEpoch || !allowed) return;
      serviceReady = true; showNotes(notes);
    } catch (error) {
      if (epoch !== listEpoch) return;
      serviceReady = false;
      status("feedback-history-status", error.message + " Feedback tools need the private hosted app.", true);
    } finally { update(); }
  }
  $("feedback-form").addEventListener("submit", async event => {
    event.preventDefault(); if (busy || !allowed || !serviceReady) return;
    const rating = $("feedback-rating").value;
    busy = true; update(); status("feedback-send-status", "Sending your note…");
    try {
      await client.submit({ category: $("feedback-category").value, rating: rating ? Number(rating) : null, message: $("feedback-message").value });
      $("feedback-form").reset(); status("feedback-send-status", "Your feedback is saved. Thank you for helping shape SatinLore.");
      await reload();
    } catch (error) { status("feedback-send-status", error.message + " Your draft is still here. Retry the same note to check it safely.", true); }
    finally { busy = false; update(); }
  });
  $("feedback-refresh").addEventListener("click", () => void reload());
  $("feedback-download").addEventListener("click", async () => {
    if (busy) return; busy = true; update(); status("feedback-data-status", "Preparing your feedback download…");
    try {
      const data = await client.export(), blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = "satinlore-feedback.json"; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status("feedback-data-status", "Your feedback download has started.");
    } catch (error) { status("feedback-data-status", error.message, true); }
    finally { busy = false; update(); }
  });
  $("feedback-delete-open").addEventListener("click", () => { deletedOpener = document.activeElement; $("feedback-delete-confirm").checked = false; update(); $("feedback-delete-dialog").showModal(); });
  const closeDelete = () => { client.cancel(); $("feedback-delete-confirm").checked = false; $("feedback-delete-dialog").close(); deletedOpener?.focus(); };
  $("feedback-delete-dialog").addEventListener("cancel", () => { $("feedback-delete-confirm").checked = false; client.cancel(); update(); });
  $("feedback-delete-cancel").addEventListener("click", closeDelete);
  $("feedback-delete-confirm").addEventListener("change", update);
  $("feedback-delete").addEventListener("click", async () => {
    if (busy || !$("feedback-delete-confirm").checked) return;
    busy = true; update(); status("feedback-data-status", "Deleting your saved feedback…");
    try {
      await client.erase({ confirm: $("feedback-delete-confirm").checked });
      ++listEpoch; showNotes([]); closeDelete(); status("feedback-data-status", "Your feedback has been deleted from this app's active records.");
    } catch (error) { status("feedback-data-status", error.message + " Deletion has not been confirmed.", true); }
    finally { busy = false; update(); }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { guard.suspend(); client.cancel(); ++listEpoch; }
    else void guard.resume().then(ok => { if (ok) void reload(); });
  });
  window.addEventListener("pagehide", () => { guard.suspend(); client.cancel(); ++listEpoch; });
  window.addEventListener("pageshow", event => { if (event.persisted && !document.hidden) void guard.resume().then(ok => { if (ok) void reload(); }); });
  update();
  void guard.start({ visible: !document.hidden }).then(ok => { if (ok) void reload(); });
  return { guard, client };
}
if (typeof document !== "undefined") initializeFeedbackPage();

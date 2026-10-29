/* Blocking, local-only bootstrap: resolve appearance before the stylesheet paints. */
(() => {
  "use strict";
  const KEY = "satinlore.appearance";
  const SELECTS = ["appearance", "reading-appearance"];
  const allowed = new Set(["system", "light", "dark"]);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  let preference = "system";
  let storageAvailable = true;
  try {
    const saved = window.localStorage.getItem(KEY);
    if (allowed.has(saved)) preference = saved;
  } catch { storageAvailable = false; }

  function apply(notify = false) {
    const theme = preference === "system" ? (media.matches ? "dark" : "light") : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.appearance = preference;
    document.documentElement.style.colorScheme = theme;
    for (const id of SELECTS) {
      const select = document.getElementById(id);
      if (select) select.value = preference;
    }
    const note = document.getElementById("appearance-note");
    if (note) note.textContent = storageAvailable ? "Appearance is saved separately from stories you choose to save." :
      "Appearance works for this visit. Browser storage is unavailable.";
    if (notify) window.dispatchEvent(new CustomEvent("satinlore:appearance", {detail: {preference, theme}}));
  }

  function setPreference(value) {
    if (!allowed.has(value)) return false;
    preference = value;
    try { window.localStorage.setItem(KEY, value); storageAvailable = true; }
    catch { storageAvailable = false; }
    apply(true);
    return true;
  }

  apply();
  media.addEventListener("change", () => { if (preference === "system") apply(true); });
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    for (const id of SELECTS) {
      document.getElementById(id)?.addEventListener("change", event => setPreference(event.target.value));
    }
  }, {once: true});
})();

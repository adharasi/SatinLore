/* Blocking, local-only bootstrap: resolve appearance before the stylesheet paints. */
(() => {
  "use strict";
  const KEY = "satinlore.appearance";
  const SELECTS = ["appearance", "reading-appearance"];
  const allowed = new Set(["system", "light", "dark"]);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const defaultPreference = document.documentElement.dataset.appearanceDefault === "dark" ? "dark" : "system";
  let browserPreference = defaultPreference;
  let accountPreference = null;
  let storageAvailable = true;
  try {
    const saved = window.localStorage.getItem(KEY);
    if (allowed.has(saved)) browserPreference = saved;
  } catch { storageAvailable = false; }

  const currentPreference = () => accountPreference ?? browserPreference;

  function apply(notify = false, user = false) {
    const preference = currentPreference();
    const theme = preference === "system" ? (media.matches ? "dark" : "light") : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.appearance = preference;
    document.documentElement.style.colorScheme = theme;
    for (const id of SELECTS) {
      const select = document.getElementById(id);
      if (select) select.value = preference;
    }
    const toggle = document.getElementById("toggle-dark-mode");
    if (toggle) {
      toggle.setAttribute("aria-checked", String(theme === "dark"));
      toggle.title = theme === "dark" ? "Use Satin Editorial light mode" : "Use Midnight Ink dark mode";
    }
    const note = document.getElementById("appearance-note");
    if (note) note.textContent = accountPreference !== null ? "Your account can keep your appearance across devices." : storageAvailable ? "Appearance is saved on this browser." :
      "Appearance works for this visit. Browser storage is unavailable.";
    if (notify) window.dispatchEvent(new CustomEvent("satinlore:appearance", {detail: {preference, theme, user}}));
  }

  function setPreference(value) {
    if (!allowed.has(value)) return false;
    if (accountPreference !== null) accountPreference = value;
    else {
      browserPreference = value;
      try { window.localStorage.setItem(KEY, value); storageAvailable = true; }
      catch { storageAvailable = false; }
    }
    apply(true, true);
    return true;
  }

  apply();
  window.addEventListener?.("satinlore:account-appearance", event => {
    const {active, preference} = event.detail || {};
    accountPreference = active === true ? (allowed.has(preference) ? preference : browserPreference) : null;
    apply(true);
  });
  window.addEventListener?.("storage", event => {
    if (event.key !== KEY && event.key !== null) return;
    browserPreference = allowed.has(event.newValue) ? event.newValue : defaultPreference;
    if (accountPreference === null) apply(true);
  });
  media.addEventListener("change", () => { if (currentPreference() === "system") apply(true); });
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document.getElementById("toggle-dark-mode")?.addEventListener("click", () => {
      const preference = currentPreference();
      const dark = preference === "dark" || (preference === "system" && media.matches);
      setPreference(dark ? "light" : "dark");
    });
    for (const id of SELECTS) {
      document.getElementById(id)?.addEventListener("change", event => setPreference(event.target.value));
    }
  }, {once: true});
})();

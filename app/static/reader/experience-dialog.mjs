import {DEFAULT_EXPERIENCE} from "./experience-preferences.mjs";

export function mountExperienceDialog({document, openDialog, closeDialog, save, finish}) {
  const node = id => document.getElementById(`experience-${id}`);
  const dialog = node("dialog");
  const form = node("form");
  const fields = [node("quiet"), node("edging"), node("maximum"), node("rhythm")];
  let visit = null;

  function close({proceed = false, saved = false, restore = true} = {}) {
    if (!visit) return;
    const {initial, continuation, preview} = visit;
    visit = null;
    closeDialog({restore});
    if (proceed && !preview) finish({initial, saved, continuation});
  }

  function setBusy(busy) {
    for (const field of [...fields, node("save"), node("reset"), node("later"), node("close")]) field.disabled = busy;
    form.setAttribute("aria-busy", String(busy));
  }

  function updateHelp() {
    for (const [id, choice] of [["quiet", "edging"], ["edging", "yes"]]) {
      const field = node(id);
      const help = node(`${id}-help`);
      help.hidden = field.value !== choice;
      if (help.hidden) field.removeAttribute("aria-describedby");
      else field.setAttribute("aria-describedby", help.id);
    }
  }

  function fill(values) {
    const [quiet, edging, maximum, rhythm] = fields;
    quiet.value = values.quiet;
    edging.value = values.edging ? "yes" : "no";
    maximum.value = String(values.maximum);
    rhythm.value = values.rhythm;
    node("maximum-value").textContent = maximum.value;
    updateHelp();
  }

  function open({values, account = false, initial = false, preview = false, continuation = null, opener, canStop = false}) {
    if (visit) return false;
    visit = {initial, preview, continuation, reset: false};
    const onboarding = initial || preview;
    fill(values);
    node("heading").textContent = onboarding ? "How should your toy feel?" : "Device preferences";
    node("intro").textContent = preview ? "Try the same questions a new reader sees." :
      account ? "These choices are saved to your account. Change them anytime in Settings." :
      "These choices apply for this visit.";
    node("preview-note").hidden = !preview;
    node("questions").hidden = false;
    node("next").hidden = !onboarding || Boolean(continuation);
    node("save").hidden = false;
    node("save").textContent = onboarding ? "Save and continue" : "Save preferences";
    node("later").textContent = onboarding ? "Not now" : "Cancel";
    node("reset").hidden = onboarding;
    node("stop").hidden = !canStop;
    node("status").textContent = "";
    setBusy(false);
    openDialog(opener);
    node("quiet").focus({preventScroll: true});
    return true;
  }

  for (const id of ["quiet", "edging"]) node(id).addEventListener("change", updateHelp);
  node("maximum").addEventListener("input", () => { node("maximum-value").textContent = node("maximum").value; });
  node("reset").addEventListener("click", () => {
    if (!visit || node("save").disabled) return;
    visit.reset = true;
    fill(DEFAULT_EXPERIENCE);
    node("status").textContent = "Save preferences to apply the defaults.";
  });
  node("later").addEventListener("click", () => close({proceed: true}));
  node("close").addEventListener("click", () => close({proceed: true}));
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    if (!node("save").disabled) close({proceed: true});
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const active = visit;
    if (!active || node("save").disabled || node("save").hidden) return;
    if (active.preview) {
      node("heading").textContent = "Onboarding preview complete";
      node("intro").textContent = "In first-time setup, the next step offers a real toy connection or a simulator for a quick test.";
      node("questions").hidden = true;
      node("save").hidden = true;
      node("later").textContent = "Back to Settings";
      node("later").focus({preventScroll: true});
      return;
    }
    const [quiet, edging, maximum, rhythm] = fields.map(field => field.value);
    setBusy(true);
    node("status").textContent = "Saving your preferences…";
    try {
      if (await save({quiet, edging: edging === "yes", maximum: Number(maximum), rhythm,
        ...(active.reset ? {edgePattern: "auto", peakPattern: DEFAULT_EXPERIENCE.peakPattern} : {})})) {
        if (visit === active) close({proceed: true, saved: true});
        return;
      }
      if (visit === active) node("status").textContent = "Your preferences were not saved. Try again.";
    } catch (error) {
      if (visit === active) node("status").textContent = error?.message || "Your preferences were not saved. Try again.";
    } finally {
      if (visit === active) setBusy(false);
    }
  });
  return {open, close};
}

const ALPHA_ORIGIN = "https://app.satinlore.com";
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DURATION_MS = 60_000;
const AUTO_STOP_MS = 59_000;
const VERIFY_INTERVAL_MS = 250;
const FINALIZE_TIMEOUT_MS = 5_000;
const UPLOAD_TIMEOUT_MS = 30_000;
const MIME_TYPES = ["video/webm;codecs=vp8", "video/webm"];

const stopTracks = stream => {
  for (const track of stream?.getTracks() || []) track.stop();
};

export function createAlphaCapture({ onChange = () => {}, upload, platform = globalThis } = {}) {
  const { document, location, navigator, MediaRecorder, MediaStreamTrack, URL, Blob, AbortController } = platform;
  const media = navigator?.mediaDevices;
  const mimeType = MIME_TYPES.find(type => MediaRecorder?.isTypeSupported?.(type));
  const onAlphaPage = () => location?.origin === ALPHA_ORIGIN && /^\/alpha\/?$/.test(location.pathname);
  const supported = Boolean(platform.isSecureContext && onAlphaPage() && platform.top === platform &&
    media?.getDisplayMedia && media.setCaptureHandleConfig && MediaStreamTrack?.prototype?.getCaptureHandle &&
    mimeType && platform.crypto?.randomUUID && URL?.createObjectURL && Blob && AbortController);

  let phase = "idle";
  let message = "";
  let operation = null;
  let clip = null;
  let previewUrl = null;
  let uploading = null;
  let destroyed = false;

  const now = () => platform.performance.now();
  const snapshot = () => ({ phase, supported, message, previewUrl, durationMs: clip?.durationMs ?? 0, bytes: clip?.blob.size ?? 0 });
  const update = (next, note = "") => {
    phase = next;
    message = note;
    onChange(snapshot());
  };

  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    clip = null;
  }

  function clearHandle() {
    try { media?.setCaptureHandleConfig?.({ handle: "", exposeOrigin: false, permittedOrigins: [] }); }
    catch { /* A page losing its context may no longer be able to clear the handle. */ }
  }

  function release(entry) {
    platform.clearInterval(entry.verifyTimer);
    platform.clearTimeout(entry.autoStopTimer);
    platform.clearTimeout(entry.finalizeTimer);
    stopTracks(entry.stream);
    clearHandle();
    entry.chunks.length = 0;
  }

  function cancel(note = "", next = "idle") {
    const entry = operation;
    operation = null;
    if (entry) {
      if (entry.recorder?.state === "recording") {
        try { entry.recorder.stop(); }
        catch { /* Release the stream even when the recorder has already stopped. */ }
      }
      release(entry);
    }
    if (uploading) {
      platform.clearTimeout(uploading.timer);
      uploading.controller.abort();
      uploading = null;
    }
    clearPreview();
    update(next, note);
  }

  function isCurrentPage(entry) {
    return onAlphaPage() && !document.hidden && location.href === entry.page;
  }

  function isOwnTab(entry) {
    if (!isCurrentPage(entry) || entry.track?.readyState !== "live") return false;
    try {
      const handle = entry.track.getCaptureHandle();
      return entry.track.getSettings().displaySurface === "browser" &&
        handle?.origin === ALPHA_ORIGIN && handle.handle === entry.handle;
    } catch { return false; }
  }

  function verify(entry) {
    if (operation !== entry || phase !== "recording") return;
    if (!isOwnTab(entry)) cancel("The shared tab changed. The clip was discarded.", "error");
  }

  function stop() {
    if (phase === "selecting") {
      cancel("Tab recording cancelled.");
      return false;
    }
    const entry = operation;
    if (phase !== "recording" || !entry) return false;
    if (!isOwnTab(entry)) {
      cancel("The shared tab changed. The clip was discarded.", "error");
      return false;
    }
    entry.durationMs = Math.max(1, Math.ceil(now() - entry.startedAt));
    if (entry.durationMs > MAX_DURATION_MS) {
      cancel("The clip exceeded its time limit and was discarded.", "error");
      return false;
    }
    // Stop acquiring frames before the caller moves on to feedback or pairing.
    platform.clearInterval(entry.verifyTimer);
    platform.clearTimeout(entry.autoStopTimer);
    try {
      phase = "finalizing";
      entry.recorder.stop();
      stopTracks(entry.stream);
      clearHandle();
      entry.finalizeTimer = platform.setTimeout(() => {
        if (operation === entry) cancel("The browser could not finish the clip.", "error");
      }, FINALIZE_TIMEOUT_MS);
      update("finalizing", "Preparing your local preview…");
      return true;
    } catch {
      cancel("The browser could not finish the clip.", "error");
      return false;
    }
  }

  function acceptData(entry, event) {
    if (operation !== entry || !event.data?.size) return;
    verify(entry);
    if (operation !== entry) return;
    entry.bytes += event.data.size;
    if (entry.bytes > MAX_BYTES) {
      cancel("The clip exceeded 8 MB and was discarded. You can try a shorter clip.", "error");
      return;
    }
    entry.chunks.push(event.data);
  }

  function finalize(entry) {
    if (operation !== entry) return;
    if (phase !== "finalizing" || !isCurrentPage(entry) || !entry.bytes) {
      cancel("No preview is available. Start a new clip when ready.", "error");
      return;
    }
    try {
      clip = { blob: new Blob(entry.chunks, { type: "video/webm" }), durationMs: entry.durationMs, page: entry.page };
      previewUrl = URL.createObjectURL(clip.blob);
      operation = null;
      release(entry);
      update("preview", "Preview your clip. It stays on this device until you choose Share clip.");
    } catch { cancel("The browser could not open the clip preview.", "error"); }
  }

  async function start({ consented = false } = {}) {
    if (destroyed || !supported || !consented || document.hidden || !onAlphaPage() || !["idle", "error"].includes(phase)) return false;
    const entry = { handle: platform.crypto.randomUUID(), page: location.href, chunks: [], bytes: 0 };
    operation = entry;
    update("selecting", "Choose this SatinLore Alpha tab in the browser picker.");
    if (operation !== entry) return false;
    try {
      media.setCaptureHandleConfig({ handle: entry.handle, exposeOrigin: true, permittedOrigins: [ALPHA_ORIGIN] });
      const stream = await media.getDisplayMedia({
        video: { displaySurface: "browser", width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 15 } },
        audio: false, preferCurrentTab: true, monitorTypeSurfaces: "exclude", surfaceSwitching: "exclude",
      });
      if (operation !== entry) { stopTracks(stream); return false; }
      entry.stream = stream;
      const tracks = stream.getTracks();
      [entry.track] = tracks;
      if (tracks.length !== 1 || entry.track?.kind !== "video" || !isOwnTab(entry)) {
        cancel("Choose this exact Alpha tab to record. No clip was saved.", "error");
        return false;
      }

      entry.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 800_000 });
      entry.recorder.addEventListener("dataavailable", event => acceptData(entry, event));
      entry.recorder.addEventListener("stop", () => finalize(entry));
      entry.recorder.addEventListener("error", () => {
        if (operation === entry) cancel("Tab recording was interrupted. The clip was discarded.", "error");
      });
      entry.track.addEventListener("capturehandlechange", () => verify(entry));
      entry.track.addEventListener("ended", () => {
        if (operation === entry && phase === "recording") cancel("Browser sharing ended. Use Stop video next time to keep a preview.", "error");
      });
      entry.startedAt = now();
      entry.recorder.start(VERIFY_INTERVAL_MS);
      entry.verifyTimer = platform.setInterval(() => verify(entry), VERIFY_INTERVAL_MS);
      entry.autoStopTimer = platform.setTimeout(() => { if (operation === entry) stop(); }, AUTO_STOP_MS);
      update("recording", "Recording this tab. Choose Stop video to preview the clip.");
      return true;
    } catch {
      if (operation === entry) cancel("Tab recording did not start. You can continue with the session timeline.", "error");
      return false;
    }
  }

  async function share() {
    if (destroyed || phase !== "preview" || !clip || !upload || !onAlphaPage() || document.hidden || location.href !== clip.page) return false;
    const controller = new AbortController();
    const pending = { controller, timer: platform.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS) };
    uploading = pending;
    update("sharing", "Sharing your selected clip…");
    try {
      await upload({ blob: clip.blob, durationMs: clip.durationMs, signal: controller.signal });
      if (uploading !== pending) return false;
      if (controller.signal.aborted) throw new Error("Upload timed out.");
      clearPreview();
      update("shared", "Clip shared. You can remove it by withdrawing the session.");
      return true;
    } catch {
      if (uploading === pending) update("preview", "Sharing wasn’t confirmed. Your preview is still here if you want to retry.");
      return false;
    } finally {
      platform.clearTimeout(pending.timer);
      if (uploading === pending) uploading = null;
    }
  }

  const onVisibility = () => {
    if (document.hidden && operation) cancel("Tab recording ended when the page became hidden. The clip was discarded.", "error");
  };
  const onPageExit = () => { if (operation || clip || uploading) cancel(); };
  document?.addEventListener("visibilitychange", onVisibility);
  for (const name of ["pagehide", "popstate", "hashchange"]) platform.addEventListener?.(name, onPageExit);

  function destroy() {
    destroyed = true;
    onPageExit();
    document?.removeEventListener("visibilitychange", onVisibility);
    for (const name of ["pagehide", "popstate", "hashchange"]) platform.removeEventListener?.(name, onPageExit);
  }

  return { snapshot, start, stop, share, discard: () => cancel("Local clip discarded."), destroy };
}

export function mountAlphaCapture(panel, { upload, onChange = () => {} } = {}) {
  if (!panel) throw new Error("Alpha capture requires its own study panel.");
  const make = (tag, text = "") => {
    const node = panel.ownerDocument.createElement(tag);
    node.textContent = text;
    return node;
  };
  const title = make("h3", "Optional tab video");
  const description = make("p", "Capture up to 60 seconds of this controls tab, with audio off. Review the clip before choosing to share it.");
  const consent = make("input");
  consent.type = "checkbox";
  const label = make("label");
  label.append(consent, make("span", "I agree to record this tab for SatinLore research."));
  const startButton = make("button", "Start tab recording");
  const stopButton = make("button", "Stop video");
  const shareButton = make("button", "Share clip");
  const discardButton = make("button", "Discard clip");
  for (const button of [startButton, stopButton, shareButton, discardButton]) button.type = "button";
  const preview = make("video");
  preview.controls = true;
  preview.playsInline = true;
  preview.preload = "metadata";
  preview.setAttribute("aria-label", "Local tab clip preview");
  const status = make("p");
  status.setAttribute("role", "status");
  const buttons = make("div");
  buttons.className = "alpha-capture-actions";
  buttons.append(startButton, stopButton, shareButton, discardButton);
  panel.classList.add("alpha-capture");
  panel.append(title, description, label, preview, buttons, status);

  let ready = false;
  let startEnabled = true;
  let shareEnabled = false;
  let shownUrl = null;
  const capture = createAlphaCapture({ upload, onChange: state => { render(state); onChange(state); } });

  function render(state = capture.snapshot()) {
    const canStart = ready && startEnabled && state.supported && ["idle", "error"].includes(state.phase);
    const hasPreview = Boolean(state.previewUrl);
    const sharing = state.phase === "sharing";
    panel.hidden = !ready;
    panel.dataset.capture = state.phase;
    label.hidden = !canStart;
    startButton.hidden = !canStart;
    startButton.disabled = !consent.checked;
    stopButton.hidden = !["selecting", "recording"].includes(state.phase);
    stopButton.textContent = state.phase === "selecting" ? "Cancel tab recording" : "Stop video";
    shareButton.hidden = !hasPreview;
    shareButton.disabled = !shareEnabled || sharing;
    discardButton.hidden = !hasPreview || sharing;
    preview.hidden = !hasPreview;
    if (state.previewUrl !== shownUrl) {
      shownUrl = state.previewUrl;
      if (shownUrl) preview.src = shownUrl;
      else { preview.removeAttribute("src"); preview.load(); }
    }
    status.textContent = !state.supported ? "Verified tab recording is unavailable in this browser. You can continue with the session timeline." :
      hasPreview && !shareEnabled ? "Preview your clip here. Finish the session to enable sharing." : state.message;
  }

  consent.addEventListener("change", () => render());
  startButton.addEventListener("click", () => {
    if (ready && startEnabled) void capture.start({ consented: consent.checked });
    consent.checked = false;
    render();
  });
  stopButton.addEventListener("click", capture.stop);
  shareButton.addEventListener("click", () => { if (ready && shareEnabled) void capture.share(); });
  discardButton.addEventListener("click", capture.discard);
  render();

  return {
    snapshot: capture.snapshot,
    setReady(value) {
      if (ready === Boolean(value)) return;
      ready = Boolean(value);
      if (!ready) {
        consent.checked = false;
        shareEnabled = false;
        capture.discard();
      }
      render();
    },
    setStartEnabled(value) {
      startEnabled = Boolean(value);
      if (!startEnabled && ["selecting", "recording"].includes(capture.snapshot().phase)) capture.discard();
      render();
    },
    setShareEnabled(value) { shareEnabled = Boolean(value); render(); },
    stop: capture.stop,
    discard: capture.discard,
    destroy() { capture.destroy(); panel.replaceChildren(); },
  };
}

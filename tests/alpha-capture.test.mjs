import assert from "node:assert/strict";
import test from "node:test";
import { createAlphaCapture } from "../app/static/alpha-capture.mjs";

function harness({ surface = "browser", handle, audio = false, path = "/alpha", upload, delayedPicker = false } = {}) {
  const origin = "https://app.satinlore.com";
  const timers = new Map();
  const recorders = [];
  const calls = [];
  const revoked = [];
  let config, nextTimer = 0, pickerResolve, clock = 0;
  class Track extends EventTarget {
    kind = "video";
    readyState = "live";
    getSettings() { return { displaySurface: surface }; }
    getCaptureHandle() { return handle === undefined ? { handle: config.handle, origin } : handle; }
    stop() { this.readyState = "ended"; }
  }
  const videoTrack = new Track();
  const audioTrack = { kind: "audio", stop() { this.stopped = true; } };
  const stream = { getTracks: () => audio ? [videoTrack, audioTrack] : [videoTrack] };

  class Recorder extends EventTarget {
    static isTypeSupported(type) { return type === "video/webm;codecs=vp8"; }
    state = "inactive";
    constructor(candidate, options) { super(); recorders.push({ recorder: this, candidate, options }); }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => this.dispatchEvent(new Event("stop")));
    }
    chunk(size = 200) {
      const event = new Event("dataavailable");
      event.data = new Blob([new Uint8Array(size)]);
      this.dispatchEvent(event);
    }
  }

  const document = new EventTarget();
  document.hidden = false;
  const window = new EventTarget();
  Object.assign(window, {
    top: window, document, location: new URL(origin + path),
    isSecureContext: true, MediaRecorder: Recorder, MediaStreamTrack: Track, Blob, AbortController,
    URL: { createObjectURL: () => "blob:alpha-preview", revokeObjectURL: value => revoked.push(value) },
    performance: { now: () => clock },
    crypto: { randomUUID: () => "unique-per-attempt" },
    navigator: { mediaDevices: {
      setCaptureHandleConfig(value) { config = value; },
      getDisplayMedia(options) {
        calls.push(options);
        return delayedPicker ? new Promise(resolve => { pickerResolve = resolve; }) : Promise.resolve(stream);
      },
    } },
    setInterval(fn, ms) { timers.set(++nextTimer, { fn, ms }); return nextTimer; },
    clearInterval(id) { timers.delete(id); },
    setTimeout(fn, ms) { timers.set(++nextTimer, { fn, ms }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  });
  const capture = createAlphaCapture({ platform: window, upload });
  return {
    capture, document, window, calls, recorders, revoked, videoTrack, audioTrack,
    config: () => config,
    clock: value => { clock = value; },
    resolvePicker: () => pickerResolve(stream),
    timer: ms => [...timers.values()].find(timer => timer.ms === ms)?.fn(),
  };
}

test("no browser picker before separate consent or outside the Alpha route", async () => {
  const alpha = harness();
  assert.equal(await alpha.capture.start(), false);
  assert.equal(alpha.calls.length, 0);
  const reader = harness({ path: "/" });
  assert.equal(await reader.capture.start({ consented: true }), false);
  assert.equal(reader.calls.length, 0);
});

test("screen, another browser tab and an unexpected audio track are refused before encoding", async () => {
  for (const options of [{ surface: "monitor" }, { handle: { origin: "https://app.satinlore.com", handle: "different-tab" } }, { audio: true }]) {
    const alpha = harness(options);
    assert.equal(await alpha.capture.start({ consented: true }), false);
    assert.equal(alpha.capture.snapshot().phase, "error");
    assert.equal(alpha.recorders.length, 0);
    assert.equal(alpha.videoTrack.readyState, "ended");
    if (options.audio) assert.equal(alpha.audioTrack.stopped, true);
    assert.equal(alpha.config().handle, "");
  }
});

test("a verified tab is previewed locally until the participant shares it", async () => {
  const saved = [];
  const alpha = harness({ upload: async data => { saved.push(data); } });
  assert.equal(await alpha.capture.start({ consented: true }), true);
  assert.equal(alpha.calls[0].audio, false);
  assert.deepEqual(alpha.config().permittedOrigins, ["https://app.satinlore.com"]);
  assert.equal(await alpha.capture.share(), false);
  alpha.recorders[0].recorder.chunk();
  alpha.clock(1200);
  assert.equal(alpha.capture.stop(), true);
  assert.equal(alpha.videoTrack.readyState, "ended");
  await Promise.resolve();
  assert.equal(alpha.capture.snapshot().previewUrl, "blob:alpha-preview");
  assert.equal(saved.length, 0);
  assert.equal(await alpha.capture.share(), true);
  assert.equal(saved[0].blob.type, "video/webm");
  assert.equal(saved[0].durationMs, 1200);
  assert.equal(alpha.capture.snapshot().phase, "shared");
  assert.deepEqual(alpha.revoked, ["blob:alpha-preview"]);
});

test("hide or same-document route changes discard active media", async () => {
  for (const reason of ["hide", "navigate", "handle changed"]) {
    const alpha = harness();
    await alpha.capture.start({ consented: true });
    alpha.recorders[0].recorder.chunk();
    if (reason === "hide") {
      alpha.document.hidden = true;
      alpha.document.dispatchEvent(new Event("visibilitychange"));
    } else if (reason === "navigate") {
      alpha.window.location.pathname = "/alpha/elsewhere";
      alpha.timer(250);
    } else {
      alpha.videoTrack.getCaptureHandle = () => null;
      alpha.videoTrack.dispatchEvent(new Event("capturehandlechange"));
    }
    assert.equal(alpha.videoTrack.readyState, "ended");
    assert.equal(alpha.capture.snapshot().phase, "error");
    assert.equal(alpha.capture.snapshot().previewUrl, null);
  }
});

test("a picker resolving after the session leaves cannot start recording", async () => {
  const alpha = harness({ delayedPicker: true });
  const pending = alpha.capture.start({ consented: true });
  alpha.window.dispatchEvent(new Event("pagehide"));
  alpha.resolvePicker();
  assert.equal(await pending, false);
  assert.equal(alpha.videoTrack.readyState, "ended");
  assert.equal(alpha.recorders.length, 0);
});

test("the recorder stops automatically, and oversized media is discarded", async () => {
  const bounded = harness();
  await bounded.capture.start({ consented: true });
  bounded.recorders[0].recorder.chunk();
  bounded.clock(59_000);
  bounded.timer(59_000);
  await Promise.resolve();
  assert.equal(bounded.capture.snapshot().phase, "preview");
  assert.equal(bounded.capture.snapshot().durationMs, 59_000);

  const large = harness();
  await large.capture.start({ consented: true });
  large.recorders[0].recorder.chunk(8 * 1024 * 1024 + 1);
  assert.equal(large.capture.snapshot().phase, "error");
  assert.equal(large.videoTrack.readyState, "ended");
  assert.equal(large.capture.snapshot().previewUrl, null);
});

test("failed or expired upload keeps the preview for an explicit retry", async () => {
  let resolveUpload;
  let uploadSignal;
  const alpha = harness({ upload: ({ signal }) => {
    uploadSignal = signal;
    return new Promise(resolve => { resolveUpload = resolve; });
  } });
  await alpha.capture.start({ consented: true });
  alpha.recorders[0].recorder.chunk();
  alpha.capture.stop();
  await Promise.resolve();
  const sharing = alpha.capture.share();
  alpha.timer(30_000);
  assert.equal(uploadSignal.aborted, true);
  resolveUpload();
  assert.equal(await sharing, false);
  assert.equal(alpha.capture.snapshot().phase, "preview");
  assert.equal(alpha.capture.snapshot().previewUrl, "blob:alpha-preview");
  alpha.capture.discard();
  assert.deepEqual(alpha.revoked, ["blob:alpha-preview"]);
});

import {LovenseCheck} from "./devices/lovense.mjs";

// Runs in an opaque-origin sandbox. Hosted builds inline this trusted module and
// its dependencies so Access cookies are never needed by opaque module requests.
// Only connection/control messages cross the dedicated port; never reader text.
const bridgeUrl = new URL(location.href);
const expectedParentOrigin = bridgeUrl.origin;
const preserveFlexerRenewals = expectedParentOrigin === "https://app.satinlore.com" &&
  ["/device-bridge", "/device-bridge.html", "/alpha/device-bridge"].includes(bridgeUrl.pathname);
const REQUEST_ID = /^[A-Za-z0-9_-]{1,96}$/;
const TOY_ID = /^[A-Za-z0-9_-]{1,128}$/;
let connectedPort = null;
let controller = null;
let closed = false;
let initialized = false;
let preparingAdapter = null;

function exactKeys(message, keys) {
  return message && typeof message === "object" && !Array.isArray(message) &&
    Object.keys(message).sort().join(",") === [...keys].sort().join(",");
}
function operation(message) {
  return typeof message.requestId === "string" && REQUEST_ID.test(message.requestId);
}
function respond(command, ok, result = {}) {
  if (!closed && operation(command)) connectedPort?.postMessage({type: "result", requestId: command.requestId, ok, ...result});
}
function close() {
  if (closed) return;
  closed = true;
  preparingAdapter?.destroy(); preparingAdapter = null;
  controller?.disconnect();
  connectedPort?.postMessage({type: "closed"});
}
function loadSdk() {
  return new Promise((resolve, reject) => {
    // The vendor SDK reads a debug preference at import time. Give it a
    // read-only empty result inside this frame without exposing browser storage.
    Object.defineProperty(globalThis, "localStorage", {
      value: Object.freeze({getItem: () => null}),
      configurable: true,
    });
    const script = document.createElement("script");
    script.src = "https://api.lovense-api.com/basic-sdk/core.min.js";
    script.referrerPolicy = "no-referrer";
    script.onload = () => typeof globalThis.LovenseBasicSdk === "function" ? resolve() : reject(new Error());
    script.onerror = () => reject(new Error());
    document.head.append(script);
  });
}
async function onCommand(event) {
  if (closed) return;
  const command = event.data;
  try {
    if (exactKeys(command, ["type"]) && command.type === "dispose") { close(); return; }
    if (command?.type === "init" && exactKeys(command, ["type", "session"]) && !initialized) {
      if (!exactKeys(command.session, ["uid", "platform", "authToken", "expires_at"])) throw new Error();
      initialized = true;
      let extended = null;
      try {
        // The private build bundles Socket.IO into this protected document.
        // Build-free local development retains the documented Basic SDK route.
        if(!document.querySelector('meta[name="satinlore-hosted-access"][content="true"]'))throw Error();
        const {LovenseSocket}=await import("./devices/lovense-socket.mjs");
        extended = new LovenseSocket({platform:command.session.platform,authToken:command.session.authToken}, {
          preserveFlexerRenewals,
        });
        preparingAdapter = extended;
        await extended.prepared;
      } catch (error) {
        extended?.destroy();
        extended = null;
        if (closed || document.hidden) { close(); return; }
        if (error?.pairing) {
          const {stage, status, code} = error.pairing;
          connectedPort?.postMessage({type: "pairing-diagnostic", stage, status, code});
          // The Basic SDK sends the same authorization request. A vendor rejection will repeat there.
          if (stage === "socket-response" && Number.isSafeInteger(code) && code !== 0) throw error;
        }
        await loadSdk();
      }
      preparingAdapter = null;
      if (closed || document.hidden) { extended?.destroy(); close(); return; }
      controller = new LovenseCheck({
        sdkFactory: options => extended || new globalThis.LovenseBasicSdk(options),
        emit: message => { if (!closed) connectedPort?.postMessage(message); },
      });
      controller.connect(command.session);
      return;
    }
    if (!controller) throw new Error();
    if(command?.type==="enable-personal-range"&&exactKeys(command,["type","requestId","toyId","channels","confirmedStopped"])&&operation(command)){
      if(document.hidden){close();return;}
      if(command.toyId!==controller.selected)throw Error();
      respond(command,true,controller.enablePersonalRange(command.channels,command.confirmedStopped));
    } else if (command?.type === "select" && exactKeys(command, ["type", "id"])) controller.select(command.id);
    else if (command?.type === "refresh" && exactKeys(command, ["type"])) controller.refresh();
    else if (command?.type === "test" && (exactKeys(command, ["type", "level", "ceiling"]) || exactKeys(command, ["type", "level", "ceiling", "channel"]))) {
      if (document.hidden) { close(); return; }
      controller.test(command.level, command.ceiling, command.channel ?? "vibrate");
    } else if (command?.type === "command" && exactKeys(command, ["type", "requestId", "toyId", "level", "ceiling", "channel", "seconds"]) && operation(command)) {
      if (document.hidden) { close(); return; }
      if (typeof command.toyId !== "string" || !TOY_ID.test(command.toyId) || controller.selected !== command.toyId || command.seconds !== 2) throw new Error();
      const result = await controller.command(command.level, command.ceiling, {channel: command.channel, seconds: command.seconds});
      respond(command, true, result);
    } else if (command?.type === "command-vector" && exactKeys(command,["type","requestId","toyId","levels","ceilings","seconds"]) && operation(command)) {
      if(document.hidden){close();return;}
      if(typeof command.toyId!=="string"||!TOY_ID.test(command.toyId)||controller.selected!==command.toyId||command.seconds!==2)throw Error();
      const result=await controller.commandVector(command.levels,command.ceilings,{seconds:command.seconds});
      respond(command,true,result);
    } else if (command?.type === "stop" && exactKeys(command, ["type"])) {
      await controller.stop();
    } else if (command?.type === "stop" && exactKeys(command, ["type", "requestId", "toyId"]) && operation(command)) {
      if (typeof command.toyId !== "string" || !TOY_ID.test(command.toyId)) throw new Error();
      const result = await controller.stopTarget(command.toyId);
      respond(command, result?.status === "submitted", {status: result?.status === "submitted" ? "submitted" : "unconfirmed"});
    } else if (command?.type === "open-app" && exactKeys(command, ["type", "requestId"]) && operation(command)) {
      if (document.hidden) { close(); return; }
      await controller.openApp(); respond(command, true, {status: "submitted"});
    } else throw new Error();
  } catch {
    // A malformed control message pauses output; it can never become a broadcast.
    try { await controller?.stop(); } catch { /* Finite expiry is the fallback. */ }
    if (operation(command || {})) respond(command, false, {message: "The device request could not be confirmed. Check the connection and selection."});
    else if (!closed) connectedPort?.postMessage({type: "error", message: "The device request could not be completed. Check the connection and selection."});
  }
}
function handshake(event) {
  if (connectedPort || event.source !== parent || parent === window || event.origin !== expectedParentOrigin ||
      !exactKeys(event.data, ["type"]) || event.data.type !== "satinlore:bridge" || event.ports.length !== 1) return;
  connectedPort = event.ports[0];
  window.removeEventListener("message", handshake);
  connectedPort.onmessage = onCommand;
  connectedPort.start();
  connectedPort.postMessage({type: "bridge-ready"});
}
window.addEventListener("message", handshake);
document.addEventListener("visibilitychange", () => { if (document.hidden) close(); });
window.addEventListener("pagehide", close);

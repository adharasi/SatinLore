import {LovenseCheck} from "./devices/lovense.mjs";

// This document runs with an opaque origin. It receives one dedicated channel
// from its parent and never requests SatinLore APIs, cookies or reader content.
const expectedParentOrigin = new URL(location.href).origin;
let connectedPort = null;
let controller = null;
let closed = false;
let initialized = false;

function exactKeys(message, keys) {
  return message && typeof message === "object" && !Array.isArray(message) &&
    Object.keys(message).sort().join(",") === keys.sort().join(",");
}

function close() {
  closed = true;
  controller?.disconnect();
  connectedPort?.postMessage({type: "closed"});
}

function loadSdk() {
  return new Promise((resolve, reject) => {
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
      initialized = true;
      await loadSdk();
      if (closed || document.hidden) { close(); return; }
      controller = new LovenseCheck({
        sdkFactory: options => new globalThis.LovenseBasicSdk(options),
        emit: message => connectedPort?.postMessage(message),
      });
      controller.connect(command.session);
      return;
    }
    if (!controller) throw new Error();
    if (command?.type === "select" && exactKeys(command, ["type", "id"])) controller.select(command.id);
    else if (command?.type === "test" && exactKeys(command, ["type", "level", "ceiling"])) {
      if (document.hidden) { close(); return; }
      controller.test(command.level, command.ceiling);
    } else if (command?.type === "stop" && exactKeys(command, ["type"])) controller.stop();
    else throw new Error();
  } catch {
    controller?.stop();
    connectedPort?.postMessage({type: "error", message: "The device request could not be completed. Check the connection and selection."});
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

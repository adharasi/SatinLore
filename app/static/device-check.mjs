import {safeQrUrl} from "./devices/lovense.mjs";

const $ = id => document.getElementById(id);
let session = null;
let bridge = null;
let epoch = 0;
let busy = false;
let selected = null;
let testing = false;
let expiryTimer = null;
let pendingLease = null;

function show(message) { $("message").textContent = message; }
function currentSession() { return session && session.expires_at * 1000 > Date.now(); }
function controls() {
  const signedIn = Boolean(currentSession());
  $("session-status").textContent = signedIn ? "Signed in for this private beta session." : "Sign in with your private invitation.";
  $("invite-form").hidden = signedIn;
  $("redeem").disabled = busy;
  $("logout").disabled = !signedIn || busy;
  $("connect-real").disabled = !signedIn || busy || Boolean(bridge);
  $("disconnect-real").disabled = !bridge;
  $("test-pulse").disabled = !signedIn || busy || !bridge || !selected || testing;
  $("stop-real").disabled = !bridge;
}

function clearPairing() {
  selected = null;
  testing = false;
  $("toy-select").replaceChildren(new Option("Select a device explicitly", ""));
  $("toy-select").disabled = true;
  $("pairing-code").hidden = true;
  $("pairing-code").removeAttribute("src");
  $("connection-status").textContent = "Disconnected";
}

function closeBridge(message = null) {
  const old = bridge;
  bridge = null;
  clearPairing();
  if (old) {
    clearTimeout(old.timeout);
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      old.port?.close();
      old.frame.remove();
      old.release?.();
    };
    // Give a targeted Stop/SDK destroy message a brief chance to run before removal.
    if (old.port) {
      old.port.onmessage = event => { if (event.data?.type === "closed") remove(); };
      old.port.postMessage({type: "dispose"});
      setTimeout(remove, 250);
    } else remove();
  }
  pendingLease?.release();
  pendingLease = null;
  if (message) show(message);
  controls();
}

function forgetSession(message) {
  ++epoch;
  busy = false;
  clearTimeout(expiryTimer);
  session = null;
  closeBridge(message);
}

function setSession(value) {
  if (!value || typeof value.user_id !== "string" || typeof value.csrf_token !== "string" ||
      !Number.isFinite(value.expires_at) || value.expires_at * 1000 <= Date.now()) throw new Error("This session has expired. Redeem a new invitation.");
  session = {user_id: value.user_id, csrf_token: value.csrf_token, expires_at: value.expires_at};
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => forgetSession("Session expired. The connection has been closed."),
    Math.min(value.expires_at * 1000 - Date.now(), 2_147_483_647));
  controls();
}

async function request(path, {method = "GET", body, csrf = session?.csrf_token} = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrf && method !== "GET") headers["X-CSRF-Token"] = csrf;
  const response = await fetch(path, {method, headers, credentials: "same-origin", cache: "no-store",
    ...(body !== undefined ? {body: JSON.stringify(body)} : {})});
  if (!response.ok) {
    const error = new Error(response.status === 401 ? "Your session has expired. Sign in again." :
      response.status === 503 ? "Lovense is not configured on this server. Continue with the simulator or configure developer credentials locally." :
        response.status === 429 ? "Too many requests. Wait a moment before trying again." :
          "The request could not be completed. Check your invitation or connection and try again.");
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

async function checkSession({quiet = false} = {}) {
  const operation = epoch;
  try {
    const value = await request("/api/me");
    if (operation !== epoch) return false;
    if (session && session.user_id !== value.user_id) closeBridge("The session changed. Connect again explicitly.");
    setSession(value);
    if (!quiet) show("Session ready. Connect Lovense to begin the device check.");
    return true;
  } catch (error) {
    if (operation !== epoch) return false;
    if (error.status === 401) forgetSession("Redeem your private beta invitation to connect a device.");
    else {
      closeBridge("Session verification failed. The device connection has been closed.");
      if (!quiet) show(error.message);
    }
    return false;
  }
}

function acquireHardware() {
  if (!navigator.locks) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.locks.request("satinlore-device-check", {ifAvailable: true}, async lock => {
      if (!lock) { resolve(null); return; }
      await new Promise(release => {
        let released = false;
        resolve({release() { if (!released) { released = true; release(); } }});
      });
    }).catch(() => resolve(null));
  });
}

function onBridgeMessage(event, active) {
  if (bridge !== active) return;
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "bridge-ready") {
    active.port.postMessage({type: "init", session: active.credentials});
    active.credentials = null;
  } else if (message.type === "qr") {
    const url = safeQrUrl(message.url);
    if (!url) return;
    $("pairing-code").src = url;
    $("pairing-code").hidden = false;
    clearTimeout(active.timeout);
    show("Scan the private pairing code in Lovense Remote, then select a connected device.");
  } else if (message.type === "toys" && Array.isArray(message.toys)) {
    const previous = selected;
    selected = typeof message.selected === "string" ? message.selected : null;
    const options = [new Option("Select a device explicitly", "")];
    for (const toy of message.toys.slice(0, 50)) {
      if (typeof toy.id === "string" && typeof toy.label === "string") options.push(new Option(`${toy.label} · ${toy.id.slice(-6)}`, toy.id));
    }
    $("toy-select").replaceChildren(...options);
    $("toy-select").value = selected || "";
    $("toy-select").disabled = options.length === 1;
    if (previous && !selected) show("The selected device disconnected. Select it again before testing.");
  } else if (message.type === "selected") {
    selected = message.id;
    show("Device selected. Start with level 1 and observe the full two-second test.");
  } else if (message.type === "state") {
    testing = message.state === "testing";
    $("connection-status").textContent = ({connecting: "Preparing pairing…", waiting: "Waiting for a device", paused: "Connected · paused", testing: "Two-second test requested", disconnected: "Disconnected"})[message.state] || "Paused";
    if (message.message) closeBridge(message.message);
  } else if (message.type === "error") {
    testing = false;
    show("The device request failed. Check the connection and select the device again.");
  } else if (message.type === "closed") closeBridge("Connection closed. Reconnect explicitly to continue.");
  controls();
}

function openBridge(credentials, lease) {
  const frame = document.createElement("iframe");
  frame.sandbox = "allow-scripts";
  frame.title = "Isolated Lovense connection";
  frame.src = "/device-bridge";
  const active = {frame, port: null, credentials, release: lease.release, timeout: null};
  bridge = active;
  frame.addEventListener("load", () => {
    if (bridge !== active) return;
    if (active.port) { closeBridge("The connection frame reloaded. Reconnect explicitly."); return; }
    const channel = new MessageChannel();
    active.port = channel.port1;
    active.port.onmessage = event => onBridgeMessage(event, active);
    active.port.start();
    // The recipient is this exact opaque-origin sandbox, never a general window.
    frame.contentWindow.postMessage({type: "satinlore:bridge"}, "*", [channel.port2]);
  });
  active.timeout = setTimeout(() => { if (bridge === active) closeBridge("Pairing timed out. Disconnect and try again."); }, 30_000);
  $("bridge-container").append(frame);
  controls();
}

$("invite-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  const operation = ++epoch;
  closeBridge();
  busy = true;
  controls();
  const token = $("invite-token").value.trim();
  $("invite-token").value = "";
  try {
    const result = await request("/api/invites/redeem", {method: "POST", body: {token}});
    if (operation !== epoch || document.hidden) return;
    setSession(result);
    show("Invitation redeemed. Connect Lovense when you are ready.");
  } catch (error) { if (operation === epoch) show(error.message); }
  finally { if (operation === epoch) { busy = false; controls(); } }
});

$("connect-real").addEventListener("click", async () => {
  if (busy || bridge || !currentSession() || document.hidden) return;
  const operation = ++epoch;
  busy = true;
  controls();
  let lease = null;
  try {
    lease = await acquireHardware();
    if (!lease) throw new Error(navigator.locks ? "Another tab is using the device check. Disconnect it first." : "This browser cannot coordinate device-check tabs. Use a browser with Web Locks support.");
    if (operation !== epoch || document.hidden) { lease.release(); return; }
    pendingLease = lease;
    const credentials = await request("/api/lovense/session", {method: "POST", body: {}});
    if (operation !== epoch || document.hidden) {
      lease.release();
      if (pendingLease === lease) pendingLease = null;
      return;
    }
    if (credentials.uid !== session?.user_id || credentials.expires_at !== session.expires_at) throw new Error("Session changed. Sign in again before pairing.");
    pendingLease = null;
    openBridge(credentials, lease);
    show("Preparing a private pairing code…");
  } catch (error) {
    lease?.release();
    if (pendingLease === lease) pendingLease = null;
    if (operation === epoch) {
      closeBridge(error.message);
      if (error.status === 401) forgetSession(error.message);
    }
  } finally { if (operation === epoch) { busy = false; controls(); } }
});

$("disconnect-real").addEventListener("click", () => { ++epoch; busy = false; closeBridge("Disconnected. Reconnect and select a device to test again."); });
$("logout").addEventListener("click", async () => {
  if (busy || !session) return;
  const operation = ++epoch;
  closeBridge();
  busy = true;
  controls();
  try {
    await request("/api/logout", {method: "POST"});
    if (operation === epoch) forgetSession("Signed out. The connection is closed.");
  } catch (error) { if (operation === epoch) show("Connection closed, but sign out failed. Retry Sign out."); }
  finally { if (operation === epoch) { busy = false; controls(); } }
});
$("toy-select").addEventListener("change", () => {
  ++epoch;
  busy = false;
  selected = null;
  bridge?.port?.postMessage({type: "select", id: $("toy-select").value});
  controls();
});
$("test-pulse").addEventListener("click", async () => {
  if (busy || testing || !bridge || !selected || document.hidden) return;
  const active = bridge;
  const operation = epoch;
  busy = true;
  controls();
  try {
    if (!await checkSession({quiet: true}) || operation !== epoch || bridge !== active || document.hidden) return;
    active.port.postMessage({type: "test", level: Number($("test-level").value), ceiling: Number($("test-ceiling").value)});
  } finally { if (operation === epoch) { busy = false; controls(); } }
});
$("stop-real").addEventListener("click", () => {
  ++epoch;
  busy = false;
  bridge?.port?.postMessage({type: "stop"});
  show("Stop requested for the selected device.");
  controls();
});
for (const id of ["test-level", "test-ceiling"]) {
  $(id).addEventListener("input", () => {
    ++epoch;
    busy = false;
    $(id + "-value").textContent = $(id).value;
    bridge?.port?.postMessage({type: "stop"});
    controls();
  });
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { ++epoch; busy = false; closeBridge("Disconnected when this tab became hidden. Reconnect explicitly to continue."); }
  else checkSession({quiet: true});
});
window.addEventListener("pagehide", () => { ++epoch; closeBridge(); });
setInterval(() => { if (session && !busy && !document.hidden) checkSession({quiet: true}); }, 15_000);
checkSession();

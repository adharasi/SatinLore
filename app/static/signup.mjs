import {appBasePath, appFetch, appPath} from "./access.mjs";
import {accountContinuation, requestAccount, validCode, validPassword} from "./reader/public-account.mjs";

const unavailable = "SatinLore couldn’t check your account. Try again.";

export function mountSignupPage({document, window, request = (action, body) => requestAccount(action, body, appFetch),
  fetchSession = () => appFetch("/api/access", {cache: "no-store", credentials: "same-origin", redirect: "error",
    signal: AbortSignal.timeout(15000)}), setTimer = setTimeout, clearTimer = clearTimeout}) {
  const node = id => document.getElementById(id);
  const status = node("public-account-status"), heading = node("public-account-heading"), intro = node("public-account-intro");
  const registrationEmail = node("public-register-email"), registrationPassword = node("public-register-password");
  const adult = node("public-adult"), code = node("public-code"), resend = node("public-resend-code");
  const email = node("public-email"), password = node("public-password"), remember = node("public-remember");
  const forms = {
    register: [node("public-register-form"), registrationEmail, heading.textContent, intro.textContent],
    verify: [node("public-code-form"), code, "Verify your email"],
    login: [node("public-login-form"), password, "Sign in to SatinLore", "Your email is verified. Sign in with the password you chose."],
  };
  const actions = ["public-register", "public-verify-code", "public-change-email", "public-login"].map(node);
  const search = window.location.search;
  const continuation = accountContinuation(search);
  const next = new URLSearchParams(search).get("next");
  const billing = document.querySelector('meta[name="satinlore-launch-usage"]') &&
    (continuation.size > 0 || next === "billing");
  const feedback = !billing && next === "feedback";
  const billingSuffix = continuation.size ? `?${continuation}` : "";
  if (billing) {
    continuation.set("next", "billing");
    node("signup-sign-in").href = appPath(`/login?${continuation}`, document);
  } else if (feedback) node("signup-sign-in").href = appPath("/?sign-in=feedback", document);
  const destination = appPath(billing ? `/billing${billingSuffix}` : feedback ? "/support" : "/", document);
  let view = "register", challenge = "", challengeEmail = "", busy = false, canResend = false, timer;

  function report(message, error = false) {
    status.textContent = message;
    status.toggleAttribute("data-error", error);
  }
  function render() {
    for (const [name, [form]] of Object.entries(forms)) form.hidden = view !== name;
    node("signup-existing-account").hidden = view === "login";
    heading.textContent = forms[view][2];
    intro.textContent = view === "verify" ? `Check ${challengeEmail} for a six-digit code. It expires after 10 minutes.` : forms[view][3];
    for (const action of actions) action.disabled = busy;
    resend.disabled = busy || !canResend;
  }
  function show(nextView, message = "") {
    view = nextView;
    report(message);
    render();
    forms[view][1].focus();
  }
  function waitToResend(seconds) {
    clearTimer(timer);
    canResend = false;
    timer = setTimer(() => { canResend = true; render(); }, Math.max(1, Math.min(seconds, 3600)) * 1000);
  }
  async function perform(message, operation) {
    if (busy) return;
    busy = true; report(message); render();
    try { await operation(); }
    catch (error) {
      const serviceError = Number.isFinite(error?.retryAfter);
      report(serviceError ? error.message : unavailable, true);
      if (serviceError && error.retryAfter > 0 && challenge) waitToResend(error.retryAfter);
    } finally { busy = false; render(); }
  }
  function useChallenge(value, address) {
    if (typeof value?.challenge !== "string" || !value.challenge || value.challenge.length > 512) throw Error();
    challenge = value.challenge; challengeEmail = address;
    registrationPassword.value = ""; code.value = ""; adult.checked = false;
    waitToResend(value.resendAfter || 60);
    show("verify", "If the code doesn’t arrive, check your spam folder or request another code after a minute.");
  }
  function clearChallenge() {
    clearTimer(timer); challenge = ""; challengeEmail = ""; code.value = ""; canResend = false;
  }
  function submit(form, handler) {
    forms[form][0].addEventListener("submit", event => {
      event.preventDefault();
      if (view === form && !busy) return handler();
    });
  }
  async function readerIsSignedIn() {
    const response = await fetchSession();
    if (!response.ok || response.redirected) throw Error();
    const session = await response.json();
    return session?.authenticated === true && Number.isSafeInteger(session.expiresAt) && session.expiresAt > Date.now();
  }

  submit("register", () => {
    const address = registrationEmail.value.trim();
    if (!address || !adult.checked) return;
    if (!validPassword(registrationPassword.value)) {
      report("Choose a password with 15 to 128 characters.", true); registrationPassword.focus(); return;
    }
    return perform("Sending your verification code…", async () => {
      const value = await request("register", {email: address, password: registrationPassword.value, adult: true});
      useChallenge(value, address);
    });
  });
  submit("verify", () => {
    if (!challenge || !validCode(code.value)) return;
    return perform("Checking your code…", async () => {
      const result = await request("verify", {challenge, code: code.value});
      if (result?.verified !== true) throw Error();
      email.value = challengeEmail; registrationEmail.value = "";
      clearChallenge(); show("login");
    });
  });
  resend.addEventListener("click", () => {
    if (!challenge || !canResend) return;
    return perform("Sending another code…", async () => useChallenge(
      await request("resend", {challenge, email: challengeEmail}), challengeEmail));
  });
  node("public-change-email").addEventListener("click", () => {
    if (busy || view !== "verify") return;
    registrationEmail.value = challengeEmail;
    clearChallenge(); show("register");
  });
  submit("login", () => {
    const address = email.value.trim();
    if (!address || !password.value) return;
    return perform("Signing in…", async () => {
      const result = await request("login", {email: address, password: password.value, remember: remember.checked});
      if (result?.authenticated !== true || !Number.isSafeInteger(result.expiresAt)) throw Error();
      password.value = "";
      if (!await readerIsSignedIn()) throw Error();
      try {
        const scope = appBasePath(document) ? "preview." : "";
        window.localStorage.setItem(`${scope}satinlore.public-session-change`, window.crypto.randomUUID());
      } catch { /* The reader checks its session when the tab becomes visible. */ }
      window.location.replace(destination);
    });
  });

  render();
  void readerIsSignedIn().then(signedIn => {
    if (signedIn && view === "register" && !busy) window.location.replace(destination);
  }).catch(() => {});
}

if (typeof document !== "undefined") mountSignupPage({document, window});

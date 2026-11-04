const unavailable = 'Account sign-in could not be reached. Try again.';

export async function requestAccount(action, data, request = fetch) {
  const response = await request(`/api/auth/${action}`, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  const value = await response.json();
  if (!response.ok || response.redirected) {
    const error = new Error(typeof value?.error === 'string' && value.error.length <= 250 ? value.error : unavailable);
    error.retryAfter = Number(response.headers.get('Retry-After')) || 0;
    throw error;
  }
  return value;
}

export function mountPublicAccount({document, openDialog, closeDialog, onVerified, onSignOut,
  request = requestAccount, setTimer = setTimeout, clearTimer = clearTimeout}) {
  const node = id => document.getElementById(id);
  const dialog = node('public-account-dialog'), status = node('public-account-status');
  const email = node('public-email'), adult = node('public-adult'), code = node('public-code');
  const trigger = node('public-account'), resend = node('public-resend-code');
  let session = false, busy = false, challenge = '', canResend = true, timer = null, next = null;

  function render() {
    node('public-account-label').textContent = session ? 'Account' : 'Sign in';
    trigger.setAttribute('aria-label', session ? 'Account, signed in' : 'Sign in');
    node('public-account-heading').textContent = session ? 'Your account' : challenge ? 'Check your inbox' : 'Sign in to SatinLore';
    node('public-account-intro').textContent = session ? 'You’re signed in. Saved toy presets are available in Reading controls.' :
      challenge ? 'Enter the six-digit code we emailed you. The code expires after 10 minutes.' :
      'We’ll email you a six-digit code. Use the same steps to create an account or sign back in. You can try the simulator as a guest.';
    node('public-email-form').hidden = session || Boolean(challenge);
    node('public-code-form').hidden = session || !challenge;
    node('public-account-session').hidden = !session;
    for (const id of ['public-send-code','public-verify-code','public-change-email','public-sign-out']) node(id).disabled = busy;
    resend.disabled = busy || !canResend;
    dialog.setAttribute('aria-busy', String(busy));
  }
  function clearCode() {
    clearTimer(timer); timer = null; challenge = ''; canResend = true; code.value = '';
  }
  function clearForm() { clearCode(); email.value = ''; adult.checked = false; }
  function waitToResend(seconds) {
    clearTimer(timer); canResend = false;
    timer = setTimer(() => { canResend = true; render(); }, Math.max(1, Math.min(seconds, 3600)) * 1000);
  }
  async function perform(callback) {
    if (busy) return;
    busy = true; status.textContent = ''; render();
    try { await callback(); }
    catch (error) {
      status.textContent = Number.isFinite(error?.retryAfter) ? error.message : unavailable;
      if (error?.retryAfter > 0 && challenge) waitToResend(error.retryAfter);
    } finally { busy = false; render(); }
  }
  function sendCode() {
    if (!email.value.trim() || !adult.checked) return;
    return perform(async () => {
      const value = await request('request', {email: email.value.trim()});
      if (typeof value?.challenge !== 'string' || !value.challenge || value.challenge.length > 512) throw new Error();
      challenge = value.challenge; code.value = ''; waitToResend(value.resendAfter || 60);
      status.textContent = 'If the email doesn’t arrive, check your spam folder. You can ask for another code after a minute.';
      render(); if (dialog.open) code.focus();
    });
  }
  node('public-email-form').addEventListener('submit', event => { event.preventDefault(); return sendCode(); });
  resend.addEventListener('click', () => { if (canResend) return sendCode(); });
  node('public-code-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!challenge || !adult.checked || !/^[0-9]{6}$/.test(code.value)) return;
    return perform(async () => {
      const value = await request('verify', {challenge, code: code.value, adult: true});
      if (value?.authenticated !== true || !Number.isSafeInteger(value.expiresAt)) throw new Error();
      clearForm();
      if (!await onVerified()) { status.textContent = 'Your code was accepted. Sign-in could not be checked. Try again.'; return; }
      const continuation = dialog.open ? next : null;
      next = null; closeDialog(); continuation?.();
    });
  });
  node('public-change-email').addEventListener('click', () => { clearCode(); status.textContent = ''; render(); email.focus(); });
  node('public-sign-out').addEventListener('click', () => perform(async () => {
    await onSignOut(() => request('logout', {}));
    clearForm(); status.textContent = 'You’re signed out. You can still read and use the simulator.'; render(); email.focus();
  }));
  function close() { next = null; closeDialog(); }
  node('public-account-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  function open(opener, continuation = null) {
    next = continuation; status.textContent = '';
    openDialog(opener); (session ? node('public-sign-out') : challenge ? code : email).focus();
  }
  trigger.hidden = false;
  trigger.addEventListener('click', () => open(trigger));
  render();
  return {open, close, update(signedIn) {
    if (session !== signedIn && signedIn) clearForm();
    session = signedIn; render();
  }};
}

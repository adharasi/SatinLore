const unavailable = 'Account sign-in could not be reached. Try again.';
const invalidPassword = 'Choose a password with 15 to 128 characters.';
const validCode = value => /^[0-9]{6}$/.test(value);
const validPassword = value => {
  const normalized = value.normalize('NFC');
  const length = [...normalized].length;
  return length >= 15 && length <= 128 && new TextEncoder().encode(normalized).length <= 512;
};

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
  const email = node('public-email'), password = node('public-password'), remember = node('public-remember');
  const signupEmail = node('public-register-email'), signupPassword = node('public-register-password'), adult = node('public-adult');
  const forgotEmail = node('public-forgot-email'), resetPassword = node('public-reset-password');
  const code = node('public-code'), resetCode = node('public-reset-code');
  const trigger = node('public-account');
  const resendButtons = ['public-resend-code', 'public-resend-reset'].map(node);
  const views = {
    login: ['public-login-form', email, 'Sign in to SatinLore'],
    register: ['public-register-form', signupEmail, 'Create an account'],
    verify: ['public-code-form', code, 'Verify your email'],
    forgot: ['public-forgot-form', forgotEmail, 'Forgot your password?'],
    reset: ['public-reset-form', resetCode, 'Choose a new password'],
  };
  const actions = ['public-login', 'public-register', 'public-verify-code', 'public-forgot', 'public-reset',
    'public-show-register', 'public-show-forgot', 'public-register-back', 'public-forgot-back',
    'public-change-email', 'public-reset-back', 'public-sign-out'].map(node);
  let session = false, busy = false, view = 'login', challenge = '', challengeEmail = '';
  let canResend = true, timer = null, next = null, visit = 0;

  function render() {
    const copy = {
      login: 'Sign in with your email and password. You can try the simulator as a guest.',
      register: 'Choose a password. We’ll ask you to confirm your email before you sign in.',
      verify: `Check ${challengeEmail} for a six-digit verification code. It expires after 10 minutes.`,
      forgot: 'Enter the email address you used to create your account.',
      reset: `If you have an account for ${challengeEmail}, check your inbox for a six-digit code. It expires after 10 minutes.`,
    };
    node('public-account-label').textContent = session ? 'Account' : 'Sign in';
    trigger.setAttribute('aria-label', session ? 'Account, signed in' : 'Sign in');
    node('public-account-heading').textContent = session ? 'Your account' : views[view][2];
    node('public-account-intro').textContent = session ? 'You’re signed in. Manage reading settings and toy presets in the reader.' : copy[view];
    for (const [name, [id]] of Object.entries(views)) node(id).hidden = session || name !== view;
    node('public-account-session').hidden = !session;
    for (const action of actions) action.disabled = busy;
    for (const button of resendButtons) button.disabled = busy || !canResend;
    dialog.setAttribute('aria-busy', String(busy));
  }
  function focusView() {
    if (dialog.open) (session ? node('public-sign-out') : views[view][1]).focus();
  }
  function clearChallenge() {
    clearTimer(timer); timer = null; challenge = ''; challengeEmail = ''; canResend = true;
    code.value = ''; resetCode.value = '';
  }
  function clearForm() {
    clearChallenge(); view = 'login';
    for (const input of [email, password, signupEmail, signupPassword, forgotEmail, resetPassword]) input.value = '';
    adult.checked = false; remember.checked = false;
  }
  function showView(name, inputEmail = '', message = '') {
    password.value = ''; signupPassword.value = ''; resetPassword.value = '';
    if (name !== 'verify' && name !== 'reset') {
      clearChallenge();
      views[name][1].value = inputEmail;
    }
    view = name;
    status.textContent = message;
    render(); focusView();
  }
  function waitToResend(seconds) {
    clearTimer(timer); canResend = false;
    timer = setTimer(() => { canResend = true; render(); }, Math.max(1, Math.min(seconds, 3600)) * 1000);
  }
  async function perform(operation, apply) {
    if (busy) return;
    const currentVisit = visit;
    const current = () => currentVisit === visit;
    busy = true; status.textContent = ''; render();
    try {
      const value = await operation();
      if (current()) await apply(value, current);
    } catch (error) {
      if (current()) {
        status.textContent = Number.isFinite(error?.retryAfter) ? error.message : unavailable;
        if (error?.retryAfter > 0 && challenge) waitToResend(error.retryAfter);
      }
    } finally { busy = false; render(); }
  }
  function useChallenge(value, address, nextView) {
    if (typeof value?.challenge !== 'string' || !value.challenge || value.challenge.length > 512) throw new Error();
    challenge = value.challenge; challengeEmail = address;
    code.value = ''; resetCode.value = '';
    waitToResend(value.resendAfter || 60);
    showView(nextView, '', 'If the email doesn’t arrive, check your spam folder or request another code after a minute.');
  }
  function submit(id, handler) {
    node(id).addEventListener('submit', event => { event.preventDefault(); return handler(); });
  }
  function click(id, handler) { node(id).addEventListener('click', handler); }

  submit('public-login-form', () => {
    const address = email.value.trim();
    if (!address || !password.value) return;
    return perform(() => request('login', {email: address, password: password.value, remember: remember.checked}), async (value, current) => {
      if (value?.authenticated !== true || !Number.isSafeInteger(value.expiresAt)) throw new Error();
      clearForm();
      const allowed = await onVerified();
      if (!current()) return;
      if (!allowed) { status.textContent = 'You signed in, but your session could not be checked. Try again.'; return; }
      const continuation = dialog.open ? next : null;
      close(); continuation?.();
    });
  });
  submit('public-register-form', () => {
    const address = signupEmail.value.trim();
    if (!address || !adult.checked) return;
    if (!validPassword(signupPassword.value)) { status.textContent = invalidPassword; signupPassword.focus(); return; }
    return perform(() => request('register', {email: address, password: signupPassword.value, adult: true}),
      value => useChallenge(value, address, 'verify'));
  });
  submit('public-code-form', () => {
    if (!challenge || !validCode(code.value)) return;
    return perform(() => request('verify', {challenge, code: code.value}), value => {
      if (value?.verified !== true) throw new Error();
      showView('login', challengeEmail, 'Email verified. Sign in with the password you chose.');
      password.focus();
    });
  });
  submit('public-forgot-form', () => {
    const address = forgotEmail.value.trim();
    if (!address) return;
    return perform(() => request('forgot', {email: address}), value => useChallenge(value, address, 'reset'));
  });
  submit('public-reset-form', () => {
    if (!challenge || !validCode(resetCode.value)) return;
    if (!validPassword(resetPassword.value)) { status.textContent = invalidPassword; resetPassword.focus(); return; }
    return perform(() => request('reset', {challenge, code: resetCode.value, password: resetPassword.value}), value => {
      if (value?.reset !== true) throw new Error();
      showView('login', challengeEmail, 'Password changed. Sign in with your new password.');
      password.focus();
    });
  });
  function resendCode() {
    if (!challenge || !canResend) return;
    const address = challengeEmail, nextView = view;
    return perform(() => request('resend', {challenge, email: address}), value => useChallenge(value, address, nextView));
  }
  click('public-show-register', () => showView('register', email.value));
  click('public-show-forgot', () => showView('forgot', email.value));
  click('public-register-back', () => showView('login', signupEmail.value));
  click('public-forgot-back', () => showView('login', forgotEmail.value));
  click('public-change-email', () => showView('register', challengeEmail));
  click('public-reset-back', () => showView('forgot', challengeEmail));
  click('public-resend-code', resendCode);
  click('public-resend-reset', resendCode);
  click('public-sign-out', () => perform(() => onSignOut(() => request('logout', {})), () => {
    clearForm(); status.textContent = 'You’re signed out. You can still read and use the simulator.'; render(); focusView();
  }));
  function close() {
    ++visit; next = null; clearForm(); render(); closeDialog();
  }
  click('public-account-close', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  function open(opener, continuation = null) {
    next = continuation; status.textContent = '';
    openDialog(opener); focusView();
  }
  trigger.hidden = false;
  click('public-account', () => open(trigger));
  render();
  return {open, close, update(signedIn) {
    if (session !== signedIn && signedIn) clearForm();
    session = signedIn; render();
  }};
}

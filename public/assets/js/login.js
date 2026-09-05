document.addEventListener('DOMContentLoaded', () => {
  // Selected by id, not '.btn-primary': the forgot-password panel added below
  // also uses that class on its own "Send reset link" button, and a plain
  // class selector would grab whichever button happens to come first in the
  // DOM (silently attaching the login handler to the wrong button).
  const btn = document.getElementById('login-submit');
  const emailInput = document.querySelector('input[type="email"]');
  const passwordInput = document.querySelector('input[type="password"]');
  const formHead = document.querySelector('.form-head');

  function banner(cls, bg, color) {
    let el = document.querySelector('.' + cls);
    if (!el) {
      el = document.createElement('div');
      el.className = cls;
      el.style.cssText = `background:${bg};color:${color};border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:16px;`;
      formHead.insertAdjacentElement('afterend', el);
    }
    return el;
  }
  function showError(message) { banner('login-error', '#FCE3DA', '#B31E1A').textContent = message; }
  function showInfo(message) { banner('login-info', '#E3F5EA', '#1B7A43').textContent = message; }

  // Status banners coming back from the verification flow.
  const params = new URLSearchParams(location.search);
  const v = params.get('verified');
  if (v === '1') showInfo('Email verified - you can sign in now.');
  else if (v === 'expired') showError('That verification link has expired. Sign in below to receive a new one.');
  else if (v === 'invalid') showError('That verification link is invalid or has already been used.');
  else if (params.get('verify') === 'pending') showInfo('Account created. Check your email for a link to verify your address before signing in.');
  else if (params.get('reset') === '1') showInfo('Password updated. Sign in with your new password.');

  // Forgot-password: a small inline panel rather than a modal, toggled from
  // the link next to "Remember me". Always shows the same generic message on
  // submit, whether or not the address has an account (anti-enumeration).
  const forgotLink = document.getElementById('forgot-link');
  const forgotPanel = document.getElementById('forgot-panel');
  const forgotEmail = document.getElementById('forgot-email');
  const forgotSend = document.getElementById('forgot-send');
  if (forgotLink && forgotPanel) {
    forgotLink.addEventListener('click', (e) => {
      e.preventDefault();
      const opening = forgotPanel.style.display === 'none';
      forgotPanel.style.display = opening ? 'block' : 'none';
      if (opening) { forgotEmail.value = emailInput.value.trim(); forgotEmail.focus(); }
    });
  }
  if (forgotSend) {
    forgotSend.addEventListener('click', async () => {
      const email = forgotEmail.value.trim();
      if (!email) { forgotEmail.focus(); return; }
      forgotSend.disabled = true;
      const original = forgotSend.innerHTML;
      forgotSend.innerHTML = 'Sending…';
      try {
        await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      } catch (_) { /* generic response either way */ }
      forgotPanel.style.display = 'none';
      showInfo('If that account has a password set, a reset link has been sent.');
      forgotSend.disabled = false;
      forgotSend.innerHTML = original;
    });
  }

  function offerResend(email) {
    const box = document.querySelector('.login-error');
    if (!box || box.querySelector('.resend-link')) return;
    const a = document.createElement('a');
    a.className = 'resend-link';
    a.href = '#';
    a.textContent = ' Resend verification email';
    a.style.cssText = 'display:block;margin-top:6px;color:#B31E1A;font-weight:600;text-decoration:underline;cursor:pointer;';
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await api('/api/auth/resend', { method: 'POST', body: JSON.stringify({ email }) });
      } catch (_) { /* generic response either way */ }
      showInfo('If that account exists and is unverified, a new link has been sent.');
    });
    box.appendChild(a);
  }

  async function initGoogleSignIn() {
    try {
      const config = await api('/api/auth/config');
      if (!config || !config.googleClientId) {
        // No Google configured and the SSO placeholder is gone: hide the whole
        const d = document.getElementById('oauth-divider');
        const r = document.getElementById('oauth-row');
        if (d) d.style.display = 'none';
        if (r) r.style.display = 'none';
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        window.google.accounts.id.initialize({ client_id: config.googleClientId, callback: handleGoogleCredential });
        window.google.accounts.id.renderButton(document.getElementById('google-signin-container'), {
          theme: 'outline', size: 'large', width: 168,
        });
      };
      document.head.appendChild(script);
    } catch (e) {
      console.error('Could not load Google sign-in:', e.message);
    }
  }

  async function handleGoogleCredential(response) {
    try {
      await api('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: response.credential }) });
      window.location.href = '/welcome.html';
    } catch (e) {
      showError(e.message || 'Google sign-in was refused.');
    }
  }

  initGoogleSignIn();

  async function submit() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const rememberMe = document.getElementById('remember-me')?.checked ?? true;
    if (!email || !password) { showError('Please enter both email and password.'); return; }
    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Signing in…';
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password, rememberMe }) });
      window.location.href = '/welcome.html';
    } catch (e) {
      showError(e.message || 'Invalid credentials.');
      if (e.data && e.data.needsVerification) offerResend(email);
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

  btn.addEventListener('click', submit);
  passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  // Show/hide password - a plain, always-visible text toggle (no icon-font
  const eye = document.querySelector('.toggle-eye');
  if (eye) {
    const toggle = () => {
      const show = passwordInput.type === 'password';
      passwordInput.type = show ? 'text' : 'password';
      eye.textContent = show ? 'Hide' : 'Show';
    };
    eye.addEventListener('click', toggle);
    eye.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  }
});

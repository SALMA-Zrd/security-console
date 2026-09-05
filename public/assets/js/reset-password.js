document.addEventListener('DOMContentLoaded', () => {
  const btn = document.querySelector('.btn-primary');
  const passwordInput = document.querySelector('input[type="password"]');
  const confirmInput = document.getElementById('reset-confirm');
  const formHead = document.querySelector('.form-head');
  const sub = document.getElementById('reset-sub');

  const token = new URLSearchParams(location.search).get('token');
  const pwMeter = window.attachPwMeter ? window.attachPwMeter(passwordInput) : null;

  function showError(message) {
    let el = document.querySelector('.login-error');
    if (!el) {
      el = document.createElement('div');
      el.className = 'login-error';
      el.style.cssText = 'background:#FCE3DA;color:#B31E1A;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:16px;';
      formHead.insertAdjacentElement('afterend', el);
    }
    el.textContent = message;
  }

  function disableForm(msg) {
    [passwordInput, confirmInput, btn].forEach((el) => el && (el.disabled = true));
    showError(msg);
  }

  // Check the token up front, same pattern as activate.js, so a dead/expired
  // link fails fast instead of letting the user type a password for nothing.
  (async () => {
    if (!token) return disableForm('This reset link is missing its token.');
    try {
      await api('/api/auth/reset-password?token=' + encodeURIComponent(token));
      if (sub) sub.textContent = 'Choose a new password for your account.';
    } catch (e) {
      disableForm(e.message || 'This reset link is invalid or has expired.');
    }
  })();

  async function submit() {
    if (pwMeter ? !pwMeter.ok() : (window.pwScore && !window.pwScore(passwordInput.value).ok)) {
      showError('Please choose a stronger password (at least "Fair").');
      return;
    }
    if (passwordInput.value !== confirmInput.value) { showError('Passwords do not match.'); return; }

    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = 'Updating…';
    try {
      await api('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: passwordInput.value }),
      });
      // The token is single-use; send the person to sign in with the new password.
      window.location.href = '/login.html?reset=1';
    } catch (e) {
      showError(e.message || 'Could not reset the password.');
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  btn.addEventListener('click', submit);
  confirmInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  const eye = document.querySelector('.toggle-eye');
  if (eye) {
    eye.addEventListener('click', () => {
      const show = passwordInput.type === 'password';
      passwordInput.type = show ? 'text' : 'password';
      eye.classList.toggle('ti-eye', !show);
      eye.classList.toggle('ti-eye-off', show);
    });
  }
});

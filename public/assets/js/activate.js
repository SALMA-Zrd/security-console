document.addEventListener('DOMContentLoaded', () => {
  const btn = document.querySelector('.btn-primary');
  const nameInput = document.querySelector('input[name="name"]');
  const emailInput = document.getElementById('activate-email');
  const passwordInput = document.querySelector('input[type="password"]');
  const confirmInput = document.getElementById('activate-confirm');
  const formHead = document.querySelector('.form-head');
  const sub = document.getElementById('activate-sub');

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
    [nameInput, passwordInput, confirmInput, btn].forEach((el) => el && (el.disabled = true));
    showError(msg);
  }

  // Validate the invite token up front and show which email it's for.
  (async () => {
    if (!token) return disableForm('This activation link is missing its token.');
    try {
      const info = await api('/api/auth/invite?token=' + encodeURIComponent(token));
      if (info && info.email) {
        emailInput.value = info.email;
        if (sub) sub.textContent = 'Set a password to activate ' + info.email + '.';
      }
    } catch (e) {
      disableForm(e.message || 'This invitation is invalid or has expired.');
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
    btn.innerHTML = 'Activating…';
    try {
      await api('/api/auth/activate', {
        method: 'POST',
        body: JSON.stringify({ token, name: nameInput ? nameInput.value.trim() : '', password: passwordInput.value }),
      });
      window.location.href = '/welcome.html';
    } catch (e) {
      showError(e.message || 'Could not activate the account.');
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

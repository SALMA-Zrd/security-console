document.addEventListener('DOMContentLoaded', () => {
  const btn = document.querySelector('.btn-primary');
  const nameInput = document.querySelector('input[name="name"]');
  const emailInput = document.querySelector('input[type="email"]');
  const passwordInput = document.querySelector('input[type="password"]');
  const formHead = document.querySelector('.form-head');
  const pwMeter = window.attachPwMeter ? window.attachPwMeter(passwordInput) : null;

  function showError(message) {
    let el = document.querySelector('.login-error');
    if (!el) {
      el = document.createElement('div');
      el.className = 'login-error';
      el.style.cssText =
        'background:#FCE3DA;color:#B31E1A;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:16px;';
      formHead.insertAdjacentElement('afterend', el);
    }
    el.textContent = message;
  }

  // --- Sign up with Google (account is verified via Google's email_verified) ---
  async function initGoogleSignIn() {
    try {
      const config = await api('/api/auth/config');
      if (!config || !config.googleClientId) return; // not configured -> no button
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        window.google.accounts.id.initialize({ client_id: config.googleClientId, callback: handleGoogleCredential });
        window.google.accounts.id.renderButton(document.getElementById('google-signin-container'), {
          theme: 'outline', size: 'large', width: 168, text: 'signup_with',
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
    const name = nameInput ? nameInput.value.trim() : '';
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) { showError('Please enter both email and password.'); return; }
    if (pwMeter ? !pwMeter.ok() : (window.pwScore && !window.pwScore(password).ok)) {
      showError('Please choose a stronger password (at least "Fair"): 8+ characters mixing letters, numbers and/or symbols.');
      return;
    }

    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Creating account…';
    try {
      const result = await api('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });
      if (result && result.needsVerification) {
        // Account created but not active yet - verification email sent.
        window.location.href = '/login.html?verify=pending';
      } else {
        // Verification disabled server-side → logged straight in.
        window.location.href = '/welcome.html';
      }
    } catch (e) {
      showError(e.message || 'Could not create account.');
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

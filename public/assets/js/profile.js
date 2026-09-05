document.addEventListener('DOMContentLoaded', () => {
  const emailEl = document.getElementById('prof-email');
  const roleEl = document.getElementById('prof-role');
  const nameEl = document.getElementById('prof-name');
  const saveName = document.getElementById('prof-save-name');
  const curEl = document.getElementById('prof-current');
  const newEl = document.getElementById('prof-new');
  const confEl = document.getElementById('prof-confirm');
  const savePw = document.getElementById('prof-save-pw');
  const pwPanel = document.getElementById('prof-pw-panel');
  const pwDesc = document.getElementById('prof-pw-desc');

  const pwMeter = window.attachPwMeter ? window.attachPwMeter(newEl) : null;

  // Identity header (avatar + name + email), kept in sync with the form below.
  const avatarEl = document.getElementById('prof-avatar');
  const headerName = document.getElementById('prof-header-name');
  const headerMail = document.getElementById('prof-header-email');
  function initials(s) {
    const t = String(s || '').trim();
    if (!t) return '—';
    const parts = t.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
    const a = (parts[0] || '')[0] || '';
    const b = (parts[1] || '')[0] || '';
    return ((a + b) || t[0]).toUpperCase();
  }
  function paintIdentity(name, email) {
    if (headerName) headerName.textContent = name || 'No display name yet';
    if (headerMail) headerMail.textContent = email || '';
    if (avatarEl) avatarEl.textContent = initials(name || email);
  }

  // Show/hide toggles for the three password fields (text label, consistent
  // with login/signup - Tabler icons aren't always available).
  document.querySelectorAll('.prof-toggle-eye').forEach((eye) => {
    const input = document.getElementById(eye.dataset.target);
    if (!input) return;
    const toggle = () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.textContent = show ? 'Hide' : 'Show';
    };
    eye.addEventListener('click', toggle);
    eye.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });

  function flash(msg, ok) {
    const el = document.getElementById('prof-flash');
    el.textContent = msg;
    el.style.display = 'block';
    el.style.background = ok ? '#E3F5EA' : '#FCE3DA';
    el.style.color = ok ? '#1B7A43' : '#B31E1A';
    clearTimeout(flash._t);
    flash._t = setTimeout(() => (el.style.display = 'none'), 4000);
  }

  (async () => {
    try {
      const me = await api('/api/settings/account');
      if (!me) return;
      emailEl.value = me.email || '';
      roleEl.textContent = me.role || '-';
      nameEl.value = me.name || '';
      paintIdentity(me.name, me.email);
      // Google-only accounts have no password to change.
      if (me.viaGoogle) {
        curEl.disabled = newEl.disabled = confEl.disabled = savePw.disabled = true;
        pwDesc.textContent = 'This account signs in with Google - there is no password to change here.';
      }
    } catch (e) {
      flash('Could not load your profile: ' + e.message, false);
    }
  })();

  saveName.addEventListener('click', async () => {
    saveName.disabled = true;
    try {
      await api('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ name: nameEl.value.trim() }) });
      flash('Name updated.', true);
      paintIdentity(nameEl.value.trim(), emailEl.value);
    } catch (e) {
      flash(e.message || 'Could not update name.', false);
    } finally {
      saveName.disabled = false;
    }
  });

  savePw.addEventListener('click', async () => {
    if (!curEl.value) return flash('Enter your current password.', false);
    if (pwMeter ? !pwMeter.ok() : (window.pwScore && !window.pwScore(newEl.value).ok)) {
      return flash('New password is too weak (must be at least "Fair").', false);
    }
    if (newEl.value !== confEl.value) return flash('New passwords do not match.', false);

    savePw.disabled = true;
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: curEl.value, newPassword: newEl.value }),
      });
      curEl.value = newEl.value = confEl.value = '';
      newEl.dispatchEvent(new Event('input'));
      flash('Password updated.', true);
    } catch (e) {
      flash(e.message || 'Could not update password.', false);
    } finally {
      savePw.disabled = false;
    }
  });
});

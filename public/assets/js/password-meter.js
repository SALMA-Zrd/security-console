// Shared password strength meter (UX). The blocking rule that actually matters
(function () {
  const LABELS = { 0: 'Too short', 1: 'Weak', 2: 'Fair', 3: 'Good', 4: 'Strong' };
  const COLORS = { 0: '#B31E1A', 1: '#B31E1A', 2: '#9A5B12', 3: '#1F7A85', 4: '#1B7A43' };
  const MIN_SCORE = 2; // must match server passwordPolicy.MIN_SCORE

  function pwScore(pw) {
    pw = String(pw || '');
    if (pw.length < 8) return { score: 0, label: LABELS[0], ok: false };
    let classes = 0;
    if (/[a-z]/.test(pw)) classes++;
    if (/[A-Z]/.test(pw)) classes++;
    if (/[0-9]/.test(pw)) classes++;
    if (/[^A-Za-z0-9]/.test(pw)) classes++;
    let s = 1;
    if (classes >= 2) s++;
    if (classes >= 3) s++;
    if (classes >= 4) s++;
    if (pw.length >= 12 && s < 4) s++;
    if (s > 4) s = 4;
    return { score: s, label: LABELS[s], ok: s >= MIN_SCORE };
  }

  // Insert a meter after the given password input and keep it updated.
  function attachPwMeter(input) {
    const meter = document.createElement('div');
    meter.className = 'pw-meter';
    meter.style.cssText = 'margin-top:8px;';
    meter.innerHTML =
      '<div class="pw-bar" style="height:6px;border-radius:4px;background:#E6DCC8;overflow:hidden;">' +
      '<div class="pw-fill" style="height:100%;width:0;transition:width .2s,background .2s;"></div></div>' +
      '<div class="pw-label" style="font-size:11.5px;margin-top:5px;color:#98A1B6;"></div>';
    const field = input.closest('.field') || input.closest('.prof-field') || input.parentElement;
    field.appendChild(meter);
    const fill = meter.querySelector('.pw-fill');
    const label = meter.querySelector('.pw-label');

    function update() {
      const pw = input.value;
      if (!pw) { fill.style.width = '0'; label.textContent = ''; return; }
      const r = pwScore(pw);
      fill.style.width = (r.score / 4) * 100 + '%';
      fill.style.background = COLORS[r.score];
      label.textContent = 'Strength: ' + r.label + (r.ok ? '' : ' - too weak, please strengthen it');
      label.style.color = COLORS[r.score];
    }
    input.addEventListener('input', update);
    return { ok: () => pwScore(input.value).ok };
  }

  window.pwScore = pwScore;
  window.attachPwMeter = attachPwMeter;
})();

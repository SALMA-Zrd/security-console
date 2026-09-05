// Password strength policy - the SERVER-SIDE source of truth. The browser shows
const MIN_SCORE = 2;

function score(pw) {
  pw = String(pw || '');
  if (pw.length < 8) return { score: 0, label: 'Too short' };

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

  const labels = { 1: 'Weak', 2: 'Fair', 3: 'Good', 4: 'Strong' };
  return { score: s, label: labels[s] };
}

function validate(pw) {
  const r = score(pw);
  return { ...r, valid: r.score >= MIN_SCORE };
}

const WEAK_MESSAGE =
  'Password is too weak. Use at least 8 characters and mix at least two of: lowercase, uppercase, digits, symbols.';

module.exports = { score, validate, MIN_SCORE, WEAK_MESSAGE };

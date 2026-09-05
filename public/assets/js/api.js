// Petit wrapper autour de fetch : envoie toujours le cookie de session,
// et attache automatiquement le jeton anti-CSRF sur les requêtes qui modifient
// des données (le serveur le renvoie via l'en-tête X-CSRF-Token à chaque réponse).
let csrfToken = null;
let csrfPriming = null;

// Ensures a CSRF token is available BEFORE sending a state-changing request.
// The server attaches X-CSRF-Token to every /api response, but on a fresh page
// load the very first call may itself be a POST (e.g. the Integrations page
// auto-tests the connections, or the login page's "forgot password"). Without
// a primed token those POSTs were rejected with 403 and shown as errors even
// though nothing was actually wrong. We fetch a token once (deduplicated) and
// reuse it for the rest of the session.
async function ensureCsrf() {
  if (csrfToken) return;
  if (!csrfPriming) {
    csrfPriming = fetch('/api/auth/csrf-token', { credentials: 'same-origin' })
      .then((res) => {
        const t = res.headers.get('X-CSRF-Token');
        if (t) csrfToken = t;
      })
      .catch(() => {})
      .finally(() => {
        csrfPriming = null;
      });
  }
  await csrfPriming;
}

async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method);

  // Prime the token first when this is a mutating request and we don't have one yet.
  if (needsCsrf && !csrfToken) await ensureCsrf();

  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (needsCsrf && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const res = await fetch(path, {
    credentials: 'same-origin',
    headers,
    ...options,
  });

  // The server refreshes this header on every /api response, so we always have
  // a current token ready for the next mutating call.
  const freshToken = res.headers.get('X-CSRF-Token');
  if (freshToken) csrfToken = freshToken;

  if (res.status === 401) {
    window.location.href = '/login.html';
    return null;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

window.api = api;

// Escapes a value before it is inserted into HTML built with template strings
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
window.escapeHtml = escapeHtml;

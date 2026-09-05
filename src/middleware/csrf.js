// CSRF protection for the JSON API, using the synchronizer token pattern.
//
// Why this is needed even with SameSite=Lax cookies: Lax still allows the
// cookie on top-level GET navigations (and some edge cases), so it's a good
// first line of defense but not a complete one. A random, session-bound token
// that a cross-site page cannot read (no CORS credentials exposure here) and
// must echo back in a custom header closes that gap.
//
// Flow: the frontend calls GET /api/auth/csrf-token (or reads the token
// attached to any API response's session) once, then sends it back as the
// `X-CSRF-Token` header on every state-changing request. api.js does this
// automatically - see public/assets/js/api.js.
const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Exempt paths: auth endpoints that run before the client could have fetched a
// token yet (login, signup, google, activate) and the invite-activation lookup.
// Each is otherwise protected by its own defenses (rate limiting, password
// checks, single-use tokens), so skipping CSRF here doesn't weaken the app -
// none of them relies on an authenticated session to authorize the action.
// Paths are relative to the /api mount point (see server.js: app.use('/api', requireCsrf)),
// so Express strips the leading /api before requireCsrf ever sees req.path.
const EXEMPT_PATHS = new Set([
  '/auth/login',
  '/auth/signup',
  '/auth/google',
  '/auth/activate',
  '/auth/logout', // logging out is safe to allow even without a fresh token
]);

function ensureToken(req) {
  if (!req.session) return null;
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
}

// Attaches req.csrfToken() and exposes the current token on every /api response
// via a response header, so the frontend always has a fresh one to send back.
// Routes that call req.session.regenerate() (login/signup/google/activate) get a
// brand new session with no token yet - they must call req.csrfToken() again
// AFTER regenerating, which both re-issues the token on the new session and
// updates the response header to match it.
function csrfToken(req, res, next) {
  req.csrfToken = () => {
    const token = ensureToken(req);
    if (token) res.setHeader('X-CSRF-Token', token);
    return token;
  };
  req.csrfToken();
  next();
}

function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (EXEMPT_PATHS.has(req.path)) return next();

  const sent = req.get('X-CSRF-Token');
  const expected = req.session && req.session.csrfToken;
  if (!expected || !sent || sent !== expected) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token. Please refresh the page and try again.' });
  }
  next();
}

module.exports = { csrfToken, requireCsrf };

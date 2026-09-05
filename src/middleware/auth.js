// Auth + permission guards. The session carries a `user` object
const roleStore = require('../services/roleStore');

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Not authenticated. Please sign in again.' });
}

function requireAuthPage(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login.html');
}

// API guard: 403 unless the user's role grants `permission`.
function requirePermission(permission) {
  return async (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Not authenticated. Please sign in again.' });
    }
    try {
      if (!(await roleStore.hasPermission(req.session.user.role, permission))) {
        return res.status(403).json({ error: 'You do not have permission to do this.' });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

// Page guard: unauthenticated -> login; authenticated-but-unauthorized -> dashboard.
function requirePermissionPage(permission) {
  return async (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login.html');
    try {
      if (!(await roleStore.hasPermission(req.session.user.role, permission))) {
        return res.redirect('/overview.html');
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

module.exports = { requireAuth, requireAuthPage, requirePermission, requirePermissionPage };

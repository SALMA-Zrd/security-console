const express = require('express');
const { protectRouter } = require('../middleware/asyncRoute');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const userStore = require('../services/userStore');
const mailer = require('../services/mailer');
const roleStore = require('../services/roleStore');
const policy = require('../services/passwordPolicy');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const googleClient = process.env.GOOGLE_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID) : null;

// Email verification is ON by default. Set REQUIRE_EMAIL_VERIFICATION=false to
const REQUIRE_VERIFICATION = String(process.env.REQUIRE_EMAIL_VERIFICATION || 'true').toLowerCase() !== 'false';

// Optional allow-list of email domains permitted to self-register (comma-
const ALLOWED_SIGNUP_DOMAINS = (process.env.SIGNUP_ALLOWED_DOMAINS || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-up attempts. Try again later.' },
});

function sessionUser(u) {
  return { id: u.id, email: u.email, name: u.name || null, role: u.role, viaGoogle: !!u.viaGoogle };
}

function domainOf(email) {
  const at = String(email).lastIndexOf('@');
  return at === -1 ? '' : String(email).slice(at + 1).toLowerCase();
}

function verificationLink(req, token) {
  // Same-origin absolute URL, honouring the proxy protocol on Railway.
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}/api/auth/verify?token=${encodeURIComponent(token)}`;
}

function resetLink(req, token) {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  // Points at a page (not an API route) since the user must type a new
  // password there, unlike /verify which is a one-shot redirect.
  return `${proto}://${req.get('host')}/reset-password.html?token=${encodeURIComponent(token)}`;
}

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password, rememberMe } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = await userStore.verifyPassword(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  // Block sign-in until the email address has been verified.
  if (REQUIRE_VERIFICATION && !user.emailVerified) {
    return res.status(403).json({
      error: 'Please verify your email address before signing in. Check your inbox for the verification link.',
      needsVerification: true,
    });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error.' });
    if (rememberMe) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    req.session.user = sessionUser(user);
    req.csrfToken(); // fresh token for the new (regenerated) session
    res.json({ ok: true, user: req.session.user });
  });
});

// Self-service registration with email-domain gate + email verification.
router.post('/signup', signupLimiter, async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const cleanEmail = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  const pol = policy.validate(password);
  if (!pol.valid) {
    return res.status(400).json({ error: policy.WEAK_MESSAGE });
  }
  if (ALLOWED_SIGNUP_DOMAINS.length && !ALLOWED_SIGNUP_DOMAINS.includes(domainOf(cleanEmail))) {
    return res.status(403).json({
      error: `Sign-up is restricted to: ${ALLOWED_SIGNUP_DOMAINS.map((d) => '@' + d).join(', ')}.`,
    });
  }

  let user;
  try {
    user = await userStore.createUser({
      email: cleanEmail,
      password,
      name,
      emailVerified: !REQUIRE_VERIFICATION,
    });
  } catch (e) {
    return res.status(409).json({ error: e.message || 'Could not create account.' });
  }

  // Verification required: send the link, do NOT open a session yet.
  if (REQUIRE_VERIFICATION) {
    const token = await userStore.issueVerifyToken(user.id);
    if (token) await mailer.sendVerificationEmail(user.email, verificationLink(req, token));
    return res.json({ ok: true, needsVerification: true });
  }

  // Verification disabled: log the user straight in.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error.' });
    req.session.user = sessionUser(user);
    req.csrfToken();
    res.json({ ok: true, user: req.session.user });
  });
});

// GET /api/auth/verify?token=... - opened from the email link. Redirects back
router.get('/verify', async (req, res) => {
  const result = await userStore.verifyEmailToken(req.query.token);
  if (result && result.expired) return res.redirect('/login.html?verified=expired');
  if (!result) return res.redirect('/login.html?verified=invalid');
  return res.redirect('/login.html?verified=1');
});

// POST /api/auth/resend { email } - re-issues a verification link for an
router.post('/resend', loginLimiter, async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const user = email ? await userStore.findByEmail(email) : null;
  if (user && !user.emailVerified) {
    const token = await userStore.issueVerifyToken(user.id);
    if (token) await mailer.sendVerificationEmail(user.email, verificationLink(req, token));
  }
  res.json({ ok: true, message: 'If that account exists and is unverified, a new link has been sent.' });
});

// POST /api/auth/forgot-password { email } - always returns the same generic
// message so the response can't be used to enumerate which emails have an
// account (same anti-enumeration shape as /resend above).
router.post('/forgot-password', loginLimiter, async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const generic = { ok: true, message: 'If that account has a password set, a reset link has been sent.' };
  if (!email) return res.json(generic);
  const token = await userStore.issuePasswordResetToken(email);
  if (token) await mailer.sendPasswordResetEmail(email, resetLink(req, token));
  res.json(generic);
});

// GET /api/auth/reset-password?token=... - lets reset-password.html check the
// token is still valid before showing the "choose a new password" form.
router.get('/reset-password', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Missing token.' });
  const result = await userStore.checkResetToken(token);
  if (!result) return res.status(400).json({ error: 'This reset link is invalid.' });
  if (result.expired) return res.status(400).json({ error: 'This reset link has expired.' });
  res.json({ ok: true });
});

// POST /api/auth/reset-password { token, newPassword } - consumes the token
// (single use) and sets the new password. Public: the user isn't signed in.
router.post('/reset-password', signupLimiter, async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required.' });
  const pol = policy.validate(newPassword);
  if (!pol.valid) return res.status(400).json({ error: policy.WEAK_MESSAGE });

  const result = await userStore.resetPasswordWithToken(token, newPassword);
  if (!result) return res.status(400).json({ error: 'This reset link is invalid.' });
  if (result.expired) return res.status(400).json({ error: 'This reset link has expired.' });
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sc.sid');
    res.json({ ok: true });
  });
});

router.get('/me', async (req, res) => {
  if (req.session && req.session.user) {
    const permissions = await roleStore.getPermissions(req.session.user.role);
    return res.json({ authenticated: true, user: { ...req.session.user, permissions } });
  }
  res.status(401).json({ authenticated: false });
});

router.get('/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});

// GET /api/auth/csrf-token - lets the frontend obtain a CSRF token up front,
// before its first state-changing request. The token itself is carried by the
// X-CSRF-Token response header (set by the csrfToken middleware in server.js);
// the JSON body is just a confirmation. Safe (GET) and does not require a session.
router.get('/csrf-token', (req, res) => {
  res.json({ ok: true });
});

router.post('/google', loginLimiter, async (req, res) => {
  if (!googleClient) {
    return res.status(500).json({ error: 'Google sign-in is not configured (GOOGLE_CLIENT_ID missing from .env).' });
  }

  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'Missing Google token.' });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid Google token.' });
  }

  if (!payload.email_verified) {
    return res.status(401).json({ error: 'Google email not verified.' });
  }

  const email = String(payload.email).toLowerCase();
  let user = await userStore.findByEmail(email);

  // An existing password account that hadn't verified its email yet is now
  // proven verified: Google just confirmed ownership of the address. Without
  // this, the account stayed emailVerified:false forever, silently blocking
  // its password-based sign-in even after this successful Google sign-in.
  if (user && !user.emailVerified) {
    user = await userStore.markEmailVerified(user.id);
  }

  if (!user) {
    // Explicit allowlist (admin's own email + any GOOGLE_ALLOWED_EMAILS) always
    // gets in, regardless of domain restrictions - useful for guests/contractors.
    const explicitAllowList = [
      process.env.APP_USER_EMAIL,
      ...(process.env.GOOGLE_ALLOWED_EMAILS || '').split(',').map((e) => e.trim()),
    ]
      .filter(Boolean)
      .map((e) => e.toLowerCase());

    // Otherwise, Google sign-up follows the SAME domain rule as password sign-up
    // (SIGNUP_ALLOWED_DOMAINS) - empty means any domain is allowed, matching the
    // /signup endpoint's behaviour so both sign-up paths are consistent.
    const domainAllowed =
      !ALLOWED_SIGNUP_DOMAINS.length || ALLOWED_SIGNUP_DOMAINS.includes(domainOf(email));

    if (!explicitAllowList.includes(email) && !domainAllowed) {
      return res.status(403).json({
        error: ALLOWED_SIGNUP_DOMAINS.length
          ? `Sign-up is restricted to: ${ALLOWED_SIGNUP_DOMAINS.map((d) => '@' + d).join(', ')}.`
          : `${payload.email} is not authorized to access this console.`,
      });
    }
    // Google already verified this email, so the account is verified.
    user = await userStore.createUser({ email, name: payload.name, viaGoogle: true, emailVerified: true });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error.' });
    req.session.user = sessionUser({ ...user, viaGoogle: true, name: user.name || payload.name });
    req.csrfToken();
    res.json({ ok: true, user: req.session.user });
  });
});

// --- Profile self-service (any authenticated user) -----------------------
router.patch('/profile', requireAuth, async (req, res) => {
  const { name } = req.body || {};
  try {
    const user = await userStore.updateName(req.session.user.id, name);
    req.session.user.name = user.name;
    res.json({ ok: true, user: { ...req.session.user } });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not update profile.' });
  }
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword) return res.status(400).json({ error: 'New password is required.' });
  if (!(await userStore.hasPassword(req.session.user.id))) {
    return res.status(400).json({ error: 'This account signs in with Google and has no password to change.' });
  }
  const ok = await userStore.verifyPasswordById(req.session.user.id, currentPassword || '');
  if (!ok) return res.status(400).json({ error: 'Current password is incorrect.' });
  const pol = policy.validate(newPassword);
  if (!pol.valid) return res.status(400).json({ error: policy.WEAK_MESSAGE });
  await userStore.setPassword(req.session.user.id, newPassword);
  // Rotate the session id after a credential change (defense in depth against
  // session fixation and against a previously-captured session id). The current
  // user stays signed in; the browser receives a fresh CSRF token in the header.
  const currentUser = req.session.user;
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error.' });
    req.session.user = currentUser;
    req.csrfToken();
    res.json({ ok: true });
  });
});

// --- Invitation activation (public: the invitee isn't logged in yet) ------
router.get('/invite', async (req, res) => {
  const r = await userStore.findByInviteToken(req.query.token);
  if (!r) return res.status(400).json({ error: 'This invitation is invalid.' });
  if (r.expired) return res.status(400).json({ error: 'This invitation has expired.' });
  res.json({ email: r.email });
});

router.post('/activate', signupLimiter, async (req, res) => {
  const { token, name, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token and password are required.' });
  const pol = policy.validate(password);
  if (!pol.valid) return res.status(400).json({ error: policy.WEAK_MESSAGE });

  const result = await userStore.activateInvite(token, { name, password });
  if (!result) return res.status(400).json({ error: 'This invitation is invalid.' });
  if (result.expired) return res.status(400).json({ error: 'This invitation has expired.' });

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error.' });
    req.session.user = sessionUser(result);
    req.csrfToken();
    res.json({ ok: true, user: req.session.user });
  });
});

module.exports = protectRouter(router);

const express = require('express');
const rateLimit = require('express-rate-limit');
const { protectRouter } = require('../middleware/asyncRoute');
const userStore = require('../services/userStore');
const roleStore = require('../services/roleStore');
const mailer = require('../services/mailer');
const audit = require('../services/auditLog');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

// Everything here requires the "manage users & roles" permission.
router.use(requirePermission('manage_users'));

// Invitations and test emails can otherwise be used to spam a mailbox or
// exhaust the email provider's quota; cap them independently of the general
// API rate limit.
const emailActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many email actions. Try again in a few minutes.' },
});

// --- Users ---------------------------------------------------------------
router.get('/users', async (req, res) => {
  const [users, roles] = await Promise.all([
    userStore.listUsers(),
    roleStore.listRoles(),
  ]);
  res.json({ users, roles, me: req.session.user.id });
});

router.post('/users/:id/role', async (req, res) => {
  const { id } = req.params;
  const { role } = req.body || {};

  if (!(await roleStore.roleExists(role))) {
    return res.status(400).json({ error: 'Unknown role.' });
  }
  // Don't let an admin drop their own admin rights (easy self-lockout).
  if (id === req.session.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'You cannot remove your own admin role.' });
  }
  try {
    const before = await userStore.findById(id);
    const user = await userStore.setRole(id, role);
    await audit.record({
      action: 'role_changed',
      actorId: req.session.user.id,
      actorEmail: req.session.user.email,
      targetEmail: user.email,
      details: `${(before && before.role) || '?'} -> ${role}`,
    });
    res.json({ ok: true, user });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not update role.' });
  }
});

router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  if (id === req.session.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }
  try {
    const target = await userStore.findById(id);
    await userStore.deleteUser(id);
    await audit.record({
      action: 'user_deleted',
      actorId: req.session.user.id,
      actorEmail: req.session.user.email,
      targetEmail: target && target.email,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not delete user.' });
  }
});

// --- Roles & permissions ---------------------------------------------------
router.get('/roles', async (req, res) => {
  res.json({ permissions: roleStore.PERMISSIONS, roles: await roleStore.listRoles() });
});

router.post('/roles', async (req, res) => {
  const { name, label, permissions } = req.body || {};
  try {
    const role = await roleStore.createRole({ name, label, permissions });
    await audit.record({
      action: 'role_created',
      actorId: req.session.user.id,
      actorEmail: req.session.user.email,
      details: `${role.name} [${role.permissions.join(', ')}]`,
    });
    res.json({ ok: true, role });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not create role.' });
  }
});

router.patch('/roles/:name', async (req, res) => {
  const { label, permissions } = req.body || {};
  try {
    const role = await roleStore.updateRole(req.params.name, { label, permissions });
    res.json({ ok: true, role });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not update role.' });
  }
});

router.delete('/roles/:name', async (req, res) => {
  try {
    await roleStore.deleteRole(req.params.name);
    await audit.record({
      action: 'role_deleted',
      actorId: req.session.user.id,
      actorEmail: req.session.user.email,
      details: req.params.name,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not delete role.' });
  }
});

// --- Email delivery ---------------------------------------------------------
router.get('/email-status', (req, res) => {
  const via = mailer.resendConfigured() ? 'resend' : mailer.smtpConfigured() ? 'smtp' : null;
  res.json({ configured: mailer.emailConfigured(), via });
});

router.post('/test-email', emailActionLimiter, async (req, res) => {
  const to = String((req.body && req.body.to) || req.session.user.email || '').trim();
  if (!to) return res.status(400).json({ error: 'No recipient address.' });
  const result = await mailer.sendTestEmail(to);
  if (result.delivered) return res.json({ ok: true, to, message: `Test email sent to ${to}.` });
  if (result.notConfigured) {
    return res.status(400).json({ error: 'No email delivery configured. Set RESEND_API_KEY or SMTP_HOST/SMTP_PORT.' });
  }
  return res.status(400).json({ error: result.error || 'Could not send the test email.' });
});

// --- Invitations -------------------------------------------------------------
router.post('/invite', emailActionLimiter, async (req, res) => {
  const { email, role } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!(await roleStore.roleExists(role))) {
    return res.status(400).json({ error: 'Unknown role.' });
  }

  let user;
  try {
    user = await userStore.createUser({ email: cleanEmail, role, emailVerified: false, invited: true });
  } catch (e) {
    return res.status(409).json({ error: e.message || 'Could not create the invite.' });
  }

  const token = await userStore.issueInviteToken(user.id);
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const link = `${proto}://${req.get('host')}/activate.html?token=${encodeURIComponent(token)}`;
  await mailer.sendInviteEmail(user.email, link);
  await audit.record({
    action: 'user_invited',
    actorId: req.session.user.id,
    actorEmail: req.session.user.email,
    targetEmail: user.email,
    details: `role=${role}`,
  });

  // When no email delivery is configured, hand the link back so the admin can share it.
  res.json({ ok: true, user, inviteLink: mailer.emailConfigured() ? undefined : link });
});

// --- Audit log ---------------------------------------------------------------
router.get('/audit', async (req, res) => {
  res.json({ entries: await audit.list(100) });
});

module.exports = protectRouter(router);

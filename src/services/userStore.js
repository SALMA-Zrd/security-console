// User store. Backed by kvStore (Postgres if DATABASE_URL is set, else local
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const kv = require('./kvStore');

const KEY = 'users';

// Roles, from most to least privileged. Only 'admin' is enforced as a real
const ROLES = ['admin', 'analyst', 'viewer'];
const DEFAULT_ROLE = 'viewer';

async function load() {
  const data = await kv.getJSON(KEY, { users: [] });
  return { users: Array.isArray(data.users) ? data.users : [] };
}

async function save(data) {
  await kv.setJSON(KEY, data);
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Never leak the password hash or tokens to callers/API responses.
function publicView(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name || null,
    role: u.role,
    viaGoogle: !!u.viaGoogle,
    emailVerified: !!u.emailVerified,
    invited: !!u.invited,
    createdAt: u.createdAt || null,
  };
}

async function listUsers() {
  const data = await load();
  return data.users
    .slice()
    .sort((a, b) => String(a.email).localeCompare(String(b.email)))
    .map(publicView);
}

async function countUsers() {
  const data = await load();
  return data.users.length;
}

function countAdmins(users) {
  return users.filter((u) => u.role === 'admin').length;
}

async function findRawByEmail(email) {
  const e = normEmail(email);
  const data = await load();
  return data.users.find((u) => u.email === e) || null;
}

async function findByEmail(email) {
  return publicView(await findRawByEmail(email));
}

async function findById(id) {
  const data = await load();
  return publicView(data.users.find((u) => u.id === id));
}

async function createUser({ email, password, role, name, viaGoogle, emailVerified, invited }) {
  const data = await load();
  const e = normEmail(email);
  if (!e) throw new Error('Email is required.');
  if (data.users.some((u) => u.email === e)) {
    throw new Error('An account with this email already exists.');
  }

  let passwordHash = null;
  if (password) {
    if (String(password).length < 8) throw new Error('Password must be at least 8 characters.');
    passwordHash = await bcrypt.hash(String(password), 10);
  }

  // The very first account created (empty store) becomes admin, so the system
  const resolvedRole =
    role && ROLES.includes(role) ? role : data.users.length === 0 ? 'admin' : DEFAULT_ROLE;

  const user = {
    id: crypto.randomUUID(),
    email: e,
    name: name || null,
    role: resolvedRole,
    passwordHash,
    viaGoogle: !!viaGoogle,
    emailVerified: !!emailVerified,
    invited: !!invited,
    createdAt: new Date().toISOString(),
  };
  data.users.push(user);
  await save(data);
  return publicView(user);
}

async function verifyPassword(email, password) {
  const u = await findRawByEmail(email);
  if (!u || !u.passwordHash) return null; // unknown user OR Google-only account (no password)
  const ok = await bcrypt.compare(String(password), u.passwordHash).catch(() => false);
  return ok ? publicView(u) : null;
}

async function setRole(id, role) {
  // Role validity is checked by the caller against roleStore (built-in + custom).
  const data = await load();
  const u = data.users.find((x) => x.id === id);
  if (!u) throw new Error('User not found.');
  if (u.role === 'admin' && role !== 'admin' && countAdmins(data.users) <= 1) {
    throw new Error('Cannot change the role of the last remaining admin.');
  }
  u.role = role;
  await save(data);
  return publicView(u);
}

async function deleteUser(id) {
  const data = await load();
  const u = data.users.find((x) => x.id === id);
  if (!u) throw new Error('User not found.');
  if (u.role === 'admin' && countAdmins(data.users) <= 1) {
    throw new Error('Cannot delete the last remaining admin.');
  }
  data.users = data.users.filter((x) => x.id !== id);
  await save(data);
  return true;
}

// Seed an admin from .env on boot if that email isn't already in the store, so
async function ensureSeedAdmin() {
  const email = normEmail(process.env.APP_USER_EMAIL);
  const hash = process.env.APP_USER_PASSWORD_HASH;
  if (!email || !hash) return;
  const data = await load();
  if (data.users.some((u) => u.email === email)) return;
  data.users.push({
    id: crypto.randomUUID(),
    email,
    name: null,
    role: 'admin',
    passwordHash: hash,
    viaGoogle: false,
    emailVerified: true,
    createdAt: new Date().toISOString(),
    seeded: true,
  });
  await save(data);
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// --- Email verification ---------------------------------------------------
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

async function issueVerifyToken(id) {
  const data = await load();
  const u = data.users.find((x) => x.id === id);
  if (!u) return null;
  const token = crypto.randomBytes(32).toString('hex');
  u.verifyTokenHash = sha256(token);
  u.verifyTokenExpires = Date.now() + VERIFY_TTL_MS;
  await save(data);
  return token;
}

async function verifyEmailToken(token) {
  if (!token) return null;
  const h = sha256(token);
  const data = await load();
  const u = data.users.find((x) => x.verifyTokenHash === h);
  if (!u) return null;
  if (!u.verifyTokenExpires || u.verifyTokenExpires < Date.now()) {
    return { expired: true };
  }
  u.emailVerified = true;
  delete u.verifyTokenHash;
  delete u.verifyTokenExpires;
  await save(data);
  return publicView(u);
}

// --- Profile self-service ---------------------------------------------------
async function updateName(id, name) {
  const data = await load();
  const u = data.users.find((x) => x.id === id);
  if (!u) throw new Error('User not found.');
  u.name = name ? String(name).trim().slice(0, 80) : null;
  await save(data);
  return publicView(u);
}

async function hasPassword(id) {
  const data = await load();
  const u = data.users.find((x) => x.id === id);
  return !!(u && u.passwordHash);
}

async function verifyPasswordById(id, password) {
  const data = await load();
  const u = data.users.find((x) => x.id === id);
  if (!u || !u.passwordHash) return false;
  return bcrypt.compare(String(password), u.passwordHash).catch(() => false);
}

async function setPassword(id, newPassword) {
  const data = await load();
  const u = data.users.find((x) => x.id === id);
  if (!u) throw new Error('User not found.');
  u.passwordHash = await bcrypt.hash(String(newPassword), 10);
  await save(data);
  return publicView(u);
}

// --- Invitations -----------------------------------------------------------
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function issueInviteToken(id) {
  const data = await load();
  const u = data.users.find((x) => x.id === id);
  if (!u) return null;
  const token = crypto.randomBytes(32).toString('hex');
  u.inviteTokenHash = sha256(token);
  u.inviteTokenExpires = Date.now() + INVITE_TTL_MS;
  await save(data);
  return token;
}

async function findByInviteToken(token) {
  if (!token) return null;
  const h = sha256(token);
  const data = await load();
  const u = data.users.find((x) => x.inviteTokenHash === h);
  if (!u) return null;
  if (!u.inviteTokenExpires || u.inviteTokenExpires < Date.now()) return { expired: true };
  return { id: u.id, email: u.email };
}

async function activateInvite(token, { name, password }) {
  if (!token) return null;
  const h = sha256(token);
  const data = await load();
  const u = data.users.find((x) => x.inviteTokenHash === h);
  if (!u) return null;
  if (!u.inviteTokenExpires || u.inviteTokenExpires < Date.now()) return { expired: true };
  u.passwordHash = await bcrypt.hash(String(password), 10);
  if (name) u.name = String(name).trim().slice(0, 80);
  u.emailVerified = true;
  delete u.invited;
  delete u.inviteTokenHash;
  delete u.inviteTokenExpires;
  await save(data);
  return publicView(u);
}

async function markEmailVerified(id) {
  const data = await load();
  const u = data.users.find((x) => x.id === id);
  if (!u) throw new Error('User not found.');
  u.emailVerified = true;
  await save(data);
  return publicView(u);
}

// --- Password reset (forgot password) --------------------------------------
// Short-lived (1h), single-use, hashed token - mirrors the verify/invite
// pattern above. Google-only accounts (no passwordHash) can't request a reset
// since there's no password to change; requestPasswordReset() checks that.
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

async function issuePasswordResetToken(email) {
  const data = await load();
  const u = data.users.find((x) => x.email === normEmail(email));
  // Only issue a token for accounts that actually have a password to reset.
  // The caller (route) always returns the same generic response either way,
  // so this never reveals whether the email exists.
  if (!u || !u.passwordHash) return null;
  const token = crypto.randomBytes(32).toString('hex');
  u.resetTokenHash = sha256(token);
  u.resetTokenExpires = Date.now() + RESET_TTL_MS;
  await save(data);
  return token;
}

async function checkResetToken(token) {
  if (!token) return null;
  const h = sha256(token);
  const data = await load();
  const u = data.users.find((x) => x.resetTokenHash === h);
  if (!u) return null;
  if (!u.resetTokenExpires || u.resetTokenExpires < Date.now()) return { expired: true };
  return { ok: true };
}

async function resetPasswordWithToken(token, newPassword) {
  if (!token) return null;
  const h = sha256(token);
  const data = await load();
  const u = data.users.find((x) => x.resetTokenHash === h);
  if (!u) return null;
  if (!u.resetTokenExpires || u.resetTokenExpires < Date.now()) return { expired: true };
  u.passwordHash = await bcrypt.hash(String(newPassword), 10);
  // Single-use: burn the token immediately so the link can't be replayed.
  delete u.resetTokenHash;
  delete u.resetTokenExpires;
  await save(data);
  return publicView(u);
}

module.exports = {
  ROLES,
  DEFAULT_ROLE,
  listUsers,
  countUsers,
  countAdmins,
  findByEmail,
  findById,
  createUser,
  verifyPassword,
  setRole,
  deleteUser,
  ensureSeedAdmin,
  publicView,
  issueVerifyToken,
  verifyEmailToken,
  updateName,
  hasPassword,
  verifyPasswordById,
  setPassword,
  markEmailVerified,
  issueInviteToken,
  findByInviteToken,
  activateInvite,
  issuePasswordResetToken,
  checkResetToken,
  resetPasswordWithToken,
};

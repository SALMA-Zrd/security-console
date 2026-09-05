// Roles & permissions. Custom roles are backed by kvStore (Postgres or local
const kv = require('./kvStore');

const KEY = 'roles';

const PERMISSIONS = [
  { key: 'view', label: 'View dashboards & findings' },
  { key: 'create_tickets', label: 'Create Jira tickets' },
  { key: 'manage_mappings', label: 'Manage Jira / stack mappings' },
  { key: 'manage_checklists', label: 'Edit security-by-design checklists' },
  { key: 'toggle_integrations', label: 'Toggle integrations (kill-switch)' },
  { key: 'manage_users', label: 'Manage users & roles (admin area)' },
];
const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
const ALL = PERMISSION_KEYS.slice();

// Built-in roles (immutable, defined in code - not stored).
const BUILTIN_ROLES = {
  admin: { label: 'Admin', builtin: true, permissions: ALL.slice() },
  analyst: {
    label: 'Analyst',
    builtin: true,
    permissions: ['view', 'create_tickets', 'manage_mappings', 'manage_checklists'],
  },
  viewer: { label: 'Viewer', builtin: true, permissions: ['view'] },
};

const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

async function loadCustom() {
  const data = await kv.getJSON(KEY, { roles: {} });
  return data && typeof data.roles === 'object' && data.roles ? data.roles : {};
}

async function saveCustom(roles) {
  await kv.setJSON(KEY, { roles });
}

function sanitizePermissions(perms) {
  if (!Array.isArray(perms)) return [];
  const set = new Set(perms.filter((p) => PERMISSION_KEYS.includes(p)));
  return PERMISSION_KEYS.filter((k) => set.has(k));
}

// Merged view: built-ins first, then custom roles.
async function allRoles() {
  const out = {};
  for (const [name, def] of Object.entries(BUILTIN_ROLES)) {
    out[name] = { name, label: def.label, builtin: true, permissions: def.permissions.slice() };
  }
  const custom = await loadCustom();
  for (const [name, def] of Object.entries(custom)) {
    if (BUILTIN_ROLES[name]) continue; // never let a custom role shadow a built-in
    out[name] = {
      name,
      label: (def && def.label) || name,
      builtin: false,
      permissions: sanitizePermissions(def && def.permissions),
    };
  }
  return out;
}

async function listRoles() {
  return Object.values(await allRoles());
}

async function roleExists(name) {
  return !!(await allRoles())[name];
}

async function getPermissions(roleName) {
  const r = (await allRoles())[roleName];
  return r ? r.permissions.slice() : []; // unknown role -> no permissions (deny writes)
}

async function hasPermission(roleName, perm) {
  return (await getPermissions(roleName)).includes(perm);
}

async function createRole({ name, label, permissions }) {
  const id = String(name || '').trim().toLowerCase();
  if (!NAME_RE.test(id)) {
    throw new Error('Role id must be 2-32 chars: lowercase letters, digits, "-" or "_".');
  }
  if (BUILTIN_ROLES[id]) throw new Error('That name is reserved by a built-in role.');
  const custom = await loadCustom();
  if (custom[id]) throw new Error('A role with that id already exists.');
  const perms = sanitizePermissions(permissions);
  if (!perms.length) throw new Error('Pick at least one permission.');
  custom[id] = { label: String(label || id).trim().slice(0, 60) || id, permissions: perms };
  await saveCustom(custom);
  return { name: id, label: custom[id].label, builtin: false, permissions: perms };
}

async function updateRole(name, { label, permissions }) {
  const id = String(name || '').toLowerCase();
  if (BUILTIN_ROLES[id]) throw new Error('Built-in roles cannot be modified.');
  const custom = await loadCustom();
  if (!custom[id]) throw new Error('Role not found.');
  const perms = sanitizePermissions(permissions);
  if (!perms.length) throw new Error('Pick at least one permission.');
  custom[id] = { label: String(label || custom[id].label).trim().slice(0, 60) || id, permissions: perms };
  await saveCustom(custom);
  return { name: id, label: custom[id].label, builtin: false, permissions: perms };
}

async function deleteRole(name) {
  const id = String(name || '').toLowerCase();
  if (BUILTIN_ROLES[id]) throw new Error('Built-in roles cannot be deleted.');
  const custom = await loadCustom();
  if (!custom[id]) throw new Error('Role not found.');
  // Refuse to delete a role still assigned to users (lazy require avoids a
  const userStore = require('./userStore');
  const users = await userStore.listUsers();
  const inUse = users.filter((u) => u.role === id).length;
  if (inUse > 0) {
    throw new Error(`This role is assigned to ${inUse} user(s). Reassign them first.`);
  }
  delete custom[id];
  await saveCustom(custom);
  return true;
}

module.exports = {
  PERMISSIONS,
  PERMISSION_KEYS,
  BUILTIN_ROLES,
  listRoles,
  allRoles,
  roleExists,
  getPermissions,
  hasPermission,
  createRole,
  updateRole,
  deleteRole,
};

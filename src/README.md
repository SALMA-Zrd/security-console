# Backend (`src/`)

Express backend for the Security Console. The entry point is `../server.js`,
which wires the middleware pipeline, mounts the routes below, and fails fast on
insecure configuration. This folder holds the routes, middleware, and services.

## Layout

```
src/
|- middleware/   # request guards
|- routes/       # HTTP endpoints (mounted under /api/*)
|- services/     # business logic + data access (no Express here)
```

## `middleware/`

- **`auth.js`** - `requireAuth` / `requireAuthPage` (must be signed in) and
  `requirePermission(...)` / `requirePermissionPage(...)` (role must grant a given
  permission). Permissions are resolved per request from `services/roleStore.js`,
  so role changes take effect without re-login.
- **`integrationsGuard.js`** - the integrations kill-switch. Blocks calls that
  reach out to DefectDojo/Jira when integrations are disabled in settings.

## `routes/` (mounted in `server.js`)

| Mount point | File | Purpose |
|---|---|---|
| `/api/auth` | `auth.js` | Login, sign-up, logout, Google sign-in, `/me`, email verification, invite activation, profile + password change. |
| `/api/admin` | `admin.js` | Manage users, roles/permissions, invitations, and read the audit log. Requires the `manage_users` permission. |
| `/api/dashboard` | `dashboard.js` | Aggregated KPIs, findings, projects, trends, checklists, mappings, and Jira ticket creation. |
| `/api/defectdojo` | `defectdojo.js` | Thin proxy/helpers for DefectDojo. |
| `/api/jira` | `jira.js` | Thin proxy/helpers for Jira. |
| `/api/settings` | `settings.js` | Account info and the integrations toggle. |

## `services/`

- **`userStore.js`** - users in `data/users.json`: create, verify password,
  roles, email-verification tokens, invitations, profile updates. Passwords are
  bcrypt-hashed; tokens are stored hashed with expiry.
- **`roleStore.js`** - the permission catalog, the built-in roles (`admin`,
  `analyst`, `viewer`), and custom roles in `data/roles.json`.
- **`auditLog.js`** - append-only trail of sensitive actions in `data/audit.json`.
- **`configStore.js`** - non-secret app config (integrations toggle, mappings,
  checklist state, activity log) in `data/config.json`.
- **`defectdojoClient.js` / `jiraClient.js`** - HTTP clients that call the
  external APIs using credentials from `.env` (never exposed to the browser).
- **`mailer.js`** - sends verification/invite emails via SMTP when configured;
  otherwise logs the link to the server console.
- **`passwordPolicy.js`** - server-side password strength scoring (the source of
  truth that blocks weak passwords; the browser mirrors it for the strength bar).

## Data files

All under `data/` (git-ignored, created on first run): `users.json`,
`roles.json`, `audit.json`, `config.json`. See the root
[`README.md`](../README.md) for the note about persistence on ephemeral
filesystems.

# Security Console

A self-hosted **security dashboard** that unifies vulnerability findings from
[DefectDojo](https://www.defectdojo.org/) and their remediation status in
[Jira](https://www.atlassian.com/software/jira) into a single place - so you can
triage findings, open tickets, and track posture without switching tools.

The browser never talks to DefectDojo or Jira directly: all calls go through the
Node.js backend, which holds the API credentials server-side and returns
aggregated JSON. That's what makes it safe to run in front of static pages.

![Node](https://img.shields.io/badge/node-%3E%3D20-3c873a)
![Express](https://img.shields.io/badge/express-4.x-000000)
![Status](https://img.shields.io/badge/status-project%2FPFA-blue)

---

## Features

- **Authentication** - email + password (bcrypt) and optional *Sign in with Google*.
- **Roles & permissions** - built-in `admin`, `analyst`, `viewer`, plus **custom
  roles** an admin can create with any subset of permissions. Authorization is
  enforced **server-side** on every write route, not just hidden in the UI.
- **Sign-up & email verification** - self-registration with a server-enforced
  **password strength** policy; accounts must **verify their email** before they
  can sign in (pluggable SMTP - see below).
- **Invitations** - an admin can create an account and send an **activation link**;
  the invitee sets their own password.
- **User profile** - each user can change their own display name and password.
- **Password reset** - a self-service *"forgot password"* flow for password
  accounts, using single-use, hashed, time-limited tokens (email or console link).
- **Audit log** - sensitive actions (role changes, deletions, invitations, role
  management) are recorded with who did what, when.
- **Dashboards** - overview KPIs, vulnerabilities table + detail, projects,
  trends over time, a Security-by-Design checklist, integrations mapping, and a
  settings page with an integrations **kill-switch**.
- **Create Jira tickets** from a finding, with the DefectDojo↔Jira link written
  back.

## Tech stack

- **Runtime:** Node.js >= 20 (CommonJS), single `node server.js` process.
- **Backend:** Express 4, `express-session`, `express-rate-limit`, `helmet`,
  `bcryptjs`, `google-auth-library`, `node-fetch` v2, `dotenv`, and optional
  `nodemailer` (only used if SMTP is configured).
- **Frontend:** plain HTML + vanilla JavaScript - no framework, no build step.
- **Storage:** secrets in environment variables; application data **and** sessions
  in **PostgreSQL** when `DATABASE_URL` is set (recommended for any deployment),
  falling back to local JSON files under `data/`
  (`users.json`, `roles.json`, `audit.json`, `config.json`) otherwise.
- **External APIs:** DefectDojo API v2 (token auth), Jira Cloud API v3.

## Architecture

### End-to-end data flow

Security results are produced upstream by the CI/CD pipeline, centralized in
DefectDojo, surfaced by this app (**SecureFlow**), and turned into tickets in
Jira:

```
CI/CD Security Pipeline   (GitHub Actions: Trivy image/fs/config, Semgrep, SBOM)
        |
        v
    DefectDojo            (aggregates & de-duplicates findings — the source of truth)
        |
        v
    SecureFlow            (this app: dashboards, RBAC, checklists, ticket creation)
        |
        v
      Jira                (tickets created from findings; status synced back)
```

Two things worth stating explicitly:

- **GitHub is not integrated directly with SecureFlow.** The CI/CD pipeline pushes
  its scan results into DefectDojo; SecureFlow only ever reads findings from
  DefectDojo. There is no direct GitHub ↔ SecureFlow connection.
- **A DefectDojo *Product* is a *project* in SecureFlow.** Everything the app
  groups "by project" (dashboard stats, filters, per-project vulnerabilities,
  trends, and the Security-by-Design checklist) is keyed on the DefectDojo
  Product. Add a new Product in DefectDojo and it appears in SecureFlow
  automatically — no project names are hard-coded.

### Runtime request flow

```
Browser (static pages + vanilla JS)
        |  fetch /api/... (session cookie sc.sid)
        v
Express backend (server.js)
  |- middleware   : Helmet/CSP - HTTPS redirect (prod) - rate-limit - session
  |- auth gate    : requireAuth  (401 / redirect if not signed in)
  |- RBAC gate    : requirePermission(...) on write routes
  |- routes       : /api/auth /api/admin /api/dashboard /api/defectdojo /api/jira /api/settings
  |- services     : userStore - roleStore - auditLog - configStore
                    defectdojoClient - jiraClient - mailer - passwordPolicy
        |  Token / Basic auth (from .env, never sent to the browser)
        v
DefectDojo API v2   +   Jira Cloud API v3
```

## Getting started

### Prerequisites

- Node.js >= 20 and npm
- A DefectDojo instance (API v2 token) and a Jira Cloud instance (API token) -
  optional for a first local run; the dashboards will just show no data.

### Install & configure

```bash
git clone <your-repo-url>
cd security-console
npm install
cp .env.example .env
```

Fill in `.env`. At minimum, set a session secret and a bootstrap admin:

```bash
# a long random string
openssl rand -hex 32

# a bcrypt hash of your admin password
node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD', 10))"
```

Put those into `SESSION_SECRET`, `APP_USER_EMAIL`, and `APP_USER_PASSWORD_HASH`.
On first start this account is seeded as the initial **admin**; everyone else
signs up or gets invited, and the admin assigns roles.

### Run

```bash
npm start        # production-style start
npm run dev      # auto-restart on changes (node --watch)
```

Open <http://localhost:3000> - you'll be redirected to `/login.html`. Locally
(`NODE_ENV` unset) the HTTPS redirect and the `secure` cookie flag are disabled,
which is expected.

> **Tip for local testing without email:** with `REQUIRE_EMAIL_VERIFICATION=true`
> (the default) and no SMTP configured, the verification/activation link is
> printed to the **server console**. Either copy it from the logs, or set
> `REQUIRE_EMAIL_VERIFICATION=false` while developing. The seeded admin is always
> pre-verified.

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | HTTP port (default `3000`). |
| `SESSION_SECRET` | **yes** | Long random string used to sign session cookies. |
| `DATABASE_URL` | no | Postgres connection string. When set, both app data and sessions are stored in Postgres instead of local JSON files / in-memory sessions - **recommended for any real deployment**. |
| `DATA_DIR` | no | Folder for local JSON data storage, used only when `DATABASE_URL` is unset (default `./data`). On an ephemeral filesystem (e.g. Railway without a volume), point this at a mounted persistent volume. |
| `BACKUP_KEEP`, `BACKUP_INTERVAL_HOURS` | no | Tune the automatic rotating backups (default: keep 14 snapshots, one every 6h). |
| `APP_USER_EMAIL` | **yes** | Email of the seeded initial admin. |
| `APP_USER_PASSWORD_HASH` | **yes** | bcrypt hash of the admin password. |
| `REQUIRE_EMAIL_VERIFICATION` | no | `true` (default) blocks sign-in until email is verified; `false` for local demos. |
| `SIGNUP_ALLOWED_DOMAINS` | no | Comma-separated email domains allowed to self-register. Empty = any. |
| `RESEND_API_KEY` | no | Sends email via the Resend HTTPS API instead of SMTP. **Use this on Railway's free/Hobby plans**, which block outbound SMTP ports (25/465/587) - the HTTP API is unaffected. Takes priority over `SMTP_*` if set. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | no | SMTP for real emails. If unset, links are logged to the console instead. |
| `GOOGLE_CLIENT_ID` | no | Enables *Sign in with Google*. Empty = button hidden. |
| `GOOGLE_ALLOWED_EMAILS` | no | Extra Google emails allowed to sign in (besides `APP_USER_EMAIL`). |
| `DEFECTDOJO_BASE_URL`, `DEFECTDOJO_API_TOKEN` | for data | DefectDojo instance + API v2 token. |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | for data | Jira Cloud instance + API token. |

> Never commit your real `.env`. `.env` and `data/` are already in `.gitignore`.

## Roles & permissions

Authorization is decided by **permissions**, not role names. Built-in roles map
to permission sets; admins can add custom roles from the Admin page.

| Permission | admin | analyst | viewer |
|---|:---:|:---:|:---:|
| View dashboards & findings | yes | yes | yes |
| Create Jira tickets | yes | yes | - |
| Manage Jira / stack mappings | yes | yes | - |
| Edit Security-by-Design checklists | yes | yes | - |
| Toggle integrations (kill-switch) | yes | - | - |
| Manage users & roles | yes | - | - |

The initial `admin` role can't be deleted, and the last admin can't be demoted
or removed.

## Project structure

```
security-console/
|- server.js               # entry point: middleware pipeline, routes, fail-fast
|- src/
|  |- middleware/          # auth + permission guards, integrations kill-switch
|  |- routes/              # auth, admin, dashboard, defectdojo, jira, settings
|  |- services/            # userStore, roleStore, auditLog, configStore,
|                          # defectdojoClient, jiraClient, mailer, passwordPolicy
|- public/                 # static frontend (HTML pages + assets/js)
|- .env.example
|- package.json
|- README.md
```

## Security notes & limitations

Sensible defaults are in place: bcrypt password hashing; `httpOnly` + `sameSite`
+ `secure` (in prod) session cookies with a custom name; session **regeneration**
on login/sign-up/activation; Helmet with a Content-Security-Policy; HTTPS
redirect in production; rate limiting on auth endpoints (and on invitations /
test emails specifically); fail-fast on insecure configuration; server-side
RBAC; email verification; a server-enforced password policy; verification/
invite tokens stored **hashed** with expiry; and **CSRF protection** on every
state-changing API request (synchronizer token pattern - see
`src/middleware/csrf.js` - enforced automatically by the frontend's `api.js`).

When `DATABASE_URL` is set, sessions are stored in Postgres (`connect-pg-simple`)
instead of the default in-memory store, so they survive restarts/redeploys and
don't leak memory - see *Deployment* below.

Known limitations to be aware of before any real production use:

- **Session store without a database.** If `DATABASE_URL` is not set, sessions
  fall back to the default in-memory store, which doesn't persist across
  restarts and doesn't scale to multiple instances. Set `DATABASE_URL` to fix
  this (also required for the database storage option below).
- **Data persistence without a database.** If `DATABASE_URL` is not set, data
  lives in JSON files under the folder given by `DATA_DIR` (default `data/`). On
  platforms with an **ephemeral filesystem** (e.g. Railway), attach a
  **persistent volume** and point `DATA_DIR` at its mount path - otherwise this
  data (including the audit log) is wiped on redeploy. Setting `DATABASE_URL`
  avoids this entirely. See *Deployment* below.
- **CSP:** inline event handlers have been removed and `script-src` no longer
  allows `'unsafe-inline'` (`script-src-attr` is `'none'`), so inline **script**
  injection is blocked by the policy. `'unsafe-inline'` is still allowed for
  **styles** (`style-src`), because the pages use many inline `style=""`
  attributes; inline CSS injection is a materially lower-severity vector than
  script injection. Consistent output escaping remains the primary XSS defense.
- **Dependencies:** if you enable SMTP, use `nodemailer@^9` (older 6.x has known
  advisories). Run `npm audit` after installing.

This is a project / PFA-grade application: a solid baseline of hardening, but not
independently audited or penetration-tested.

## Deployment (Railway)

1. Set the environment variables above in the Railway project (at least
   `SESSION_SECRET`, `APP_USER_EMAIL`, `APP_USER_PASSWORD_HASH`, and set
   `NODE_ENV=production`). The app **refuses to start** in production without a
   proper `SESSION_SECRET`.
2. Railway terminates TLS at the edge; the app trusts one proxy hop and redirects
   HTTP to HTTPS using `x-forwarded-proto` - no extra config needed.
3. **Persistent data - choose one:**
   - **Database (recommended).** Add a PostgreSQL plugin on Railway, then set
     `DATABASE_URL` on this service (Railway lets you reference the plugin's URL
     directly). The app creates its table automatically on first boot. No volume
     needed for data in this mode.
   - **Volume + JSON files (simpler, less robust).** In the Railway service:
     **Settings -> Volumes -> New Volume**, mount path `/data`, then set
     `DATA_DIR=/data`. Used only if `DATABASE_URL` is unset. Without either
     option, `data/` is wiped on every deploy.
4. **Automatic backups.** On startup and every few hours the app snapshots the
   JSON stores into `DATA_DIR/backups/backup-<timestamp>/` (keeping the last
   `BACKUP_KEEP`, default 14). To restore, copy a snapshot's files back into
   `DATA_DIR` and restart. These snapshots live on the same volume - for off-site
   safety, copy them elsewhere periodically. Tune with `BACKUP_KEEP` and
   `BACKUP_INTERVAL_HOURS`.

## Roadmap

- Drop `'unsafe-inline'` from `style-src` by migrating the remaining inline
  `style=""` attributes to CSS classes. (Inline script handlers and the
  `script-src` `'unsafe-inline'` allowance have **already** been removed.)
- Off-site copies of the automatic backups (currently on the same volume/DB as the data).
- Optional two-factor authentication.

## License

No license is set yet. Add a `LICENSE` file (e.g. MIT) before sharing publicly if
you want to define reuse terms.

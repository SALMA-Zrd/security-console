# Frontend (`public/`)

Static frontend for the Security Console: plain HTML pages plus vanilla
JavaScript. **No framework and no build step** - the files are served as-is by
Express (`express.static`). Icons use the Tabler icon font (loaded from a CDN);
where the font is unavailable, controls fall back to text (e.g. the password
"Show" toggle).

## Pages

| Page | Access | Purpose |
|---|---|---|
| `login.html` | public | Sign in (password or Google). |
| `signup.html` | public | Self-registration with a password-strength bar. |
| `activate.html` | public | Set a password from an invitation link. |
| `welcome.html` | authenticated | Short greeting, then redirect to the overview. |
| `overview.html` | authenticated | KPIs and weekly signal. |
| `vulnerabilities.html` | authenticated | Findings table with filters. |
| `vulnerability-detail.html` | authenticated | One finding; create a Jira ticket. |
| `projects.html` | authenticated | Per-project cards. |
| `trends.html` | authenticated | Metrics over time. |
| `security-by-design.html` | authenticated | Best-practice checklist per stack. |
| `integrations.html` | authenticated | Connection test, project↔Jira mapping, activity. |
| `settings.html` | authenticated | Account info + integrations kill-switch. |
| `profile.html` | authenticated | Change your own name and password. |
| `admin.html` | `manage_users` only | Manage users, roles/permissions, invites, audit log. |

Each page has a matching script in `assets/js/` (e.g. `overview.html` ->
`assets/js/overview.js`).

## Shared scripts (`assets/js/`)

- **`api.js`** - `window.api(path, options)` wraps `fetch` (sends the session
  cookie, redirects to login on 401, throws on API errors). Also exposes
  `window.escapeHtml(...)` used to escape untrusted data before it goes into the
  DOM.
- **`nav.js`** - makes the sidebar clickable and injects the Profile link (all
  users), the Admin link (only with `manage_users`), and a Log out button.
- **`password-meter.js`** - `window.pwScore(pw)` and `window.attachPwMeter(input)`
  for the strength bar. Mirrors the server-side policy in
  `../../src/services/passwordPolicy.js`.

## Conventions

- All data from DefectDojo/Jira or API errors is passed through `escapeHtml`
  before being inserted with `innerHTML` (XSS protection).
- Scripts are included in order: `api.js` first, then the page script, with
  `nav.js` on authenticated pages.

See the root [`README.md`](../README.md) for setup, configuration, and the
security notes.

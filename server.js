require('dotenv').config();

// Prefer IPv4 for all outbound connections. Some hosts (e.g. Railway) have no
try { require('dns').setDefaultResultOrder('ipv4first'); } catch (e) { /* older Node */ }

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./src/routes/auth');
const defectdojoRoutes = require('./src/routes/defectdojo');
const jiraRoutes = require('./src/routes/jira');
const dashboardRoutes = require('./src/routes/dashboard');
const settingsRoutes = require('./src/routes/settings');
const adminRoutes = require('./src/routes/admin');
const userStore = require('./src/services/userStore');
const backup = require('./src/services/backup');
const { requireAuthPage, requirePermissionPage } = require('./src/middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// --- Fail fast on misconfiguration, instead of silently running insecurely ---
if (isProd) {
  const problems = [];
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'dev-secret-change-me') {
    problems.push('SESSION_SECRET is missing or still set to the insecure default - set it to a long random string.');
  }
  if (!process.env.APP_USER_EMAIL || !process.env.APP_USER_PASSWORD_HASH) {
    problems.push('APP_USER_EMAIL / APP_USER_PASSWORD_HASH are not set - no one could log in.');
  }
  if (problems.length) {
    console.error('Refusing to start in production with insecure/incomplete configuration:');
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }
}

// Seed the first admin and start backups are done in the boot sequence at the
// bottom of this file, awaited before the app starts accepting requests - see
// startServer() - so a login attempt right after boot can never race the seed
// write, especially against Postgres where it's a real network round-trip.

// --- Health check for Railway (or any host) - deliberately public, no session,
app.get('/health', (req, res) => res.status(200).json({ ok: true }));

app.set('trust proxy', 1);

// Railway terminates TLS at its edge and forwards to the app over plain HTTP,
if (isProd) {
  app.use((req, res, next) => {
    if (req.secure || req.get('x-forwarded-proto') === 'https') return next();
    return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
  });
}

// En-têtes de sécurité de base (CSP, no-sniff, etc.)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'unsafe-inline' removed: every onclick="" attribute across the app
        // (security-by-design.html, overview.html) is now wired via
        // addEventListener in external JS, and the one inline <script> block
        // that lived in security-by-design.html was moved into
        // security-by-design.js. Google's own inline bootstrap script
        // (rendered by gsi/client) doesn't need script-src-attr, only the
        // external script origin below.
        scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
        scriptSrcAttr: ["'none'"],
        // styleSrc still allows 'unsafe-inline': the app uses ~100 inline
        // style="" attributes across most pages for one-off layout tweaks.
        // Migrating all of them to CSS classes is a much larger, separate
        // refactor (visual regression risk on every page) than the handful of
        // onclick="" handlers removed above, and inline CSS injection is a
        // materially lower-severity vector than inline script injection
        // (no access to cookies, session, or the DOM's data). Left as a
        // deliberate, documented trade-off rather than done silently.
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'https://accounts.google.com'],
        frameSrc: ['https://accounts.google.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    // Helmet's default Cross-Origin-Opener-Policy ("same-origin") blocks the
    // postMessage handshake Google Sign-In's popup needs to report back to this
    // page, leaving the popup blank/stuck. "same-origin-allow-popups" is
    // Google's documented fix: keeps the isolation benefit while allowing
    // window.open()'d auth popups to communicate back.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  })
);

app.use(express.json());

// General rate limit across the whole API - the login/Google endpoints already have
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});
app.use('/api', apiLimiter);

// Session store: use Postgres when DATABASE_URL is set, so sessions survive
// redeploys and don't leak memory (the default MemoryStore is dev-only and
// warns loudly about this in production - see kvStore.js for the same
// DATABASE_URL-driven pattern used for the app's data).
let sessionStore;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const PgSession = require('connect-pg-simple')(session);
  const sessionPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Verify the DB server certificate by default (see kvStore.js). Only relaxed
    // when DATABASE_SSL_REJECT_UNAUTHORIZED=false is set explicitly.
    ssl: process.env.DATABASE_URL.includes('sslmode=require')
      ? { rejectUnauthorized: String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false' }
      : false,
  });
  sessionStore = new PgSession({ pool: sessionPool, tableName: 'session', createTableIfMissing: true });
} else if (isProd) {
  console.warn(
    '[session] No DATABASE_URL set: using the in-memory session store, which does not persist ' +
      'across restarts and is not meant for production. Set DATABASE_URL to fix this.'
  );
}

app.use(
  session({
    name: 'sc.sid',
    store: sessionStore, // undefined -> express-session's default MemoryStore
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,       // inaccessible en JS côté navigateur
      sameSite: 'lax',
      secure: isProd,        // cookie envoyé en HTTPS uniquement en production
      maxAge: 8 * 60 * 60 * 1000, // 8h
    },
  })
);

// CSRF protection for state-changing API requests (see middleware/csrf.js):
// a session-bound token must be echoed back in the X-CSRF-Token header.
const { csrfToken, requireCsrf } = require('./src/middleware/csrf');
app.use('/api', csrfToken);
app.use('/api', requireCsrf);

// --- API ---
app.use('/api/auth', authRoutes);
app.use('/api/defectdojo', defectdojoRoutes);
app.use('/api/jira', jiraRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/admin', adminRoutes);

// --- Pages protégées : tout sauf login.html exige une session valide ---
const protectedPages = [
  '/welcome.html',
  '/overview.html',
  '/vulnerabilities.html',
  '/vulnerability-detail.html',
  '/projects.html',
  '/trends.html',
  '/security-by-design.html',
  '/profile.html',
  '/', // racine -> redirige vers overview (protégé) ou login
];

app.get(protectedPages, requireAuthPage, (req, res, next) => {
  if (req.path === '/') return res.redirect('/overview.html');
  next();
});

// Configuration pages are permission-gated so read-only users (viewer) can't
// reach them. Integrations manages Jira/stack mappings -> "manage_mappings"
// (analyst + admin). Settings' only real action is the integrations kill-switch
// -> "toggle_integrations" (admin only). Unauthorized-but-authenticated users
// are bounced to Overview by requirePermissionPage.
app.get('/integrations.html', requirePermissionPage('manage_mappings'), (req, res, next) => next());
app.get('/settings.html', requirePermissionPage('toggle_integrations'), (req, res, next) => next());

// The Admin page is reserved for admins. Non-admins are bounced to the
app.get('/admin.html', requirePermissionPage('manage_users'), (req, res, next) => next());

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => res.status(404).send('Not found'));

// Boot sequence: seed the admin FIRST and await it, so the app never starts
// accepting logins before that account actually exists in the store (a real
// race against Postgres, which is a network call, unlike the old local-file
// path). Backups start right after; app.listen() only happens once both are done.
async function startServer() {
  try {
    await userStore.ensureSeedAdmin();
  } catch (e) {
    console.error('Failed to seed the initial admin account:', e.message);
    process.exit(1);
  }
  backup.start();
  app.listen(PORT, () => {
    console.log(`Security Console running at http://localhost:${PORT}`);
  });
}

startServer();

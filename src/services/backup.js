// Automatic rotating backups of the app's data, regardless of backend.
//
// - Local JSON mode (no DATABASE_URL): copies the JSON files from DATA_DIR.
// - Postgres mode (DATABASE_URL set): exports every kv_store row to JSON files
//   with the same names/shape, so a restore works the same way in both modes
//   and existing snapshots stay meaningful if you ever switch backends.
const fs = require('fs');
const path = require('path');
const DATA_DIR = require('./dataDir');
const kv = require('./kvStore');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEYS = ['users', 'roles', 'audit', 'config'];
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 14));
const INTERVAL_MS = Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS || 6)) * 60 * 60 * 1000;

function rotate() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;
    const entries = fs
      .readdirSync(BACKUP_DIR)
      .filter((n) => n.startsWith('backup-'))
      .sort(); // timestamp-prefixed -> chronological
    while (entries.length > KEEP) {
      const oldest = entries.shift();
      fs.rmSync(path.join(BACKUP_DIR, oldest), { recursive: true, force: true });
    }
  } catch (e) {
    console.error('[backup] rotate failed:', e.message);
  }
}

async function snapshot() {
  try {
    const values = {};
    for (const key of KEYS) {
      values[key] = await kv.getJSON(key, null);
    }
    const present = KEYS.filter((k) => values[k] !== null);
    if (!present.length) return null; // nothing to back up yet

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 6);
    const dir = path.join(BACKUP_DIR, 'backup-' + stamp);
    fs.mkdirSync(dir, { recursive: true });
    for (const key of present) {
      fs.writeFileSync(path.join(dir, key + '.json'), JSON.stringify(values[key], null, 2), 'utf8');
    }
    rotate();
    return dir;
  } catch (e) {
    console.error('[backup] snapshot failed:', e.message);
    return null;
  }
}

function start() {
  snapshot().then((dir) => {
    if (dir) console.log(`[backup] initial snapshot written to ${dir}`);
  });
  const timer = setInterval(() => {
    snapshot();
  }, INTERVAL_MS);
  if (timer.unref) timer.unref(); // don't keep the process alive just for backups
  console.log(
    `[backup] enabled - every ${INTERVAL_MS / 3600000}h, keeping ${KEEP} snapshots in ${BACKUP_DIR} ` +
      `(source: ${kv.usingDatabase() ? 'Postgres' : 'local JSON files'})`
  );
}

module.exports = { snapshot, rotate, start, BACKUP_DIR };

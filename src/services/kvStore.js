// Storage backend used by every store (userStore, roleStore, auditLog,
const fs = require('fs');
const path = require('path');
const DATA_DIR = require('./dataDir');

const DATABASE_URL = process.env.DATABASE_URL || '';

let pgPool = null;
let pgReadyPromise = null;

// TLS options for the Postgres connection. When the URL asks for TLS
// (sslmode=require), verify the server certificate by DEFAULT. This prevents a
// man-in-the-middle on the DB connection, which carries session data and
// password hashes. Certificate verification can be turned off ONLY by setting
// DATABASE_SSL_REJECT_UNAUTHORIZED=false explicitly (e.g. a managed provider
// presenting a self-signed cert whose risk you accept knowingly).
function pgSslOption(url) {
  if (!url.includes('sslmode=require')) return false;
  const reject = String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false';
  return { rejectUnauthorized: reject };
}

function getPool() {
  if (!pgPool) {
    // Lazy require: apps that don't set DATABASE_URL never need "pg" installed.
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: pgSslOption(DATABASE_URL),
    });
  }
  return pgPool;
}

async function ensureTable() {
  if (!pgReadyPromise) {
    pgReadyPromise = getPool().query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }
  return pgReadyPromise;
}

function usingDatabase() {
  return !!DATABASE_URL;
}

// Read the JSON document stored at `key`. Returns `fallback` if absent.
async function getJSON(key, fallback) {
  if (usingDatabase()) {
    await ensureTable();
    const { rows } = await getPool().query('SELECT value FROM kv_store WHERE key = $1', [key]);
    return rows.length ? rows[0].value : fallback;
  }
  try {
    const file = path.join(DATA_DIR, key + '.json');
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

// Write the JSON document at `key` (upsert).
async function setJSON(key, value) {
  if (usingDatabase()) {
    await ensureTable();
    await getPool().query(
      `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)]
    );
    return;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, key + '.json'), JSON.stringify(value, null, 2), 'utf8');
}

async function closePool() {
  if (pgPool) await pgPool.end();
}

module.exports = { getJSON, setJSON, usingDatabase, closePool };

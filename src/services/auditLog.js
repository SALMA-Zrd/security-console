// Append-only audit trail of sensitive actions (role changes, deletions,
const kv = require('./kvStore');

const KEY = 'audit';
const MAX_ENTRIES = 500;

async function load() {
  const d = await kv.getJSON(KEY, { entries: [] });
  return { entries: Array.isArray(d.entries) ? d.entries : [] };
}

async function save(d) {
  await kv.setJSON(KEY, d);
}

// entry: { action, actorId, actorEmail, targetEmail?, details? }
async function record(entry) {
  const d = await load();
  d.entries.unshift({ timestamp: new Date().toISOString(), ...entry });
  d.entries = d.entries.slice(0, MAX_ENTRIES);
  await save(d);
}

async function list(limit = 100) {
  const d = await load();
  return d.entries.slice(0, Math.max(0, Math.min(limit, MAX_ENTRIES)));
}

module.exports = { record, list };

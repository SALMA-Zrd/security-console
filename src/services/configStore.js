// App configuration store (integrations toggle, Jira/stack mappings, checklist
const kv = require('./kvStore');

const KEY = 'config';
const MAX_LOG_ENTRIES = 50;

function defaultConfig() {
  return {
    integrationsEnabled: true,
    productJiraMapping: {}, // { "<defectdojo_product_id>": "<JIRA_PROJECT_KEY>" }
    productStackMapping: {}, // { "<defectdojo_product_id>": "node" | "python" | "php" | "flutter" }
    checklistState: {}, // { "<defectdojo_product_id>": { "<checklist_item_id>": true } }
    personalChecklist: {}, // { "<user_id>": { "<checklist_item_id>": true } } - the no-project checklist, per user
    activityLog: [],
  };
}

async function load() {
  const raw = await kv.getJSON(KEY, null);
  return { ...defaultConfig(), ...(raw || {}) };
}

async function save(config) {
  await kv.setJSON(KEY, config);
}

async function getConfig() {
  return load();
}

async function isIntegrationsEnabled() {
  const c = await load();
  return c.integrationsEnabled !== false;
}

async function setIntegrationsEnabled(enabled) {
  const c = await load();
  c.integrationsEnabled = !!enabled;
  await save(c);
  await addActivityLog(enabled ? 'connection' : 'disconnect', enabled ? 'Integrations re-enabled' : 'Integrations disconnected by user');
  return c;
}

async function getMapping(productId) {
  const c = await load();
  return c.productJiraMapping[String(productId)] || null;
}

async function getAllMappings() {
  const c = await load();
  return c.productJiraMapping;
}

async function setMapping(productId, jiraProjectKey) {
  const c = await load();
  c.productJiraMapping[String(productId)] = jiraProjectKey;
  await save(c);
  return c;
}

async function removeMapping(productId) {
  const c = await load();
  delete c.productJiraMapping[String(productId)];
  await save(c);
  return c;
}

// --- Product -> tech stack (used by the Security-by-design checklist) ---
async function getStack(productId) {
  const c = await load();
  return c.productStackMapping[String(productId)] || null;
}

async function getAllStacks() {
  const c = await load();
  return c.productStackMapping;
}

async function setStack(productId, stack) {
  const c = await load();
  if (stack) {
    c.productStackMapping[String(productId)] = stack;
  } else {
    delete c.productStackMapping[String(productId)];
  }
  await save(c);
  return c;
}

// --- Security-by-design checklist state, per DefectDojo product (shared) ---
async function getChecklistState(productId) {
  const c = await load();
  return c.checklistState[String(productId)] || {};
}

async function setChecklistItem(productId, itemId, checked) {
  const c = await load();
  const key = String(productId);
  if (!c.checklistState[key]) c.checklistState[key] = {};
  if (checked) {
    c.checklistState[key][itemId] = true;
  } else {
    delete c.checklistState[key][itemId];
  }
  await save(c);
  return c.checklistState[key];
}

async function resetChecklistState(productId) {
  const c = await load();
  delete c.checklistState[String(productId)];
  await save(c);
}

// --- Personal (no-project) checklist, stored server-side per user ---
async function getPersonalChecklist(userId) {
  const c = await load();
  return c.personalChecklist[String(userId)] || {};
}

async function setPersonalChecklistItem(userId, itemId, checked) {
  const c = await load();
  const key = String(userId);
  if (!c.personalChecklist[key]) c.personalChecklist[key] = {};
  if (checked) c.personalChecklist[key][itemId] = true;
  else delete c.personalChecklist[key][itemId];
  await save(c);
  return c.personalChecklist[key];
}

async function resetPersonalChecklist(userId) {
  const c = await load();
  delete c.personalChecklist[String(userId)];
  await save(c);
}

/** type: 'sync' | 'error' | 'ticket' | 'connection' | 'disconnect' */
async function addActivityLog(type, message) {
  const c = await load();
  c.activityLog.unshift({ type, message, timestamp: new Date().toISOString() });
  c.activityLog = c.activityLog.slice(0, MAX_LOG_ENTRIES);
  await save(c);
}

async function getActivityLog(limit = 10) {
  const c = await load();
  return c.activityLog.slice(0, limit);
}

module.exports = {
  getConfig,
  isIntegrationsEnabled,
  setIntegrationsEnabled,
  getMapping,
  getAllMappings,
  setMapping,
  removeMapping,
  getStack,
  getAllStacks,
  setStack,
  getChecklistState,
  setChecklistItem,
  resetChecklistState,
  getPersonalChecklist,
  setPersonalChecklistItem,
  resetPersonalChecklist,
  addActivityLog,
  getActivityLog,
};

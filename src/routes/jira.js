const express = require('express');
const { protectRouter } = require('../middleware/asyncRoute');
const jira = require('../services/jiraClient');
const configStore = require('../services/configStore');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntegrationsEnabled } = require('../middleware/integrationsGuard');

const router = express.Router();
router.use(requireAuth);
router.use(requireIntegrationsEnabled);
// Reading Jira data requires the base "view" permission (see dashboard.js).
router.use(requirePermission('view'));

router.post('/test', async (req, res) => {
  try {
    const result = await jira.testConnection();
    await configStore.addActivityLog('sync', `Jira connection test succeeded (${result.user})`);
    res.json(result);
  } catch (e) {
    await configStore.addActivityLog('error', `Jira connection test failed: ${e.message}`);
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Basic guardrail on client-supplied JQL: this app has a single trusted admin
const JQL_MAX_LENGTH = 500;
function isValidJql(jql) {
  return typeof jql === 'string' && jql.length > 0 && jql.length <= JQL_MAX_LENGTH;
}

router.get('/issues', async (req, res) => {
  try {
    const { jql, maxResults } = req.query;
    if (jql !== undefined && !isValidJql(jql)) {
      return res.status(400).json({ error: `Invalid jql (must be a non-empty string, max ${JQL_MAX_LENGTH} chars).` });
    }
    const data = await jira.searchIssues({
      jql: jql || undefined,
      maxResults: maxResults ? Number(maxResults) : undefined,
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.get('/issues/:key', async (req, res) => {
  try {
    const data = await jira.getIssue(req.params.key);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = protectRouter(router);

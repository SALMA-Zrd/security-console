const express = require('express');
const { protectRouter } = require('../middleware/asyncRoute');
const configStore = require('../services/configStore');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/settings/account - the logged-in account, including its role.
router.get('/account', async (req, res) => {
  res.json({
    email: req.session.user.email,
    name: req.session.user.name || null,
    role: req.session.user.role,
    viaGoogle: !!req.session.user.viaGoogle,
    integrationsEnabled: await configStore.isIntegrationsEnabled(),
    defectdojoUrl: process.env.DEFECTDOJO_BASE_URL || null,
    jiraUrl: process.env.JIRA_BASE_URL || null,
  });
});

// POST /api/settings/integrations  { enabled: boolean }
router.post('/integrations', requirePermission('toggle_integrations'), async (req, res) => {
  const { enabled } = req.body || {};
  await configStore.setIntegrationsEnabled(!!enabled);
  res.json({ ok: true, integrationsEnabled: await configStore.isIntegrationsEnabled() });
});

module.exports = protectRouter(router);

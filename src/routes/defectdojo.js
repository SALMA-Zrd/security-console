const express = require('express');
const { protectRouter } = require('../middleware/asyncRoute');
const dd = require('../services/defectdojoClient');
const configStore = require('../services/configStore');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntegrationsEnabled } = require('../middleware/integrationsGuard');

const router = express.Router();
router.use(requireAuth);
router.use(requireIntegrationsEnabled);
// Reading DefectDojo data requires the base "view" permission (see dashboard.js).
router.use(requirePermission('view'));

// Used by the "Sync now" button on the Integrations page.
router.post('/test', async (req, res) => {
  try {
    const result = await dd.testConnection();
    await configStore.addActivityLog('sync', `DefectDojo connection test succeeded (${result.user})`);
    res.json(result);
  } catch (e) {
    await configStore.addActivityLog('error', `DefectDojo connection test failed: ${e.message}`);
    res.status(502).json({ ok: false, error: e.message });
  }
});

router.get('/findings', async (req, res) => {
  try {
    const { limit, offset, severity, active } = req.query;
    const data = await dd.getFindings({
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      severity,
      active: active === undefined ? true : active === 'true',
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.get('/findings/:id', async (req, res) => {
  try {
    const data = await dd.getFindingById(req.params.id);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.get('/products', async (req, res) => {
  try {
    const data = await dd.getProducts();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.get('/engagements', async (req, res) => {
  try {
    const data = await dd.getEngagements();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = protectRouter(router);

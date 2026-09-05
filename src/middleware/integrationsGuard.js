const configStore = require('../services/configStore');

/** Real, reversible kill-switch: when the user clicks "Disconnect" in Settings, */
async function requireIntegrationsEnabled(req, res, next) {
  try {
    if (await configStore.isIntegrationsEnabled()) return next();
    return res.status(409).json({
      error: 'DefectDojo and Jira are currently disconnected. Reconnect them from Settings to use this feature.',
      disconnected: true,
    });
  } catch (e) {
    next(e);
  }
}

module.exports = { requireIntegrationsEnabled };

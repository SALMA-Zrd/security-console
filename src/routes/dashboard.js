const express = require('express');
const { protectRouter } = require('../middleware/asyncRoute');
const dd = require('../services/defectdojoClient');
const jira = require('../services/jiraClient');
const configStore = require('../services/configStore');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { requireIntegrationsEnabled } = require('../middleware/integrationsGuard');

const router = express.Router();
router.use(requireAuth);
router.use(requireIntegrationsEnabled);

// Enforce the base "view" permission for every dashboard endpoint. Until now
// this permission was declared in roleStore but never checked, so a custom role
// created WITHOUT "view" could still read every finding, project and trend.
// All three built-in roles (admin, analyst, viewer) include "view", so this is
// a no-op for them; it only closes the gap for custom no-view roles. Stricter
// write routes below still layer their own requirePermission() on top.
router.use(requirePermission('view'));

const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low', 'Info'];

// Real mapping applied when creating a Jira ticket - the same one shown on the
const SEVERITY_TO_PRIORITY = { Critical: 'Highest', High: 'High', Medium: 'Medium', Low: 'Low', Info: 'Low' };

// "Resolution rate" shown on Overview, replacing the old "Posture score".
function computeResolutionRate(allFindings) {
  const total = allFindings.length;
  if (total === 0) return { pct: null, mitigated: 0, total: 0 };
  const mitigated = allFindings.filter((f) => !!f.mitigated).length;
  return { pct: Math.round((mitigated / total) * 100), mitigated, total };
}

// Security posture = resolution rate of the findings that matter most:
function computePostureCH(allFindings) {
  const ch = allFindings.filter((f) => f.severity === 'Critical' || f.severity === 'High');
  const total = ch.length;
  if (total === 0) return { pct: null, resolved: 0, total: 0 };
  const resolved = ch.filter((f) => !!f.mitigated).length;
  return { pct: Math.round((resolved / total) * 100), resolved, total };
}

/** Real weekly opened/closed counts, derived directly from DefectDojo's own */
function computeWeeklySignal(allFindings, weeksCount = 7) {
  const now = new Date();
  const weekStart = (d) => {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7; // Monday = 0
    x.setDate(x.getDate() - day);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const thisWeekStart = weekStart(now);
  const weeks = [];
  for (let i = weeksCount - 1; i >= 0; i -= 1) {
    const start = new Date(thisWeekStart);
    start.setDate(start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    weeks.push({ start, end, opened: 0, closed: 0 });
  }

  allFindings.forEach((f) => {
    if (f.date) {
      const d = new Date(f.date);
      const w = weeks.find((w) => d >= w.start && d < w.end);
      if (w) w.opened += 1;
    }
    if (f.mitigated) {
      const d = new Date(f.mitigated);
      const w = weeks.find((w) => d >= w.start && d < w.end);
      if (w) w.closed += 1;
    }
  });

  return weeks.map((w) => ({
    label: w.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    opened: w.opened,
    closed: w.closed,
  }));
}

// GET /api/dashboard/overview
router.get('/overview', async (req, res) => {
  const errors = [];
  let findings = { count: 0, results: [] };
  let allFindingsForSignal = [];
  let products = { count: 0, results: [] };
  let jiraIssues = { total: 0, issues: [] };

  try {
    // One exhaustive fetch (active + mitigated) covers both this route's needs:
    // allFindingsForSignal for the weekly signal/resolution/posture metrics,
    // and `findings` (active-only) for topFindings/at-risk-products/oldest-
    // critical below - derived by filtering rather than a second capped call,
    // so those are no longer limited to a 200-item sample either.
    const wide = await dd.getAllFindings({ active: undefined });
    allFindingsForSignal = wide.results || [];
    const activeResults = allFindingsForSignal.filter((f) => f.active);
    findings = { count: activeResults.length, results: activeResults };
  } catch (e) {
    errors.push({ source: 'defectdojo', message: e.message });
  }

  try {
    products = await dd.getAllProducts();
  } catch (e) {
    errors.push({ source: 'defectdojo', message: e.message });
  }

  try {
    const jiraData = await jira.searchIssues({ maxResults: 200 });
    jiraIssues = { total: jiraData.total, issues: jiraData.issues };
  } catch (e) {
    errors.push({ source: 'jira', message: e.message });
  }

  // findings.results is the full active-findings set (derived above from the
  // exhaustive fetch), so this count is exact - no extra per-severity API
  // calls needed (a previous version made 5 additional requests here to work
  // around the old 200-item cap; that cap no longer exists).
  const bySeverity = SEVERITY_ORDER.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
  (findings.results || []).forEach((f) => {
    if (bySeverity[f.severity] !== undefined) bySeverity[f.severity] += 1;
  });

  const atRiskProductIds = new Set();
  const criticalProductIds = new Set();
  let oldestCriticalDate = null;
  // `findings.results` is now the full active-findings set (derived above from
  // the exhaustive fetch), so these are exact - no longer sample-limited.
  (findings.results || []).forEach((f) => {
    if (f.severity === 'Critical') {
      const productId = f.related_fields?.test?.engagement?.product?.id;
      if (productId) criticalProductIds.add(productId);
      if (f.date && (!oldestCriticalDate || new Date(f.date) < new Date(oldestCriticalDate))) {
        oldestCriticalDate = f.date;
      }
    }
    if (f.severity !== 'Critical' && f.severity !== 'High') return;
    const productId = f.related_fields?.test?.engagement?.product?.id;
    if (productId) atRiskProductIds.add(productId);
  });
  const oldestCriticalDays = oldestCriticalDate
    ? Math.floor((Date.now() - new Date(oldestCriticalDate).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const openJiraCount = (jiraIssues.issues || []).filter(
    (i) => !['Done', 'Closed', 'Resolved'].includes(i.fields?.status?.name)
  ).length;

  const weeklySignal = computeWeeklySignal(allFindingsForSignal, 7);
  const last2Weeks = weeklySignal.slice(-2);
  const openedLast2 = last2Weeks.reduce((s, w) => s + w.opened, 0);
  const closedLast2 = last2Weeks.reduce((s, w) => s + w.closed, 0);

  const resolutionRate = computeResolutionRate(allFindingsForSignal);
  const postureCH = computePostureCH(allFindingsForSignal);

  res.json({
    source: 'live', // the frontend uses this field to remove the "Demo mode" badge
    generatedAt: new Date().toISOString(),
    kpis: {
      openFindings: findings.count ?? (findings.results || []).length,
      criticalFindings: bySeverity.Critical,
      projects: products.count ?? (products.results || []).length,
      projectsAtRisk: atRiskProductIds.size,
      criticalProjectsCount: criticalProductIds.size,
      oldestCriticalDays,
      resolutionRatePct: resolutionRate.pct,
      resolutionMitigatedCount: resolutionRate.mitigated,
      resolutionTotalCount: resolutionRate.total,
      postureScorePct: postureCH.pct,
      postureResolvedCount: postureCH.resolved,
      postureTotalCount: postureCH.total,
      openJiraTickets: openJiraCount,
    },
    bySeverity,
    weeklySignal,
    signalSummary: { openedLast2, closedLast2 },
    topFindings: (findings.results || []).slice(0, 10),
    errors,
  });
});

// GET /api/dashboard/vulnerabilities
router.get('/vulnerabilities', async (req, res) => {
  try {
    const findings = await dd.getAllFindings({ active: true });
    const mappings = await dd.getAllJiraFindingMappings().catch(() => ({ results: [] }));
    // Resolve the real DefectDojo "reporter" id into a name for each finding,
    const users = await dd.getAllUsers().catch(() => ({ results: [] }));
    const userById = new Map(
      (users.results || []).map((u) => [
        u.id,
        u.username || `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Unknown',
      ])
    );

    const mapByFindingId = new Map();
    (mappings.results || []).forEach((m) => {
      const findingId = m.finding || m.finding_id;
      if (findingId) mapByFindingId.set(findingId, m.jira_key || m.jira_id);
    });

    const jiraKeys = [...mapByFindingId.values()].filter(Boolean);
    let jiraStatusByKey = new Map();
    if (jiraKeys.length) {
      try {
        const jql = `key in (${jiraKeys.map((k) => `"${k}"`).join(',')})`;
        const jiraData = await jira.searchIssues({ jql, maxResults: jiraKeys.length });
        (jiraData.issues || []).forEach((issue) => {
          jiraStatusByKey.set(issue.key, issue.fields?.status?.name || 'Unknown');
        });
      } catch (e) {
        // If Jira is unreachable, we still show the findings, without the ticket status.
      }
    }

    const items = (findings.results || []).map((f) => {
      const product = f.related_fields?.test?.engagement?.product || {};
      const jiraKey = mapByFindingId.get(f.id) || null;
      return {
        id: f.id,
        title: f.title,
        severity: f.severity,
        cwe: f.cwe,
        component: f.component_name || f.related_fields?.test?.title || '',
        productId: product.id || null,
        productName: product.name || f.product_name || '-',
        reporterName: userById.get(f.reporter) || 'Unknown',
        active: f.active,
        verified: f.verified,
        jiraKey,
        jiraStatus: jiraKey ? jiraStatusByKey.get(jiraKey) || null : null,
      };
    });

    res.json({ count: findings.count ?? items.length, results: items });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/dashboard/vulnerabilities/:id
router.get('/vulnerabilities/:id', async (req, res) => {
  try {
    const finding = await dd.getFindingById(req.params.id);
    const mappings = await dd
      .getJiraFindingMappings({ finding: req.params.id })
      .catch(() => ({ results: [] }));

    const mapping = (mappings.results || [])[0];
    let jiraIssue = null;
    if (mapping?.jira_key) {
      try {
        const issue = await jira.getIssue(mapping.jira_key);
        jiraIssue = {
          key: issue.key,
          status: issue.fields?.status?.name,
          assignee: issue.fields?.assignee?.displayName || null,
          priority: issue.fields?.priority?.name || null,
          updated: issue.fields?.updated || null,
          url: `${process.env.JIRA_BASE_URL}/browse/${issue.key}`,
        };
      } catch (e) {
        jiraIssue = { key: mapping.jira_key, error: e.message };
      }
    }

    const productId = finding.related_fields?.test?.engagement?.product?.id || null;

    res.json({
      finding: {
        id: finding.id,
        title: finding.title,
        severity: finding.severity,
        cwe: finding.cwe,
        description: finding.description,
        // component_name is often absent (null) on findings coming from SCA scans
        component: finding.component_name || finding.related_fields?.test?.title || null,
        productId,
        productName: finding.related_fields?.test?.engagement?.product?.name || finding.product_name || '-',
        scanner: finding.related_fields?.test?.test_type?.name || null,
        active: finding.active,
        date: finding.date,
        url: `${process.env.DEFECTDOJO_BASE_URL}/finding/${finding.id}`,
      },
      jira: jiraIssue,
      suggestedJiraProject: productId ? await configStore.getMapping(productId) : null,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// POST /api/dashboard/vulnerabilities/:id/create-ticket
router.post('/vulnerabilities/:id/create-ticket', requirePermission('create_tickets'), async (req, res) => {
  try {
    const finding = await dd.getFindingById(req.params.id);
    const productId = finding.related_fields?.test?.engagement?.product?.id || null;
    const projectKey = req.body?.projectKey || (productId ? await configStore.getMapping(productId) : null);

    if (!projectKey) {
      return res.status(400).json({
        error: 'No Jira project mapped for this product yet. Set one in Integrations → Project mapping, or pass a projectKey.',
      });
    }

    const issue = await jira.createIssue({
      projectKey,
      summary: finding.title,
      description: finding.description,
      filePath: finding.file_path || null,
      line: finding.line || null,
      defectDojoUrl: `${process.env.DEFECTDOJO_BASE_URL}/finding/${finding.id}`,
      priorityName: SEVERITY_TO_PRIORITY[finding.severity] || null,
    });

    await dd.createJiraFindingMapping({ findingId: finding.id, jiraId: issue.id, jiraKey: issue.key }).catch(async (e) => {
      // The Jira ticket was created successfully even if writing the link back
      await configStore.addActivityLog('error', `Ticket ${issue.key} created but could not be linked back in DefectDojo: ${e.message}`);
    });

    await configStore.addActivityLog('ticket', `Created ${issue.key} in Jira for finding #${finding.id} (${finding.title.slice(0, 60)})`);

    res.json({ ok: true, jira: issue });
  } catch (e) {
    await configStore.addActivityLog('error', `Failed to create Jira ticket for finding #${req.params.id}: ${e.message}`);
    res.status(502).json({ error: e.message });
  }
});

// GET /api/dashboard/projects
router.get('/projects', async (req, res) => {
  try {
    const [products, activeFindings, allFindings, engagements] = await Promise.all([
      dd.getAllProducts(),
      dd.getAllFindings({ active: true }),
      dd.getAllFindings({ active: undefined }),
      dd.getAllEngagements().catch(() => ({ results: [] })),
    ]);

    const statsByProductId = new Map();
    (activeFindings.results || []).forEach((f) => {
      const product = f.related_fields?.test?.engagement?.product;
      if (!product) return;
      if (!statsByProductId.has(product.id)) {
        statsByProductId.set(product.id, { open: 0, critical: 0 });
      }
      const stat = statsByProductId.get(product.id);
      stat.open += 1;
      if (f.severity === 'Critical') stat.critical += 1;
    });

    // Real per-project "score": mitigated ÷ all findings ever recorded for that
    const totalsByProductId = new Map();
    (allFindings.results || []).forEach((f) => {
      const product = f.related_fields?.test?.engagement?.product;
      if (!product) return;
      if (!totalsByProductId.has(product.id)) {
        totalsByProductId.set(product.id, { total: 0, mitigated: 0 });
      }
      const t = totalsByProductId.get(product.id);
      t.total += 1;
      if (f.mitigated) t.mitigated += 1;
    });

    // Real "last scan" per project: the most recently updated DefectDojo engagement
    const lastEngagementByProductId = new Map();
    (engagements.results || []).forEach((e) => {
      const productId = e.product;
      if (!productId) return;
      const ts = e.updated || e.target_end || e.created || null;
      const existing = lastEngagementByProductId.get(productId);
      if (!existing || (ts && (!existing.ts || new Date(ts) > new Date(existing.ts)))) {
        lastEngagementByProductId.set(productId, { ts, status: e.status || null });
      }
    });

    const items = (products.results || []).map((p) => {
      const stat = statsByProductId.get(p.id) || { open: 0, critical: 0 };
      const totals = totalsByProductId.get(p.id) || { total: 0, mitigated: 0 };
      const lastScan = lastEngagementByProductId.get(p.id) || null;
      return {
        id: p.id,
        name: p.name,
        description: p.description || '',
        openFindings: stat.open,
        criticalFindings: stat.critical,
        resolutionRatePct: totals.total ? Math.round((totals.mitigated / totals.total) * 100) : null,
        lastScanDate: lastScan ? lastScan.ts : null,
        lastScanStatus: lastScan ? lastScan.status : null,
      };
    });

    res.json({ count: products.count ?? items.length, results: items });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/dashboard/trends
router.get('/trends', async (req, res) => {
  try {
    const activeFindings = await dd.getAllFindings({ active: true });
    const allFindings = await dd.getAllFindings({ active: undefined });
    const mappings = await dd.getAllJiraFindingMappings().catch(() => ({ results: [] }));

    const mapByFindingId = new Map();
    (mappings.results || []).forEach((m) => {
      const findingId = m.finding || m.finding_id;
      if (findingId) mapByFindingId.set(findingId, m.jira_key || m.jira_id);
    });

    const total = activeFindings.count ?? (activeFindings.results || []).length;
    const withoutTicket = (activeFindings.results || []).filter((f) => !mapByFindingId.has(f.id)).length;

    // Avg time to ticket / avg time to resolve, from real Jira issue dates.
    const jiraKeys = [...mapByFindingId.values()].filter(Boolean);
    let avgTimeToTicketDays = null;
    let avgTimeToResolveDays = null;
    if (jiraKeys.length) {
      try {
        const jql = `key in (${jiraKeys.map((k) => `"${k}"`).join(',')})`;
        const jiraData = await jira.searchIssues({ jql, maxResults: jiraKeys.length });
        const issueByKey = new Map((jiraData.issues || []).map((i) => [i.key, i]));

        const findingByJiraId = new Map();
        (mappings.results || []).forEach((m) => {
          const fid = m.finding || m.finding_id;
          if (m.jira_key) findingByJiraId.set(m.jira_key, fid);
        });
        const findingDateById = new Map((allFindings.results || []).map((f) => [f.id, f.date]));

        const ticketTimes = [];
        const resolveTimes = [];
        issueByKey.forEach((issue, key) => {
          const created = issue.fields?.created ? new Date(issue.fields.created) : null;
          const findingId = findingByJiraId.get(key);
          const foundDate = findingId ? findingDateById.get(findingId) : null;
          if (created && foundDate) {
            const days = (created - new Date(foundDate)) / (1000 * 60 * 60 * 24);
            if (days >= 0) ticketTimes.push(days);
          }
          const resolved = issue.fields?.resolutiondate ? new Date(issue.fields.resolutiondate) : null;
          if (created && resolved) {
            const days = (resolved - created) / (1000 * 60 * 60 * 24);
            if (days >= 0) resolveTimes.push(days);
          }
        });

        if (ticketTimes.length) avgTimeToTicketDays = ticketTimes.reduce((a, b) => a + b, 0) / ticketTimes.length;
        if (resolveTimes.length) avgTimeToResolveDays = resolveTimes.reduce((a, b) => a + b, 0) / resolveTimes.length;
      } catch (e) {
        // Jira unreachable: leave the two averages as null rather than guessing.
      }
    }

    const weeklySignal = computeWeeklySignal(allFindings.results || [], 52);

    // Average time-to-fix per product, from real date/mitigated pairs.
    const byProduct = new Map();
    (allFindings.results || []).forEach((f) => {
      if (!f.date || !f.mitigated) return;
      const product = f.related_fields?.test?.engagement?.product;
      if (!product) return;
      const days = (new Date(f.mitigated) - new Date(f.date)) / (1000 * 60 * 60 * 24);
      if (days < 0) return;
      if (!byProduct.has(product.name)) byProduct.set(product.name, []);
      byProduct.get(product.name).push(days);
    });
    const mttrByProject = [...byProduct.entries()]
      .map(([name, days]) => ({ name, avgDays: days.reduce((a, b) => a + b, 0) / days.length }))
      .sort((a, b) => b.avgDays - a.avgDays)
      .slice(0, 8);

    res.json({
      totalActiveFindings: total,
      findingsWithoutTicket: withoutTicket,
      autoCreatedTicketsPct: total ? Math.round(((total - withoutTicket) / total) * 100) : null,
      avgTimeToTicketDays,
      avgTimeToResolveDays,
      bySeverity: (() => {
        const acc = SEVERITY_ORDER.reduce((a, s) => ({ ...a, [s]: 0 }), {});
        (activeFindings.results || []).forEach((f) => {
          if (acc[f.severity] !== undefined) acc[f.severity] += 1;
        });
        return acc;
      })(),
      weeklySignal,
      mttrByProject,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// --- Project ↔ Jira project mapping (used by Integrations page) ---

// GET /api/dashboard/mapping
router.get('/mapping', async (req, res) => {
  try {
    const [products, jiraProjects] = await Promise.all([
      dd.getAllProducts(),
      jira.listProjects().catch(() => []),
    ]);
    const mappings = await configStore.getAllMappings();
    const items = (products.results || []).map((p) => ({
      productId: p.id,
      productName: p.name,
      jiraProjectKey: mappings[String(p.id)] || null,
    }));
    res.json({ items, jiraProjects });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// POST /api/dashboard/mapping  { productId, jiraProjectKey }
router.post('/mapping', requirePermission('manage_mappings'), async (req, res) => {
  const { productId, jiraProjectKey } = req.body || {};
  if (!productId || !jiraProjectKey) {
    return res.status(400).json({ error: 'productId and jiraProjectKey are required.' });
  }
  await configStore.setMapping(productId, jiraProjectKey);
  await configStore.addActivityLog('sync', `Mapped DefectDojo product #${productId} -> Jira project ${jiraProjectKey}`);
  res.json({ ok: true });
});

// DELETE /api/dashboard/mapping/:productId
router.delete('/mapping/:productId', requirePermission('manage_mappings'), async (req, res) => {
  await configStore.removeMapping(req.params.productId);
  await configStore.addActivityLog('sync', `Removed Jira mapping for DefectDojo product #${req.params.productId}`);
  res.json({ ok: true });
});

// --- Project -> tech stack (used by security-by-design.html to filter the
const VALID_STACKS = ['node', 'python', 'php', 'flutter'];

// GET /api/dashboard/stacks - { "<productId>": "node" | "python" | "php" | "flutter" }
router.get('/stacks', async (req, res) => {
  res.json({ stacks: await configStore.getAllStacks() });
});

// POST /api/dashboard/stacks  { productId, stack }  (stack: null/omit to clear)
router.post('/stacks', requirePermission('manage_mappings'), async (req, res) => {
  const { productId, stack } = req.body || {};
  if (!productId) {
    return res.status(400).json({ error: 'productId is required.' });
  }
  if (stack && !VALID_STACKS.includes(stack)) {
    return res.status(400).json({ error: `stack must be one of: ${VALID_STACKS.join(', ')} (or empty to clear).` });
  }
  await configStore.setStack(productId, stack || null);
  await configStore.addActivityLog(
    'sync',
    stack
      ? `Set stack for DefectDojo product #${productId} -> ${stack}`
      : `Cleared stack for DefectDojo product #${productId}`
  );
  res.json({ ok: true, stacks: await configStore.getAllStacks() });
});

// --- Security-by-design checklist, shared per project (see configStore.js) ---

// GET /api/dashboard/checklist?productId=X - { state: { "<itemId>": true, ... } }
router.get('/checklist', async (req, res) => {
  const { productId } = req.query;
  if (!productId) {
    return res.status(400).json({ error: 'productId query param is required.' });
  }
  res.json({ state: await configStore.getChecklistState(productId) });
});

// Personal (no-project) checklist - stored per user, server-side, so it persists
router.get('/checklist/personal', async (req, res) => {
  res.json({ state: await configStore.getPersonalChecklist(req.session.user.id) });
});

router.post('/checklist/personal', async (req, res) => {
  const { itemId, checked } = req.body || {};
  if (!itemId) return res.status(400).json({ error: 'itemId is required.' });
  const state = await configStore.setPersonalChecklistItem(req.session.user.id, itemId, !!checked);
  res.json({ ok: true, state });
});

router.post('/checklist/personal/reset', async (req, res) => {
  await configStore.resetPersonalChecklist(req.session.user.id);
  res.json({ ok: true });
});

// POST /api/dashboard/checklist  { productId, itemId, checked }
router.post('/checklist', requirePermission('manage_checklists'), async (req, res) => {
  const { productId, itemId, checked } = req.body || {};
  if (!productId || !itemId) {
    return res.status(400).json({ error: 'productId and itemId are required.' });
  }
  const state = await configStore.setChecklistItem(productId, itemId, !!checked);
  res.json({ ok: true, state });
});

// POST /api/dashboard/checklist/reset  { productId }
router.post('/checklist/reset', requirePermission('manage_checklists'), async (req, res) => {
  const { productId } = req.body || {};
  if (!productId) {
    return res.status(400).json({ error: 'productId is required.' });
  }
  await configStore.resetChecklistState(productId);
  await configStore.addActivityLog('sync', `Reset Security-by-design checklist for DefectDojo product #${productId}`);
  res.json({ ok: true });
});

// GET /api/dashboard/activity - real log of what this app actually did.
router.get('/activity', async (req, res) => {
  res.json({ items: await configStore.getActivityLog(10) });
});

module.exports = protectRouter(router);

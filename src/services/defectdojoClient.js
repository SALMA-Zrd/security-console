// Client for the DefectDojo API v2.
const fetch = require('node-fetch');

function getConfig() {
  const baseUrl = process.env.DEFECTDOJO_BASE_URL;
  const token = process.env.DEFECTDOJO_API_TOKEN;
  if (!baseUrl || !token) {
    throw new Error('DefectDojo not configured: DEFECTDOJO_BASE_URL and DEFECTDOJO_API_TOKEN must be set in .env');
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), token };
}

async function ddRequest(path, { method = 'GET', params, body } = {}) {
  const { baseUrl, token } = getConfig();
  const url = new URL(baseUrl + path);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Token ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    const err = new Error(`DefectDojo API responded ${res.status} ${res.statusText}: ${bodyText.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Verifies that the URL + token can actually reach the API (used by "Sync now" / connection test). */
async function testConnection() {
  // Real endpoint, already verified to work (used by projects.html) -
  const data = await ddRequest('/api/v2/products/', { params: { limit: 1 } });
  return { ok: true, user: `${data.count ?? 0} product(s) accessible` };
}

/** Findings, with simple pagination.
 *  `active` is deliberately NOT defaulted: pass `true`/`false` to filter, or
 *  leave it undefined to fetch ALL findings (active AND mitigated). A previous
 *  `active = true` default silently turned `active: undefined` into `true`,
 *  which excluded mitigated findings and made every "resolution rate" /
 *  "posture" / MTTR metric compute against active-only data (≈ 0 mitigated). */
async function getFindings({ limit = 100, offset = 0, active, severity } = {}) {
  return ddRequest('/api/v2/findings/', {
    params: { limit, offset, active, severity, o: '-severity', related_fields: true },
  });
}

// Safety cap for getAllPages: enough for a large instance (50k items at the
// default page size) without risking a runaway loop against a misbehaving or
// enormous DefectDojo instance. Aggregate metrics fall back to whatever was
// fetched so far rather than failing outright if the cap is hit.
const MAX_PAGES = 200;

/** Repeatedly calls `fetchPage({ limit, offset })` until every result has been
 *  collected (DefectDojo's `count` reached) or MAX_PAGES is hit, then returns
 *  the same { count, results } shape as a single page would. Use this for
 *  aggregate/metric endpoints that need the WHOLE dataset (e.g. resolution
 *  rate, MTTR, per-project stats) - NOT for UI-driven "give me page N" lists,
 *  which should keep passing their own limit/offset straight through. */
async function getAllPages(fetchPage, pageSize = 250) {
  let offset = 0;
  let count = null;
  const results = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchPage({ limit: pageSize, offset });
    count = typeof data.count === 'number' ? data.count : results.length + (data.results || []).length;
    results.push(...(data.results || []));
    offset += pageSize;
    if (!data.results || data.results.length < pageSize || results.length >= count) break;
  }
  return { count, results };
}

/** All findings matching the filter, across every page (see getAllPages). */
async function getAllFindings({ active, severity } = {}) {
  return getAllPages(({ limit, offset }) => getFindings({ limit, offset, active, severity }));
}

/** Finding <-> Jira ticket mapping table. */
async function getJiraFindingMappings({ limit = 200, offset = 0, finding } = {}) {
  return ddRequest('/api/v2/jira_finding_mappings/', { params: { limit, offset, finding } });
}

async function getAllJiraFindingMappings() {
  return getAllPages(({ limit, offset }) => getJiraFindingMappings({ limit, offset }));
}

/** Writes the finding <-> Jira ticket link back into DefectDojo itself, so the */
async function createJiraFindingMapping({ findingId, jiraId, jiraKey }) {
  return ddRequest('/api/v2/jira_finding_mappings/', {
    method: 'POST',
    body: { finding: findingId, jira_id: jiraId, jira_key: jiraKey },
  });
}

/** List of products (= "Projects" in the app). */
async function getProducts({ limit = 100, offset = 0 } = {}) {
  return ddRequest('/api/v2/products/', { params: { limit, offset } });
}

async function getAllProducts() {
  return getAllPages(({ limit, offset }) => getProducts({ limit, offset }));
}

/** DefectDojo users - used to resolve a finding's real `reporter` id into a */
async function getUsers({ limit = 200, offset = 0 } = {}) {
  return ddRequest('/api/v2/users/', { params: { limit, offset } });
}

async function getAllUsers() {
  return getAllPages(({ limit, offset }) => getUsers({ limit, offset }));
}

/** Engagement/product metrics used to build the trends. */
async function getEngagements({ limit = 100, offset = 0 } = {}) {
  return ddRequest('/api/v2/engagements/', { params: { limit, offset } });
}

async function getAllEngagements() {
  return getAllPages(({ limit, offset }) => getEngagements({ limit, offset }));
}

async function getFindingById(id) {
  return ddRequest(`/api/v2/findings/${id}/`, { params: { related_fields: true } });
}

module.exports = {
  testConnection,
  getFindings,
  getAllFindings,
  getProducts,
  getAllProducts,
  getUsers,
  getAllUsers,
  getEngagements,
  getAllEngagements,
  getFindingById,
  getJiraFindingMappings,
  getAllJiraFindingMappings,
  createJiraFindingMapping,
};

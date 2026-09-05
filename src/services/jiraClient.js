// Client pour l'API REST v3 de Jira Cloud.
const fetch = require('node-fetch');

function getConfig() {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) {
    throw new Error('Jira not configured: JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN must be set in .env');
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), email, token };
}

function authHeader() {
  const { email, token } = getConfig();
  const basic = Buffer.from(`${email}:${token}`).toString('base64');
  return `Basic ${basic}`;
}

async function jiraRequest(path, { method = 'GET', body } = {}) {
  const { baseUrl } = getConfig();
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    const err = new Error(`Jira API responded ${res.status} ${res.statusText}: ${bodyText.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Verifies that the URL + credentials can actually reach Jira. */
async function testConnection() {
  const data = await jiraRequest('/rest/api/3/myself');
  return { ok: true, user: data.displayName || data.emailAddress || 'connected' };
}

// Default fields fetched for each issue. Includes `created`/`resolutiondate`
// (used by the Trends metrics) and `assignee` (used by the finding detail page),
// which the previous version did not request.
const SEARCH_FIELDS = ['summary', 'status', 'priority', 'updated', 'project', 'created', 'resolutiondate', 'assignee'];

/** Searches security-related tickets (adapt the JQL to the real Jira project).
 *
 *  Uses Jira Cloud's enhanced-JQL endpoint POST /rest/api/3/search/jql. The old
 *  POST /rest/api/3/search was deprecated (Oct 2024) and removed by Atlassian
 *  in 2025 - it now returns "410 Gone" with a message to migrate here, which is
 *  what made every Jira call fail and surfaced as "Partial connection".
 *
 *  Contract differences handled below: the new endpoint is token-paginated
 *  (`nextPageToken` / `isLast`) and no longer returns a `total`. We page until
 *  we have `maxResults` issues (or run out) and return the SAME { issues, total }
 *  shape the callers already expect, so nothing downstream has to change. */
async function searchIssues({ jql = 'labels = security ORDER BY updated DESC', maxResults = 50, fields } = {}) {
  const wantFields = fields || SEARCH_FIELDS;
  const target = Math.max(1, Number(maxResults) || 50);
  const pageSize = Math.min(100, target); // the enhanced endpoint caps a page at 100
  const issues = [];
  let nextPageToken;

  do {
    const body = { jql, maxResults: pageSize, fields: wantFields };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const data = await jiraRequest('/rest/api/3/search/jql', { method: 'POST', body });
    issues.push(...(data.issues || []));
    nextPageToken = data.isLast ? undefined : data.nextPageToken;
  } while (nextPageToken && issues.length < target);

  const trimmed = issues.slice(0, target);
  // `total` is derived (the new API omits it); callers only use it as a count.
  return { issues: trimmed, total: trimmed.length, isLast: !nextPageToken };
}

async function getIssue(key) {
  return jiraRequest(`/rest/api/3/issue/${key}`);
}

/** Lists real Jira projects the account can see - used to populate the mapping form. */
async function listProjects() {
  const data = await jiraRequest('/rest/api/3/project/search?maxResults=100');
  return (data.values || []).map((p) => ({ key: p.key, name: p.name }));
}

// Cache per-project issue type name for a few minutes, since Jira project
// configuration rarely changes and this avoids one extra API call per ticket.
const issueTypeCache = new Map(); // projectKey -> { name, expiresAt }
const ISSUE_TYPE_CACHE_MS = 5 * 60 * 1000;

// Preferred issue type names, in order, tried against what the project actually
// offers (case-insensitive). Different Jira setups/locales name this
// differently (e.g. English "Task" vs French "Tâche"), and Jira's newer
// "team-managed" projects often only expose "Task"/"Story"/"Bug"/"Epic" without
// a classic "Task" at all - so we ask Jira what's really available instead of
// assuming a fixed name.
const PREFERRED_ISSUE_TYPES = ['task', 'tâche', 'bug', 'story', 'sous-tâche', 'subtask'];

async function resolveIssueTypeName(projectKey) {
  const cached = issueTypeCache.get(projectKey);
  if (cached && cached.expiresAt > Date.now()) return cached.name;

  const data = await jiraRequest(
    `/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&expand=projects.issuetypes`
  );
  const project = (data.projects || [])[0];
  const available = (project && project.issuetypes) || [];
  if (!available.length) {
    throw new Error(
      `Jira project ${projectKey} has no issue types available to this account (check permissions / project configuration).`
    );
  }

  // Exclude subtasks by default (they require a parent issue) unless nothing else exists.
  const nonSubtasks = available.filter((t) => !t.subtask);
  const pool = nonSubtasks.length ? nonSubtasks : available;

  let chosen = null;
  for (const preferred of PREFERRED_ISSUE_TYPES) {
    chosen = pool.find((t) => t.name.toLowerCase() === preferred);
    if (chosen) break;
  }
  if (!chosen) chosen = pool[0]; // fall back to whatever the project actually offers

  issueTypeCache.set(projectKey, { name: chosen.name, expiresAt: Date.now() + ISSUE_TYPE_CACHE_MS });
  return chosen.name;
}

// Parses a plain-text line for **bold** and [label](url) markdown into real
// ADF inline nodes (text + link/strong marks), instead of dumping raw markdown
// syntax as literal text - which is what made links like
// "[CVE-2022-23540](https://...)" show up un-clickable in Jira before this fix.
function parseInlineMarkdown(text) {
  const nodes = [];
  // Matches **bold** OR [label](url); processes whichever comes first, left to right.
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      nodes.push({ type: 'text', text: match[1], marks: [{ type: 'strong' }] });
    } else {
      nodes.push({ type: 'text', text: match[2], marks: [{ type: 'link', attrs: { href: match[3] } }] });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push({ type: 'text', text: text.slice(lastIndex) });
  return nodes.length ? nodes : [{ type: 'text', text }];
}

// Builds the full Atlassian Document Format body for a ticket: the finding's
// description (markdown-aware, one ADF paragraph per source line so links and
// bold render correctly), the file/line where the issue was found when
// DefectDojo reports one (many SCA/dependency findings don't have this - a
// missing file_path is normal, not a bug, and is simply omitted), and a real
// clickable link back to the finding in DefectDojo.
function buildDescriptionADF({ description, filePath, line, defectDojoUrl }) {
  const content = [];
  const lines = String(description || 'No description provided.')
    .split(/\n+/)
    .filter((l) => l.trim());
  for (const l of lines) {
    content.push({ type: 'paragraph', content: parseInlineMarkdown(l) });
  }
  if (filePath) {
    const loc = line ? `${filePath}:${line}` : filePath;
    content.push({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Location: ', marks: [{ type: 'strong' }] },
        { type: 'text', text: loc },
      ],
    });
  }
  if (defectDojoUrl) {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: 'View in DefectDojo', marks: [{ type: 'link', attrs: { href: defectDojoUrl } }] }],
    });
  }
  return { type: 'doc', version: 1, content };
}
async function createIssue({
  projectKey,
  summary,
  description,
  filePath,
  line,
  defectDojoUrl,
  priorityName,
  labels = ['security', 'defectdojo'],
}) {
  const issueTypeName = await resolveIssueTypeName(projectKey);
  const fields = {
    project: { key: projectKey },
    summary,
    description: buildDescriptionADF({ description, filePath, line, defectDojoUrl }),
    issuetype: { name: issueTypeName },
    labels,
  };
  // Optional: applies the Severity -> Priority mapping shown on the Integrations page.
  if (priorityName) fields.priority = { name: priorityName };

  const data = await jiraRequest('/rest/api/3/issue', { method: 'POST', body: { fields } });
  return { key: data.key, id: data.id, url: `${getConfig().baseUrl}/browse/${data.key}` };
}

module.exports = { testConnection, searchIssues, getIssue, listProjects, createIssue };

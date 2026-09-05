const SEVERITY_CLASS = {
  Critical: 'critical',
  High: 'high',
  Medium: 'medium',
  Low: 'low',
  Info: 'low',
};
const JIRA_CYCLE = ['All', 'Has ticket', 'No ticket'];

// Real 3-state status, derived from data we already have - not a new DefectDojo field:
const STATUS_META = {
  open: { label: 'Open', icon: 'ti-circle-dot', cls: 'open' },
  in_progress: { label: 'In progress', icon: 'ti-progress', cls: 'progress' },
  fixed: { label: 'Fixed', icon: 'ti-circle-check', cls: 'fixed' },
};
function computeStatus(item) {
  if (!item.active) return 'fixed';
  if (item.jiraKey) return 'in_progress';
  return 'open';
}

function initials(name) {
  if (!name) return '-';
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function renderRow(item) {
  const sevClass = SEVERITY_CLASS[item.severity] || 'low';
  const status = computeStatus(item);
  const meta = STATUS_META[status];

  let jiraCell;
  if (item.jiraKey) {
    const cls = item.jiraStatus && /done|resolved|closed/i.test(item.jiraStatus) ? 'linked' : 'progress';
    const icon = cls === 'linked' ? 'ti-circle-check' : 'ti-brand-jira';
    jiraCell = `<span class="jira ${cls}"><i class="ti ${icon}"></i>${escapeHtml(item.jiraKey)} · ${escapeHtml(item.jiraStatus || 'Unknown')}</span>`;
  } else {
    jiraCell = `<span class="jira none">No ticket</span>`;
  }

  return `
    <tr class="row" data-id="${item.id}" style="cursor:pointer;">
      <td><span class="sev ${sevClass}">${escapeHtml(item.severity)}</span></td>
      <td><span class="vuln-title">${escapeHtml(item.title)}</span><span class="vuln-cwe">${item.cwe ? 'CWE-' + escapeHtml(item.cwe) + ' · ' : ''}${escapeHtml(item.component || '')}</span></td>
      <td class="proj">${escapeHtml(item.productName)}</td>
      <td><span class="dd-status ${meta.cls}"><i class="ti ${meta.icon}"></i>${meta.label}</span></td>
      <td>${jiraCell}</td>
      <td><div class="avatar" title="${escapeHtml(item.reporterName)}">${escapeHtml(initials(item.reporterName))}</div></td>
    </tr>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  const tbody = document.querySelector('table tbody');
  const sumValues = document.querySelectorAll('.sum-val');
  const searchInput = document.getElementById('sv-search');
  const severityGroup = document.getElementById('sv-severity-group');
  const statusGroup = document.getElementById('sv-status-group');
  const projectChip = document.getElementById('sv-project-chip');
  const jiraChip = document.getElementById('sv-jira-chip');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--ink-faint);">Loading findings from DefectDojo…</td></tr>`;

  let allResults = [];
  let projectCycle = ['All projects'];
  const state = {
    search: '',
    severity: new URLSearchParams(window.location.search).get('severity') || 'All',
    status: new URLSearchParams(window.location.search).get('status') || 'All',
    project: 'All projects',
    jira: 'All',
  };
  const urlProductId = new URLSearchParams(window.location.search).get('product');

  function applyFilters() {
    let rows = allResults;
    if (state.severity !== 'All') rows = rows.filter((f) => f.severity === state.severity);
    if (state.status !== 'All') rows = rows.filter((f) => computeStatus(f) === state.status);
    if (state.project !== 'All projects') rows = rows.filter((f) => f.productName === state.project);
    if (state.jira === 'Has ticket') rows = rows.filter((f) => !!f.jiraKey);
    if (state.jira === 'No ticket') rows = rows.filter((f) => !f.jiraKey);
    if (state.search.trim()) {
      const q = state.search.trim().toLowerCase();
      rows = rows.filter(
        (f) =>
          (f.title || '').toLowerCase().includes(q) ||
          (f.component || '').toLowerCase().includes(q) ||
          String(f.cwe || '').toLowerCase().includes(q)
      );
    }

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--ink-faint);">No finding matches these filters.</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(renderRow).join('');
      tbody.querySelectorAll('tr[data-id]').forEach((row) => {
        row.addEventListener('click', () => {
          window.location.href = `/vulnerability-detail.html?id=${row.dataset.id}`;
        });
      });
    }

    severityGroup.querySelectorAll('.chip').forEach((chip) => {
      chip.classList.toggle('on', chip.dataset.sev === state.severity);
    });
    statusGroup.querySelectorAll('.chip').forEach((chip) => {
      chip.classList.toggle('on', chip.dataset.status === state.status);
    });
    projectChip.querySelector('span').textContent = state.project;
    projectChip.classList.toggle('on', state.project !== 'All projects');
    jiraChip.querySelector('span').textContent = state.jira === 'All' ? 'Jira status' : state.jira;
    jiraChip.classList.toggle('on', state.jira !== 'All');
  }

  severityGroup.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.severity = chip.dataset.sev;
    applyFilters();
  });
  statusGroup.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.status = chip.dataset.status;
    applyFilters();
  });
  projectChip.addEventListener('click', () => {
    const i = projectCycle.indexOf(state.project);
    state.project = projectCycle[(i + 1) % projectCycle.length];
    applyFilters();
  });
  jiraChip.addEventListener('click', () => {
    const i = JIRA_CYCLE.indexOf(state.jira);
    state.jira = JIRA_CYCLE[(i + 1) % JIRA_CYCLE.length];
    applyFilters();
  });
  searchInput.addEventListener('input', () => {
    state.search = searchInput.value;
    applyFilters();
  });

  const syncBtn = document.getElementById('sv-sync');

  // Loads (or reloads) the findings from DefectDojo and refreshes the table +
  // the three summary counters. Called once on page load, and again whenever
  // the user clicks "Sync now". This is a GET, so no CSRF token is involved.
  async function loadData({ isInitial = false } = {}) {
    let originalBtnHtml;
    if (syncBtn) {
      originalBtnHtml = syncBtn.innerHTML;
      syncBtn.disabled = true;
      syncBtn.innerHTML = '<i class="ti ti-loader-2"></i>Syncing…';
    }
    try {
      const data = await api('/api/dashboard/vulnerabilities');
      if (!data) return; // 401 redirect already handled by api()

      allResults = data.results || [];
      projectCycle = ['All projects', ...new Set(allResults.map((f) => f.productName).filter(Boolean))];

      // Coming from Projects with ?product=<id>: preset the filter to that
      // project's name - only on the initial load, so a manual re-sync never
      // overrides a filter the user has changed since.
      if (isInitial && urlProductId) {
        const match = allResults.find((f) => String(f.productId) === String(urlProductId));
        if (match) state.project = match.productName;
      }

      if (sumValues.length === 3) {
        const criticalNoTicket = allResults.filter((f) => f.severity === 'Critical' && !f.jiraKey).length;
        const inProgress = allResults.filter(
          (f) => f.jiraKey && f.jiraStatus && !/done|resolved|closed/i.test(f.jiraStatus)
        ).length;
        const resolved = allResults.filter(
          (f) => f.jiraKey && f.jiraStatus && /done|resolved|closed/i.test(f.jiraStatus)
        ).length;
        sumValues[0].textContent = criticalNoTicket;
        sumValues[1].textContent = inProgress;
        sumValues[2].textContent = resolved;
      }

      applyFilters();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--red-dark);">Could not load findings: ${escapeHtml(e.message)}</td></tr>`;
      // Without this, the three summary numbers above the table would keep a stale value.
      sumValues.forEach((el) => (el.textContent = '-'));
    } finally {
      if (syncBtn) {
        syncBtn.disabled = false;
        syncBtn.innerHTML = originalBtnHtml;
      }
    }
  }

  if (syncBtn) syncBtn.addEventListener('click', () => loadData());

  loadData({ isInitial: true });
});

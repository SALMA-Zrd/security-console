function riskLevel(criticalCount, openCount) {
  if (criticalCount > 0) return { cls: 'high', label: 'High risk' };
  if (openCount > 5) return { cls: 'medium', label: 'Medium risk' };
  if (openCount > 0) return { cls: 'low', label: 'Low risk' };
  return { cls: 'low', label: 'Clean' };
}

function fmtLastScan(dateStr, status) {
  if (!dateStr) return { label: 'No scan recorded', cls: 'none' };
  const d = new Date(dateStr);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const when = days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
  const statusLabel = status ? ` · ${status}` : '';
  return { label: `${when}${statusLabel}`, cls: status && /completed/i.test(status) ? 'ok' : 'pending' };
}

function renderCard(p) {
  const risk = riskLevel(p.criticalFindings, p.openFindings);
  const lastScan = fmtLastScan(p.lastScanDate, p.lastScanStatus);
  const scoreLabel = p.resolutionRatePct === null ? '-' : `${p.resolutionRatePct}%`;
  return `
    <div class="proj-card" data-id="${p.id}">
      <div class="proj-top">
        <div class="proj-icon"><i class="ti ti-git-branch"></i></div>
        <span class="risk-pill ${risk.cls}">${risk.label}</span>
      </div>
      <div>
        <p class="proj-name">${escapeHtml(p.name)}</p>
        <div class="proj-repo">${p.description ? escapeHtml(p.description.slice(0, 60)) : ''}</div>
      </div>
      <div class="proj-stats">
        <div class="pstat crit"><span>Critical</span><b>${p.criticalFindings}</b></div>
        <div class="pstat"><span>Open</span><b>${p.openFindings}</b></div>
        <div class="pstat" title="Mitigated ÷ all findings ever recorded for this project - real ratio, not a weighted score"><span>Score</span><b>${scoreLabel}</b></div>
      </div>
      <div class="proj-lastscan ${lastScan.cls}"><i class="ti ti-history"></i>Last assessment: ${lastScan.label}</div>
    </div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.querySelector('.grid');
  const searchInput = document.getElementById('project-search');
  if (!grid) return;

  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--ink-faint);">Loading products from DefectDojo…</div>`;

  let allResults = [];

  function renderFiltered() {
    const q = (searchInput?.value || '').trim().toLowerCase();
    const rows = q ? allResults.filter((p) => p.name.toLowerCase().includes(q)) : allResults;
    if (!rows.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--ink-faint);">No project matches "${escapeHtml(searchInput.value)}".</div>`;
      return;
    }
    grid.innerHTML = rows.map(renderCard).join('');
    grid.querySelectorAll('.proj-card').forEach((card) => {
      card.addEventListener('click', () => {
        window.location.href = `/vulnerabilities.html?product=${card.dataset.id}`;
      });
    });
  }

  if (searchInput) searchInput.addEventListener('input', renderFiltered);

  try {
    const data = await api('/api/dashboard/projects');
    if (!data) return;

    if (!data.results || data.results.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--ink-faint);">No product returned by DefectDojo.</div>`;
      return;
    }

    allResults = data.results;
    renderFiltered();
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--red-dark);">Could not load products: ${escapeHtml(e.message)}</div>`;
  }
});

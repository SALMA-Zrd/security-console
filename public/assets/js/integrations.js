document.addEventListener('DOMContentLoaded', () => {
  const cards = document.querySelectorAll('.conn-card');
  const cardConfigs = [
    { endpoint: '/api/defectdojo/test', name: 'DefectDojo' },
    { endpoint: '/api/jira/test', name: 'Jira' },
  ];

  // Runs a real connection test and updates the card's status pill, "Last
  // sync" and "Credentials" rows. Used both automatically on page load (so the
  // card never shows a stale "Connected" state that doesn't reflect reality)
  async function runTest(card, config, btn) {
    const statusPill = card.querySelector('.status-pill');
    const lastSyncRow = card.querySelector('[data-row="last-sync"] span:last-child');
    const credsRow = card.querySelector('[data-row="credentials"] span:last-child');

    try {
      const result = await api(config.endpoint, { method: 'POST' });
      if (statusPill) {
        statusPill.textContent = 'Connected';
        statusPill.style.background = '';
        statusPill.style.color = '';
      }
      if (lastSyncRow) lastSyncRow.textContent = 'just now';
      if (credsRow) { credsRow.textContent = 'Valid'; credsRow.style.color = ''; }
      if (btn) btn.innerHTML = `<i class="ti ti-check"></i>${config.name} OK (${escapeHtml(result.user || 'connected')})`;
      return true;
    } catch (e) {
      if (statusPill) {
        statusPill.textContent = 'Error';
        statusPill.style.background = '#FCE3DA';
        statusPill.style.color = '#B31E1A';
      }
      if (lastSyncRow) lastSyncRow.textContent = 'Never';
      if (credsRow) { credsRow.textContent = 'Invalid or unreachable'; credsRow.style.color = 'var(--red-dark)'; }
      if (btn) {
        btn.innerHTML = `<i class="ti ti-alert-triangle"></i>Failed`;
        console.error(`${config.name} test failed:`, e.message);
      }
      return false;
    }
  }

  cards.forEach((card, i) => {
    const config = cardConfigs[i];
    if (!config) return;

    const btn = card.querySelector('.btn-ghost');
    const statusPill = card.querySelector('.status-pill');

    // Real status on load - no more hardcoded "Connected" that ignores reality.
    if (statusPill) {
      statusPill.textContent = 'Checking…';
      statusPill.style.background = '';
      statusPill.style.color = '';
    }
    runTest(card, config, null).then(() => loadActivity());

    if (!btn) return;
    btn.addEventListener('click', async () => {
      const originalHtml = btn.innerHTML;
      btn.innerHTML = '<i class="ti ti-loader-2"></i>Testing…';
      btn.disabled = true;

      const ok = await runTest(card, config, btn);
      if (!ok) alert(`Could not connect to ${config.name}. See the card for details.`);
      loadActivity();

      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }, 2500);
    });
  });

  // --- Project mapping: real, editable per row ---
  async function loadMapping() {
    const tbody = document.getElementById('mapping-tbody');
    const ddCount = document.querySelector('[data-count="dd-products"]');
    const jiraCount = document.querySelector('[data-count="jira-projects"]');
    if (!tbody) return;
    try {
      const data = await api('/api/dashboard/mapping');
      if (!data) return;

      // Real linked counts, replacing the old hardcoded "6 of 6" / "4 of 6".
      if (ddCount) {
        const mapped = data.items.filter((i) => i.jiraProjectKey).length;
        ddCount.textContent = `${mapped} of ${data.items.length}`;
      }
      if (jiraCount) {
        const usedKeys = new Set(data.items.map((i) => i.jiraProjectKey).filter(Boolean));
        jiraCount.textContent = `${usedKeys.size} of ${data.jiraProjects.length}`;
      }

      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--ink-faint);">No DefectDojo product found.</td></tr>`;
        return;
      }
      tbody.innerHTML = data.items
        .map((item) => {
          const options = ['<option value="">Not mapped</option>']
            .concat(
              data.jiraProjects.map(
                (p) =>
                  `<option value="${escapeHtml(p.key)}" ${p.key === item.jiraProjectKey ? 'selected' : ''}>${escapeHtml(p.key)} - ${escapeHtml(p.name)}</option>`
              )
            )
            .join('');
          const status = item.jiraProjectKey
            ? '<span class="status-pill" style="display:inline-flex;">Active</span>'
            : '<span style="color:var(--ink-faint);">Not mapped</span>';
          return `
            <tr data-product-id="${item.productId}">
              <td>${escapeHtml(item.productName)}</td>
              <td class="map-arrow"><i class="ti ti-arrow-right"></i></td>
              <td><select class="map-select" data-product-id="${item.productId}">${options}</select></td>
              <td class="map-status">${status}</td>
            </tr>`;
        })
        .join('');

      // Read-only unless the user can manage mappings: show but disable editing.
      const meINT = await api('/api/auth/me');
      const permsINT = meINT && meINT.user && Array.isArray(meINT.user.permissions) ? meINT.user.permissions : [];
      if (!permsINT.includes('manage_mappings')) {
        tbody.querySelectorAll('.map-select').forEach((s) => (s.disabled = true));
        return;
      }

      tbody.querySelectorAll('.map-select').forEach((select) => {
        select.addEventListener('change', async () => {
          const productId = select.dataset.productId;
          const jiraProjectKey = select.value;
          const statusCell = select.closest('tr').querySelector('.map-status');
          try {
            if (jiraProjectKey) {
              await api('/api/dashboard/mapping', {
                method: 'POST',
                body: JSON.stringify({ productId, jiraProjectKey }),
              });
              statusCell.innerHTML = '<span class="status-pill" style="display:inline-flex;">Active</span>';
            } else {
              await api(`/api/dashboard/mapping/${productId}`, { method: 'DELETE' });
              statusCell.innerHTML = '<span style="color:var(--ink-faint);">Not mapped</span>';
            }
            loadActivity();
          } catch (e) {
            alert(`Could not save mapping: ${e.message}`);
          }
        });
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--red-dark);">Could not load mapping: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  // --- Sync activity: real log of what this app did ---
  async function loadActivity() {
    const log = document.getElementById('activity-log');
    if (!log) return;
    try {
      const data = await api('/api/dashboard/activity');
      if (!data) return;
      if (!data.items.length) {
        log.innerHTML = `<div class="log-row"><div class="log-text" style="color:var(--ink-faint);">No activity yet - test a connection or create a ticket to see it appear here.</div></div>`;
        return;
      }
      const dotClass = { sync: 'ok', ticket: 'ok', error: 'error', connection: 'ok', disconnect: 'warn' };
      log.innerHTML = data.items
        .map(
          (item) => `
        <div class="log-row">
          <div class="log-dot ${dotClass[item.type] || 'ok'}"></div>
          <div class="log-text">${escapeHtml(item.message)}</div>
          <div class="log-time">${escapeHtml(timeAgo(item.timestamp))}</div>
        </div>`
        )
        .join('');
    } catch (e) {
      log.innerHTML = `<div class="log-row"><div class="log-text" style="color:var(--red-dark);">Could not load activity: ${escapeHtml(e.message)}</div></div>`;
    }
  }

  function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  loadMapping();
  loadActivity();
});

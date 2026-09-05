function initials(email) {
  if (!email) return '-';
  return email.slice(0, 2).toUpperCase();
}

document.addEventListener('DOMContentLoaded', async () => {
  const accountRow = document.getElementById('account-row');
  const disconnectBtn = document.getElementById('disconnect-btn');
  const disconnectLabel = document.getElementById('disconnect-label');
  const disconnectDesc = document.getElementById('disconnect-desc');

  // --- Sub-nav: click-to-scroll AND scrollspy (highlight follows scroll position,
  const subnavLinks = document.querySelectorAll('#settings-subnav a');
  let scrollSpySuspended = false;

  subnavLinks.forEach((link) => {
    link.addEventListener('click', () => {
      subnavLinks.forEach((a) => a.classList.remove('on'));
      link.classList.add('on');
      const target = document.getElementById(link.dataset.target);
      if (!target) return;
      // Ignore scrollspy for the duration of the smooth-scroll triggered by
      scrollSpySuspended = true;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => (scrollSpySuspended = false), 700);
    });
  });

  const sectionIds = Array.from(subnavLinks).map((a) => a.dataset.target);
  const observer = new IntersectionObserver(
    (entries) => {
      if (scrollSpySuspended) return;
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const link = document.querySelector(`#settings-subnav a[data-target="${entry.target.id}"]`);
        if (!link) return;
        subnavLinks.forEach((a) => a.classList.remove('on'));
        link.classList.add('on');
      });
    },
    // Triggers when a section's top crosses a band near the top of the viewport -
    { rootMargin: '-15% 0px -70% 0px', threshold: 0 }
  );
  sectionIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });

  function renderAccount(account) {
    accountRow.innerHTML = `
      <div class="person">
        <div class="avatar">${escapeHtml(initials(account.email))}</div>
        <div><b>${escapeHtml(account.email)}</b><span>${account.viaGoogle ? 'Signed in with Google' : 'Signed in with password'}</span></div>
      </div>
      <span class="role-chip">Admin</span>
    `;
    updateDisconnectUI(account.integrationsEnabled);
  }

  function updateDisconnectUI(enabled) {
    if (enabled) {
      disconnectLabel.textContent = 'Disconnect DefectDojo & Jira';
      disconnectDesc.textContent = 'Stops all syncing. Existing data stays, nothing new comes in.';
      disconnectBtn.textContent = 'Disconnect';
      disconnectBtn.classList.add('btn-danger');
    } else {
      disconnectLabel.textContent = 'DefectDojo & Jira are disconnected';
      disconnectDesc.textContent = 'No live data is being fetched. Reconnect to resume syncing.';
      disconnectBtn.textContent = 'Reconnect';
      disconnectBtn.classList.remove('btn-danger');
    }
  }

  try {
    const account = await api('/api/settings/account');
    if (!account) return;
    renderAccount(account);

    document.getElementById('settings-dd-url').textContent = account.defectdojoUrl || 'Not configured';
    document.getElementById('settings-jira-url').textContent = account.jiraUrl || 'Not configured';

    async function checkConnection(endpoint, statusEl) {
      if (!account.integrationsEnabled) {
        statusEl.textContent = 'Disconnected';
        return;
      }
      try {
        await api(endpoint, { method: 'POST' });
        statusEl.textContent = 'Connected';
      } catch (e) {
        statusEl.textContent = 'Error';
        statusEl.title = e.message;
      }
    }
    checkConnection('/api/defectdojo/test', document.getElementById('settings-dd-status'));
    checkConnection('/api/jira/test', document.getElementById('settings-jira-status'));
  } catch (e) {
    accountRow.innerHTML = `<div class="person"><div><b style="color:var(--red-dark);">Could not load account: ${escapeHtml(e.message)}</b></div></div>`;
  }

  disconnectBtn.addEventListener('click', async () => {
    const currentlyEnabled = disconnectBtn.textContent.trim() === 'Disconnect';
    const action = currentlyEnabled ? 'disconnect' : 'reconnect';
    if (currentlyEnabled && !confirm('Disconnect DefectDojo & Jira? Live data will stop loading until you reconnect.')) return;

    disconnectBtn.disabled = true;
    try {
      const result = await api('/api/settings/integrations', {
        method: 'POST',
        body: JSON.stringify({ enabled: !currentlyEnabled }),
      });
      if (!result) return;
      updateDisconnectUI(result.integrationsEnabled);
    } catch (e) {
      alert(`Could not ${action}: ${e.message}`);
    } finally {
      disconnectBtn.disabled = false;
    }
  });
});

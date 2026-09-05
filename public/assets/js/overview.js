// --- Custom hover tooltip for the "Signal over time" bar chart ---
function createChartTooltip() {
  let el = document.getElementById('sc-chart-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sc-chart-tooltip';
    el.className = 'sc-tooltip';
    document.body.appendChild(el);
  }
  return el;
}

function attachBarTooltips(bars, weeklySignal) {
  const tooltip = createChartTooltip();

  const showTooltip = (bar, week) => {
    tooltip.innerHTML = `
      <div style="margin-bottom:4px;"><b>${week.label}</b></div>
      <div class="sc-tooltip-row"><span class="sc-tooltip-dot" style="background:#E64525;"></span>${week.opened} finding${week.opened === 1 ? '' : 's'} opened</div>
      <div class="sc-tooltip-row"><span class="sc-tooltip-dot" style="background:#1F4A85;"></span>${week.closed} finding${week.closed === 1 ? '' : 's'} closed</div>
    `;
    const rect = bar.getBoundingClientRect();
    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.top - 10}px`;
    tooltip.classList.add('show');
  };
  const hideTooltip = () => tooltip.classList.remove('show');

  bars.forEach((bar, i) => {
    const week = weeklySignal[i];
    if (!week) return;
    // Native title removed in favor of the styled tooltip above (avoids the
    bar.removeAttribute('title');
    bar.addEventListener('mouseenter', () => showTooltip(bar, week));
    bar.addEventListener('mousemove', () => showTooltip(bar, week));
    bar.addEventListener('mouseleave', hideTooltip);
    bar.addEventListener('focus', () => showTooltip(bar, week));
    bar.addEventListener('blur', hideTooltip);
    bar.setAttribute('tabindex', '0');
    bar.setAttribute('role', 'img');
    bar.setAttribute(
      'aria-label',
      `${week.label}: ${week.opened} finding${week.opened === 1 ? '' : 's'} opened, ${week.closed} finding${week.closed === 1 ? '' : 's'} closed`
    );
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Connection-status pill: hidden by default (no more "Demo mode" placeholder).
  const statusPill = document.getElementById('connection-status-pill');
  const kpiValues = document.querySelectorAll('.kpi-value');
  const kpiFoots = document.querySelectorAll('.kpi-foot');

  const investigateBtn = document.querySelector('.alert-btn');
  if (investigateBtn) investigateBtn.addEventListener('click', () => (window.location.href = '/vulnerabilities.html?severity=Critical'));
  const reviewBtn = document.querySelector('.btn-primary');
  if (reviewBtn) reviewBtn.addEventListener('click', () => (window.location.href = '/vulnerabilities.html'));
  const viewReportLink = document.getElementById('view-report-link');
  if (viewReportLink) viewReportLink.addEventListener('click', () => (window.location.href = '/trends.html'));

  // "Last sync" refresh control: re-fetch the whole overview by reloading the
  // page (every panel is populated from a single GET below, so a reload is the
  // simplest correct refresh and involves no CSRF token).
  const ovSync = document.getElementById('ov-sync');
  if (ovSync) {
    const doRefresh = () => window.location.reload();
    ovSync.addEventListener('click', doRefresh);
    ovSync.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        doRefresh();
      }
    });
  }

  // --- Real connected-account indicator (was a decorative, always-empty bell icon) ---
  api('/api/settings/account')
    .then((account) => {
      if (!account) return;
      const avatar = document.getElementById('user-avatar');
      const greeting = document.getElementById('overview-greeting');
      if (avatar) {
        const initialsSource = account.name || account.email;
        avatar.textContent = initialsSource.slice(0, 2).toUpperCase();
        avatar.title = account.name ? `${account.name} (${account.email})` : account.email;
        // Was onclick="window.location.href='/settings.html'" inline, both to
        // drop the CSP unsafe-inline exception and because Settings is now
        // admin-only (see server.js) - Profile is the account page every role
        // can reach.
        avatar.style.cursor = 'pointer';
        avatar.addEventListener('click', () => (window.location.href = '/profile.html'));
      }
      if (greeting) {
        const h = new Date().getHours();
        const word = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
        greeting.textContent = `${word}, ${account.name || account.email.split('@')[0]}`;
      }
    })
    .catch(() => {});

  try {
    const data = await api('/api/dashboard/overview');
    if (!data) return; // 401 redirect already handled by api()

    if (statusPill) {
      if (data.errors && data.errors.length) {
        statusPill.textContent = 'Partial connection';
        statusPill.title = data.errors.map((e) => `${e.source}: ${e.message}`).join(' / ');
        statusPill.classList.add('show');
      } else {
        statusPill.classList.remove('show');
      }
    }

    // Existing card order: Open findings, Projects, Posture score, Last sync
    if (kpiValues[0]) kpiValues[0].textContent = data.kpis.openFindings;
    if (kpiFoots[0]) kpiFoots[0].innerHTML = `<b>${data.kpis.criticalFindings} critical</b> need attention`;

    if (kpiValues[1]) kpiValues[1].textContent = data.kpis.projects;
    if (kpiFoots[1]) kpiFoots[1].textContent = `${data.kpis.projectsAtRisk} currently at risk`;

    // Resolution rate: real ratio (mitigated ÷ all findings ever recorded), not a
    const resPct = data.kpis.resolutionRatePct;
    if (kpiValues[2]) kpiValues[2].textContent = resPct === null ? '-' : `${resPct}%`;
    if (kpiFoots[2]) {
      kpiFoots[2].textContent =
        resPct === null
          ? 'no findings recorded yet'
          : `${data.kpis.resolutionMitigatedCount} of ${data.kpis.resolutionTotalCount} findings resolved`;
      kpiFoots[2].className = 'kpi-foot';
    }

    if (kpiValues[3]) kpiValues[3].textContent = '-';
    if (kpiFoots[3]) kpiFoots[3].textContent = `Synced ${new Date(data.generatedAt).toLocaleString('en-US')}`;

    // --- Alert strip: real critical count, real number of projects affected,
    const alertStrip = document.getElementById('alert-strip');
    if (alertStrip) {
      if (data.kpis.criticalFindings > 0) {
        alertStrip.style.display = '';
        const n = data.kpis.criticalFindings;
        const p = data.kpis.criticalProjectsCount;
        document.getElementById('alert-title').textContent =
          `${n} critical finding${n > 1 ? 's' : ''} ${n > 1 ? 'are' : 'is'} exposed right now`;
        const ageText =
          data.kpis.oldestCriticalDays !== null
            ? `Open for up to ${data.kpis.oldestCriticalDays} day${data.kpis.oldestCriticalDays !== 1 ? 's' : ''}`
            : 'Open now';
        document.getElementById('alert-subtitle').textContent =
          `${ageText} across ${p} project${p > 1 ? 's' : ''} - act before the next scan.`;
      } else {
        alertStrip.style.display = 'none';
      }
    }

    // --- Security posture gauge: resolution rate of Critical + High findings
    const posturePct = data.kpis.postureScorePct;
    const gaugeNum = document.querySelector('.gauge-num');
    if (gaugeNum) gaugeNum.textContent = posturePct === null ? '-' : posturePct;
    const arc = document.getElementById('score-arc');
    if (arc) {
      const circumference = 389.5;
      const offset = circumference - ((posturePct || 0) / 100) * circumference;
      arc.setAttribute('stroke-dashoffset', String(offset));
    }
    const postureCopy = document.getElementById('posture-copy');
    if (postureCopy) {
      postureCopy.textContent =
        posturePct === null
          ? 'No Critical or High findings recorded yet.'
          : `${data.kpis.postureResolvedCount} of ${data.kpis.postureTotalCount} Critical & High findings have been resolved.`;
    }

    // --- Signal over time: real weekly opened/closed counts from DefectDojo's own dates ---
    const bars = document.querySelectorAll('#signal-bars .bar');
    const labels = document.querySelectorAll('#signal-labels span');
    const signal = data.weeklySignal || [];
    const maxVal = Math.max(1, ...signal.map((w) => Math.max(w.opened, w.closed)));
    signal.forEach((w, i) => {
      if (!bars[i]) return;
      const heightPct = Math.max(4, Math.round((w.opened / maxVal) * 100));
      bars[i].style.height = `${heightPct}%`;
      bars[i].classList.toggle('filled', w.closed >= w.opened);
      if (labels[i]) labels[i].textContent = w.label;
    });
    attachBarTooltips(Array.from(bars), signal);

    const headline = document.getElementById('signal-headline');
    if (headline && data.signalSummary) {
      const { openedLast2, closedLast2 } = data.signalSummary;
      if (openedLast2 === 0 && closedLast2 === 0) {
        headline.textContent = 'No new findings opened or closed in the last 2 weeks';
      } else if (closedLast2 >= openedLast2) {
        headline.textContent = `Findings are moving down (${closedLast2} closed vs ${openedLast2} opened, last 2 weeks)`;
      } else {
        headline.textContent = `Findings are moving up (${openedLast2} opened vs ${closedLast2} closed, last 2 weeks)`;
      }
    }

    if (data.errors && data.errors.length) {
      console.warn('Some sources are partially unavailable:', data.errors);
    }
  } catch (e) {
    if (statusPill) {
      statusPill.textContent = 'Connection error';
      statusPill.title = e.message;
      statusPill.classList.add('show');
    }
    document.querySelectorAll('.kpi-value').forEach((el) => (el.textContent = '-'));
    document.querySelectorAll('.kpi-foot').forEach((el) => (el.textContent = 'Unavailable'));
    console.error('Could not load live dashboard:', e);
  }
});

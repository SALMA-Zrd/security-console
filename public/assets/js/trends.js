function fmtDays(n) {
  if (n === null || n === undefined) return '-';
  return `${n.toFixed(1)}d`;
}

// --- Shared styled tooltip for the line-chart markers and the donut segments ---
function getChartTooltip() {
  let el = document.getElementById('sc-chart-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sc-chart-tooltip';
    el.className = 'sc-tooltip';
    document.body.appendChild(el);
  }
  return el;
}
function showChartTooltip(html, x, y) {
  const tooltip = getChartTooltip();
  tooltip.innerHTML = html;
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
  tooltip.classList.add('show');
}
function hideChartTooltip() {
  getChartTooltip().classList.remove('show');
}

function renderChart(weeks) {
  const w = 560;
  const h = 190;
  const maxVal = Math.max(1, ...weeks.map((wk) => Math.max(wk.opened, wk.closed)));
  const step = weeks.length > 1 ? w / (weeks.length - 1) : w;
  const y = (v) => h - (v / maxVal) * (h - 10) - 5;

  const openedPts = weeks.map((wk, i) => `${(i * step).toFixed(1)},${y(wk.opened).toFixed(1)}`).join(' ');
  const closedPts = weeks.map((wk, i) => `${(i * step).toFixed(1)},${y(wk.closed).toFixed(1)}`).join(' ');

  document.getElementById('opened-line').setAttribute('points', openedPts);
  document.getElementById('closed-line').setAttribute('points', closedPts);

  // Visible dots at each data point (purely visual now - hover is handled by the
  const markers = document.getElementById('chart-markers');
  const ns = 'http://www.w3.org/2000/svg';
  markers.innerHTML = '';
  weeks.forEach((wk, i) => {
    const x = (i * step).toFixed(1);
    [
      { val: wk.opened, color: '#E64525' },
      { val: wk.closed, color: '#1F4A85' },
    ].forEach(({ val, color }) => {
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y(val).toFixed(1));
      circle.setAttribute('r', '3.5');
      circle.setAttribute('fill', color);
      circle.setAttribute('class', 'chart-marker');
      circle.setAttribute('pointer-events', 'none'); // hover lives on the band, not the dot
      markers.appendChild(circle);
    });
  });

  // Real, exact values on hover/tap - one wide band per week, covering the full
  const bandsGroup = document.getElementById('chart-hover-bands');
  bandsGroup.innerHTML = '';
  const bandWidth = weeks.length > 1 ? step : w;
  weeks.forEach((wk, i) => {
    const cx = i * step;
    const bandX = Math.max(0, cx - bandWidth / 2);
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', bandX.toFixed(1));
    rect.setAttribute('y', '0');
    rect.setAttribute('width', bandWidth.toFixed(1));
    rect.setAttribute('height', String(h));
    rect.setAttribute('fill', 'transparent');
    rect.setAttribute('class', 'chart-hover-band');

    const openedDot = markers.children[i * 2];
    const closedDot = markers.children[i * 2 + 1];

    const showTip = () => {
      openedDot.setAttribute('r', '5');
      closedDot.setAttribute('r', '5');
      const bandBox = rect.getBoundingClientRect();
      showChartTooltip(
        `<div style="margin-bottom:4px;"><b>${wk.label}</b></div>
         <div class="sc-tooltip-row"><span class="sc-tooltip-dot" style="background:#E64525;"></span>Opened: <b>${wk.opened}</b></div>
         <div class="sc-tooltip-row"><span class="sc-tooltip-dot" style="background:#1F4A85;"></span>Closed: <b>${wk.closed}</b></div>`,
        bandBox.left + bandBox.width / 2,
        bandBox.top - 6
      );
    };
    const hideTip = () => {
      openedDot.setAttribute('r', '3.5');
      closedDot.setAttribute('r', '3.5');
      hideChartTooltip();
    };
    rect.addEventListener('mouseenter', showTip);
    rect.addEventListener('mousemove', showTip);
    rect.addEventListener('mouseleave', hideTip);
    rect.addEventListener('focus', showTip);
    rect.addEventListener('blur', hideTip);
    rect.setAttribute('tabindex', '0');
    rect.setAttribute('role', 'img');
    rect.setAttribute('aria-label', `${wk.label} - Opened: ${wk.opened}, Closed: ${wk.closed}`);
    bandsGroup.appendChild(rect);
  });

  const axis = document.getElementById('chart-axis-labels');
  const labelCount = Math.min(6, weeks.length);
  const pickEvery = Math.max(1, Math.floor(weeks.length / labelCount));
  axis.innerHTML = weeks
    .filter((_, i) => i % pickEvery === 0)
    .map((wk) => `<span>${wk.label}</span>`)
    .join('');
}

function renderDonut(bySeverity) {
  const total = Object.values(bySeverity).reduce((a, b) => a + b, 0) || 1;
  const circumference = 289;
  let offset = 0;
  const order = [
    ['Critical', 'donut-critical', 'dl-critical'],
    ['High', 'donut-high', 'dl-high'],
    ['Medium', 'donut-medium', 'dl-medium'],
    ['Low', 'donut-low', 'dl-low'],
  ];
  order.forEach(([key, circleId, labelId]) => {
    const count = bySeverity[key] || 0;
    const frac = count / total;
    const dash = frac * circumference;
    const circle = document.getElementById(circleId);
    if (circle) {
      circle.setAttribute('stroke-dasharray', `${dash} ${circumference}`);
      circle.setAttribute('stroke-dashoffset', String(-offset));
      const pct = Math.round(frac * 100);
      const dotColor = circle.getAttribute('stroke');
      const showTip = (evt) => {
        showChartTooltip(
          `<div class="sc-tooltip-row"><span class="sc-tooltip-dot" style="background:${dotColor};"></span><b>${key}</b>: ${count} finding${count === 1 ? '' : 's'} (${pct}%)</div>`,
          evt.clientX,
          evt.clientY - 16
        );
      };
      circle.addEventListener('mouseenter', showTip);
      circle.addEventListener('mousemove', showTip);
      circle.addEventListener('mouseleave', hideChartTooltip);
    }
    const label = document.getElementById(labelId);
    if (label) label.textContent = count;
    offset += dash;
  });
}

function renderMttrBars(mttrByProject) {
  const container = document.getElementById('mttr-bars');
  if (!mttrByProject.length) {
    container.innerHTML = `<div style="text-align:center;padding:16px;color:var(--ink-faint);">No project has both an opened and a fixed finding yet - nothing to average.</div>`;
    return;
  }
  const maxVal = Math.max(...mttrByProject.map((p) => p.avgDays));
  const colors = ['#E64525,#B31E1A', '#E64525,#B31E1A', '#C97B1F,#8A5411', 'var(--navy-500)', 'var(--sage-dark)', 'var(--sage-dark)'];
  container.innerHTML = mttrByProject
    .map((p, i) => {
      const pct = Math.max(4, Math.round((p.avgDays / maxVal) * 100));
      const grad = colors[i] && colors[i].includes(',') ? `linear-gradient(90deg,${colors[i]})` : colors[i] || 'var(--sage-dark)';
      return `<div class="bar-row-item"><div class="bar-row-label">${escapeHtml(p.name)}</div><div class="bar-row-track"><div class="bar-row-fill" style="width:${pct}%;background:${grad};"></div></div><div class="bar-row-val">${escapeHtml(fmtDays(p.avgDays))}</div></div>`;
    })
    .join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  const kpiCards = document.querySelectorAll('.kpi-grid .kpi');

  let fullWeeklySignal = [];

  function applyRange(weeksCount) {
    const slice = fullWeeklySignal.slice(-weeksCount);
    renderChart(slice);
    const label = document.getElementById('chart-range-label');
    if (label) label.textContent = `Weekly, last ${weeksCount} week${weeksCount > 1 ? 's' : ''}`;
  }

  document.querySelectorAll('#range-selector span').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('#range-selector span').forEach((s) => s.classList.remove('on'));
      el.classList.add('on');
      applyRange(Number(el.dataset.weeks));
    });
  });

  try {
    const data = await api('/api/dashboard/trends');
    if (!data) return;

    document.getElementById('kpi-time-to-ticket').textContent = fmtDays(data.avgTimeToTicketDays);
    document.getElementById('kpi-time-to-ticket-foot').textContent =
      data.avgTimeToTicketDays === null ? 'no ticketed finding yet' : 'from real finding + Jira dates';

    document.getElementById('kpi-time-to-resolve').textContent = fmtDays(data.avgTimeToResolveDays);
    document.getElementById('kpi-time-to-resolve-foot').textContent =
      data.avgTimeToResolveDays === null ? 'no resolved ticket yet' : 'from real Jira ticket dates';

    if (kpiCards[2]) {
      kpiCards[2].querySelector('.kpi-value').textContent = data.findingsWithoutTicket;
      kpiCards[2].querySelector('.kpi-foot').textContent = `out of ${data.totalActiveFindings} active findings`;
    }
    if (kpiCards[3] && data.autoCreatedTicketsPct !== null) {
      kpiCards[3].querySelector('.kpi-value').textContent = `${data.autoCreatedTicketsPct}%`;
      kpiCards[3].querySelector('.kpi-foot').textContent = 'findings with a linked Jira ticket';
    }

    fullWeeklySignal = data.weeklySignal || [];
    applyRange(12);

    renderDonut(data.bySeverity || {});
    renderMttrBars(data.mttrByProject || []);
  } catch (e) {
    console.error('Could not load live trends:', e.message);
  }
});

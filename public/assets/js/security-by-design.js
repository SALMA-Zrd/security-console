// Filters the "5.x" tech-stack modules of the Security-by-design checklist

// Moved out of an inline <script> block in security-by-design.html so the
// page's CSP no longer needs 'unsafe-inline' for scripts. Plain top-level
// function declarations, so they stay globally callable from the
// addEventListener-based onclick replacements in the HTML.
function switchTab(tab) {
  document.querySelectorAll('.sbd-tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
  document.getElementById('panel-dev').classList.toggle('on', tab === 'dev');
  document.getElementById('panel-gh').classList.toggle('on', tab === 'gh');
}
function toggleSection(el) { el.classList.toggle('open'); }

function updateCounts() {
  let totalChecked = 0, totalItems = 0;
  document.querySelectorAll('.sbd-section').forEach((section) => {
    const sid = section.dataset.sectionId;
    const boxes = section.querySelectorAll('input[type=checkbox]');
    const checked = section.querySelectorAll('input[type=checkbox]:checked').length;
    const countEl = section.querySelector(`[data-count-for="${sid}"]`);
    if (countEl) countEl.textContent = `${checked}/${boxes.length}`;
    // A stack module hidden by the project/stack filter (see below) doesn't
    // count towards the overall progress total, so the "X / Y checked"
    // summary matches what's actually visible/relevant right now.
    if (section.style.display === 'none') return;
    totalChecked += checked; totalItems += boxes.length;
  });
  const fill = document.getElementById('global-progress-fill');
  const label = document.getElementById('global-progress-label');
  const pct = totalItems ? Math.round((totalChecked / totalItems) * 100) : 0;
  if (fill) fill.style.width = pct + '%';
  if (label) label.textContent = `${totalChecked} / ${totalItems} checked`;
}

// Wire up what used to be onclick="" attributes in the HTML (tabs, section
// toggles, reset button), now that inline event-handler attributes are
// blocked by the CSP (script-src-attr no longer allows 'unsafe-inline').
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.sbd-tab[data-tab]').forEach((el) => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });
  document.querySelectorAll('.sbd-section-head').forEach((el) => {
    el.addEventListener('click', () => toggleSection(el.parentElement));
  });
  const resetBtn = document.querySelector('.sbd-reset');
  if (resetBtn) resetBtn.addEventListener('click', () => resetChecklist());
});

const STACK_TO_SECTION_ID = {
  node: 'dev-5-1',
  python: 'dev-5-2',
  php: 'dev-5-3',
  flutter: 'dev-5-4',
};

const STACK_LABELS = {
  node: 'Node.js / JavaScript / TypeScript',
  python: 'Python',
  php: 'PHP / Laravel',
  flutter: 'Flutter / Dart',
};

const LAST_PROJECT_KEY = 'sbd-selected-project-id';

// --- Checklist state ---

let currentProjectId = '';

function applyChecklistState(state) {
  document.querySelectorAll('input[type=checkbox][data-item-id]').forEach((cb) => {
    const checked = !!state[cb.dataset.itemId];
    cb.checked = checked;
    cb.closest('.sbd-item').classList.toggle('checked', checked);
  });
  if (typeof updateCounts === 'function') updateCounts();
}

async function loadChecklistForProject(productId) {
  const url = productId
    ? `/api/dashboard/checklist?productId=${encodeURIComponent(productId)}`
    : '/api/dashboard/checklist/personal';
  try {
    const res = await api(url);
    return (res && res.state) || {};
  } catch (e) {
    console.error('Could not load the checklist state:', e.message);
    return {};
  }
}

async function switchChecklistProject(productId) {
  currentProjectId = productId;
  const scopeNote = document.getElementById('sbd-scope-note');
  if (scopeNote) {
    scopeNote.textContent = productId
      ? 'Shared with everyone for this project'
      : 'Saved to your account (private) - select a project to share progress with everyone';
  }
  applyChecklistState(await loadChecklistForProject(productId));
}

async function persistChecklistItem(itemId, checked) {
  const url = currentProjectId ? '/api/dashboard/checklist' : '/api/dashboard/checklist/personal';
  const body = currentProjectId ? { productId: currentProjectId, itemId, checked } : { itemId, checked };
  try {
    await api(url, { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    console.error('Could not save this checklist item:', e.message);
  }
}

// Global on purpose: called from the "Reset" button's onclick="" in the HTML.
async function resetChecklist() {
  const scopeMsg = currentProjectId
    ? 'Uncheck every item for this project? This is shared - it resets it for everyone.'
    : 'Uncheck every item on your personal checklist?';
  if (!confirm(scopeMsg)) return;
  const url = currentProjectId ? '/api/dashboard/checklist/reset' : '/api/dashboard/checklist/personal/reset';
  const body = currentProjectId ? { productId: currentProjectId } : {};
  try {
    await api(url, { method: 'POST', body: JSON.stringify(body) });
    applyChecklistState({});
  } catch (e) {
    alert(`Could not reset the checklist: ${e.message}`);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const projectSelect = document.getElementById('sbd-project-select');
  const stackSelect = document.getElementById('sbd-stack-select');
  const stackSelectLabel = document.getElementById('sbd-stack-select-label');
  const stackChip = document.getElementById('sbd-stack-chip');
  const stackChipText = document.getElementById('sbd-stack-chip-text');
  const clearFilterEl = document.getElementById('sbd-clear-filter');
  const hintEl = document.getElementById('sbd-project-hint');
  if (!projectSelect) return; // not on this page

  // Viewers get a read-only checklist (server also rejects writes).
  const meSBD = await api('/api/auth/me');
  const permsSBD = meSBD && meSBD.user && Array.isArray(meSBD.user.permissions) ? meSBD.user.permissions : [];
  const sbdReadOnly = !permsSBD.includes('manage_checklists');

  document.querySelectorAll('input[type=checkbox][data-item-id]').forEach((cb) => {
    if (sbdReadOnly) { cb.disabled = true; return; }
    cb.addEventListener('change', () => {
      cb.closest('.sbd-item').classList.toggle('checked', cb.checked);
      if (typeof updateCounts === 'function') updateCounts();
      persistChecklistItem(cb.dataset.itemId, cb.checked);
    });
  });
  // Baseline: local (no-project) state, shown immediately. If a project gets
  switchChecklistProject('');

  let stacks = {}; // { productId: 'node' | 'python' | 'php' | 'flutter' }

  /** Shows only the stack module matching `stack`; shows all four when `stack` is falsy. */
  function applyStackFilter(stack) {
    Object.entries(STACK_TO_SECTION_ID).forEach(([key, sectionId]) => {
      const section = document.querySelector(`.sbd-section[data-section-id="${sectionId}"]`);
      if (!section) return;
      section.style.display = !stack || key === stack ? '' : 'none';
    });
    if (typeof updateCounts === 'function') updateCounts();
  }

  function setUiForProject(productId) {
    const stack = productId ? stacks[String(productId)] : null;
    switchChecklistProject(productId); // async, fire-and-forget: swaps in the right state

    if (!productId) {
      // No project selected: unfiltered checklist, as before.
      stackSelect.style.display = 'none';
      stackSelectLabel.style.display = 'none';
      stackChip.classList.remove('show');
      clearFilterEl.classList.remove('show');
      hintEl.style.display = '';
      applyStackFilter(null);
      return;
    }

    hintEl.style.display = 'none';

    if (stack) {
      // Known stack: filter silently, show a chip + a way to change it.
      stackSelect.style.display = '';
      stackSelectLabel.style.display = '';
      stackSelect.value = stack;
      stackChip.classList.add('show');
      stackChipText.textContent = `Showing: ${STACK_LABELS[stack]}`;
      clearFilterEl.classList.add('show');
      applyStackFilter(stack);
    } else {
      // Project has no stack configured yet: ask once, persist the answer.
      stackSelect.style.display = '';
      stackSelectLabel.style.display = '';
      stackSelect.value = '';
      stackChip.classList.remove('show');
      clearFilterEl.classList.remove('show');
      applyStackFilter(null);
    }
  }

  projectSelect.addEventListener('change', () => {
    const productId = projectSelect.value;
    localStorage.setItem(LAST_PROJECT_KEY, productId || '');
    setUiForProject(productId);
  });

  stackSelect.addEventListener('change', async () => {
    const productId = projectSelect.value;
    const stack = stackSelect.value;
    if (!productId) return;
    try {
      await api('/api/dashboard/stacks', { method: 'POST', body: JSON.stringify({ productId, stack: stack || null }) });
      stacks[String(productId)] = stack || undefined;
      setUiForProject(productId);
    } catch (e) {
      console.error('Could not save the stack for this project:', e.message);
    }
  });

  clearFilterEl.addEventListener('click', () => {
    projectSelect.value = '';
    localStorage.setItem(LAST_PROJECT_KEY, '');
    setUiForProject('');
  });

  try {
    const [projectsData, stacksData] = await Promise.all([
      api('/api/dashboard/projects'),
      api('/api/dashboard/stacks'),
    ]);

    if (stacksData) stacks = stacksData.stacks || {};

    if (projectsData) {
      (projectsData.results || [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name;
          projectSelect.appendChild(opt);
        });

      // Restore the last project selected on this page, if it still exists.
      const lastId = localStorage.getItem(LAST_PROJECT_KEY);
      if (lastId && projectSelect.querySelector(`option[value="${lastId}"]`)) {
        projectSelect.value = lastId;
        setUiForProject(lastId);
      }
    }
  } catch (e) {
    // DefectDojo unreachable / integrations disconnected: keep the picker usable
    projectSelect.disabled = true;
    hintEl.textContent = 'Project list unavailable right now (DefectDojo not reachable) - showing the unfiltered checklist.';
    console.error('Could not load projects for the stack filter:', e.message);
  }
});

// Admin page: manage users (assign role, delete) and roles (create custom roles
document.addEventListener('DOMContentLoaded', () => {
  const usersBody = document.getElementById('users-body');
  const rolesPanel = document.getElementById('roles-panel');
  let meId = null;
  let roles = [];
  let permissions = [];

  function flash(msg, ok) {
    const el = document.getElementById('admin-flash');
    el.textContent = msg;
    el.style.display = 'block';
    el.style.background = ok ? '#E3F5EA' : '#FCE3DA';
    el.style.color = ok ? '#1B7A43' : '#B31E1A';
    clearTimeout(flash._t);
    flash._t = setTimeout(() => (el.style.display = 'none'), 4000);
  }

  // ---------- Users ----------
  function roleOptions(current) {
    return roles
      .map((r) => `<option value="${escapeHtml(r.name)}" ${r.name === current ? 'selected' : ''}>${escapeHtml(r.label)}</option>`)
      .join('');
  }

  function userRow(u) {
    const you = u.id === meId ? ' <span class="tag">you</span>' : '';
    const how = u.viaGoogle ? 'Google' : 'Password';
    const verified = u.emailVerified
      ? '<span class="tag ok">verified</span>'
      : '<span class="tag warn">unverified</span>';
    const roleCell =
      u.id === meId
        ? `<select class="role-select" data-id="${escapeHtml(u.id)}" disabled>${roleOptions(u.role)}</select>`
        : `<select class="role-select" data-id="${escapeHtml(u.id)}">${roleOptions(u.role)}</select>`;
    const del =
      u.id === meId
        ? '<span class="u-self">-</span>'
        : `<button class="btn-del" data-del="${escapeHtml(u.id)}"><i class="ti ti-trash"></i> Delete</button>`;
    return `
      <tr>
        <td><div class="u-cell"><div class="u-avatar">${escapeHtml((u.email || '?').slice(0, 2).toUpperCase())}</div>
          <div><b>${escapeHtml(u.email)}</b>${you}<span class="u-sub">${escapeHtml(u.name || how)} · ${verified}</span></div></div></td>
        <td>${roleCell}</td>
        <td class="u-how">${escapeHtml(how)}</td>
        <td class="u-actions"><button class="btn-save" data-save="${escapeHtml(u.id)}">Save role</button></td>
        <td class="u-delete">${del}</td>
      </tr>`;
  }

  async function loadUsers() {
    try {
      const data = await api('/api/admin/users');
      if (!data) return;
      meId = data.me;
      roles = data.roles || [];
      usersBody.innerHTML = data.users.length
        ? data.users.map(userRow).join('')
        : `<tr><td colspan="5" class="u-empty">No users yet.</td></tr>`;
    } catch (e) {
      usersBody.innerHTML = `<tr><td colspan="5" class="u-empty" style="color:var(--red-dark);">Could not load users: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  usersBody.addEventListener('click', async (e) => {
    const save = e.target.closest('[data-save]');
    const del = e.target.closest('[data-del]');
    if (save) {
      const id = save.getAttribute('data-save');
      const sel = usersBody.querySelector(`.role-select[data-id="${CSS.escape(id)}"]`);
      if (!sel) return;
      try {
        if (!sel.disabled) {
          await api(`/api/admin/users/${encodeURIComponent(id)}/role`, {
            method: 'POST',
            body: JSON.stringify({ role: sel.value }),
          });
        }
        flash('Saved.', true);
        await loadUsers();
        await loadAudit();
      } catch (err) {
        flash(err.message || 'Could not save.', false);
        loadUsers();
      }
    } else if (del) {
      const id = del.getAttribute('data-del');
      if (!confirm('Delete this user? This cannot be undone.')) return;
      try {
        await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
        flash('User deleted.', true);
        loadUsers();
        loadAudit();
      } catch (err) {
        flash(err.message || 'Could not delete user.', false);
      }
    }
  });

  // ---------- Roles & permissions ----------
  function permMatrix(selected, idPrefix) {
    return permissions
      .map(
        (p) => `<label class="perm"><input type="checkbox" value="${escapeHtml(p.key)}"
        ${selected.includes(p.key) ? 'checked' : ''} ${idPrefix ? `data-perm="${escapeHtml(idPrefix)}"` : ''}>
        <span>${escapeHtml(p.label)}</span></label>`
      )
      .join('');
  }

  function roleCard(r) {
    const chips = r.permissions
      .map((k) => `<span class="chip">${escapeHtml((permissions.find((p) => p.key === k) || {}).label || k)}</span>`)
      .join('');
    const actions = r.builtin
      ? '<span class="tag">built-in</span>'
      : `<button class="btn-del" data-delrole="${escapeHtml(r.name)}"><i class="ti ti-trash"></i> Delete</button>`;
    return `<div class="role-card">
      <div class="role-head"><b>${escapeHtml(r.label)}</b> <span class="role-id">${escapeHtml(r.name)}</span>${r.builtin ? '' : ''}</div>
      <div class="role-perms">${chips || '<span class="u-sub">no permissions</span>'}</div>
      <div class="role-actions">${actions}</div>
    </div>`;
  }

  async function loadRoles() {
    try {
      const data = await api('/api/admin/roles');
      if (!data) return;
      permissions = data.permissions || [];
      roles = data.roles || roles;
      rolesPanel.innerHTML = `
        <div class="panel-head"><div>
          <div class="panel-title">Roles &amp; permissions</div>
          <div class="panel-desc">Built-in roles can't be changed. Create custom roles with exactly the permissions you want; assign them to users above.</div>
        </div></div>
        <div class="roles-grid">${roles.map(roleCard).join('')}</div>
        <div class="role-create">
          <div class="panel-title" style="font-size:14px;margin-top:6px;">Create a new role</div>
          <div class="rc-fields">
            <input id="rc-name" class="rc-input" placeholder="id (e.g. auditor)" maxlength="32">
            <input id="rc-label" class="rc-input" placeholder="Label (e.g. Read-only auditor)" maxlength="60">
          </div>
          <div class="perm-grid">${permMatrix([], 'new')}</div>
          <button class="btn-save" id="rc-create">Create role</button>
        </div>`;
    } catch (e) {
      rolesPanel.innerHTML = `<div class="u-empty" style="color:var(--red-dark);">Could not load roles: ${escapeHtml(e.message)}</div>`;
    }
  }

  rolesPanel.addEventListener('click', async (e) => {
    const delRole = e.target.closest('[data-delrole]');
    if (delRole) {
      const name = delRole.getAttribute('data-delrole');
      if (!confirm(`Delete the "${name}" role?`)) return;
      try {
        await api(`/api/admin/roles/${encodeURIComponent(name)}`, { method: 'DELETE' });
        flash('Role deleted.', true);
        await loadRoles();
        await loadUsers();
        await loadAudit();
      } catch (err) {
        flash(err.message || 'Could not delete role.', false);
      }
      return;
    }
    if (e.target.id === 'rc-create') {
      const name = document.getElementById('rc-name').value.trim();
      const label = document.getElementById('rc-label').value.trim();
      const perms = Array.from(rolesPanel.querySelectorAll('.perm-grid input[type=checkbox]:checked')).map((c) => c.value);
      try {
        await api('/api/admin/roles', { method: 'POST', body: JSON.stringify({ name, label, permissions: perms }) });
        flash('Role created.', true);
        await loadRoles();
        await loadUsers();
        await loadAudit();
      } catch (err) {
        flash(err.message || 'Could not create role.', false);
      }
    }
  });

  // ---------- Email delivery ----------
  async function loadEmail() {
    const panel = document.getElementById('email-panel');
    if (!panel) return;
    let configured = false;
    let via = null;
    try {
      const st = await api('/api/admin/email-status');
      configured = !!(st && st.configured);
      via = st && st.via;
    } catch (e) { /* ignore */ }
    const viaLabel = via === 'resend' ? 'Resend API' : via === 'smtp' ? 'SMTP' : '';
    const badge = configured
      ? `<span class="tag ok">${escapeHtml(viaLabel)} configured</span>`
      : '<span class="tag warn">Email not configured</span>';
    panel.innerHTML = `
      <div class="panel-head"><div>
        <div class="panel-title">Email delivery ${badge}</div>
        <div class="panel-desc">Verification and invitation emails are sent via the Resend API (recommended - works even when a host blocks outbound SMTP) if <code>RESEND_API_KEY</code> is set, otherwise via SMTP if configured. Without either, links are written to the server logs. Send yourself a test to check.</div>
      </div></div>
      <div class="rc-fields">
        <input id="test-email-to" class="rc-input" type="email" placeholder="recipient (defaults to your email)">
        <button class="btn-save" id="test-email-send">Send test email</button>
      </div>
      <div id="test-email-result" style="display:none;margin-top:10px;font-size:12.5px;"></div>`;
  }

  const emailPanel = document.getElementById('email-panel');
  if (emailPanel) {
    emailPanel.addEventListener('click', async (e) => {
      if (e.target.id !== 'test-email-send') return;
      const to = document.getElementById('test-email-to').value.trim();
      const box = document.getElementById('test-email-result');
      try {
        const r = await api('/api/admin/test-email', { method: 'POST', body: JSON.stringify(to ? { to } : {}) });
        box.style.display = 'block';
        box.style.color = 'var(--green-dark, #1B7A43)';
        box.textContent = (r && r.message) || 'Test email sent.';
      } catch (err) {
        box.style.display = 'block';
        box.style.color = 'var(--red-dark)';
        box.textContent = err.message || 'Could not send the test email.';
      }
    });
  }

  // ---------- Invite ----------
  function renderInvite() {
    const panel = document.getElementById('invite-panel');
    if (!panel) return;
    const opts = roles.map((r) => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.label)}</option>`).join('');
    panel.innerHTML = `
      <div class="panel-head"><div>
        <div class="panel-title">Invite a user</div>
        <div class="panel-desc">Create an account and send an activation link - the invitee sets their own password. Without an email server, the link is shown here to share manually.</div>
      </div></div>
      <div class="rc-fields">
        <input id="inv-email" class="rc-input" type="email" placeholder="person@company.com">
        <select id="inv-role" class="role-select">${opts}</select>
        <button class="btn-save" id="inv-send">Send invite</button>
      </div>
      <div id="inv-link" style="display:none;margin-top:12px;font-size:12.5px;color:var(--ink-soft);"></div>`;
  }

  async function sendInvite() {
    const email = document.getElementById('inv-email').value.trim();
    const role = document.getElementById('inv-role').value;
    try {
      const r = await api('/api/admin/invite', { method: 'POST', body: JSON.stringify({ email, role }) });
      flash('Invitation created.', true);
      const box = document.getElementById('inv-link');
      if (r && r.inviteLink) {
        box.style.display = 'block';
        box.innerHTML = 'No email server configured - share this activation link:<br><code style="word-break:break-all;background:var(--paper-2);padding:2px 6px;border-radius:6px;">' + escapeHtml(r.inviteLink) + '</code>';
      } else {
        box.style.display = 'block';
        box.textContent = 'Invitation email sent.';
      }
      document.getElementById('inv-email').value = '';
      await loadUsers();
      await loadAudit();
    } catch (e) {
      flash(e.message || 'Could not create the invitation.', false);
    }
  }

  // ---------- Audit log ----------
  const ACTION_LABELS = {
    role_changed: 'Role changed',
    user_deleted: 'User deleted',
    user_invited: 'User invited',
    role_created: 'Role created',
    role_deleted: 'Role deleted',
  };
  async function loadAudit() {
    const panel = document.getElementById('audit-panel');
    if (!panel) return;
    try {
      const data = await api('/api/admin/audit');
      const rows = (data.entries || [])
        .map(
          (en) => `<tr>
            <td class="u-how">${escapeHtml(new Date(en.timestamp).toLocaleString())}</td>
            <td><b>${escapeHtml(ACTION_LABELS[en.action] || en.action)}</b></td>
            <td>${escapeHtml(en.actorEmail || '-')}</td>
            <td>${escapeHtml(en.targetEmail || en.details || '')}</td></tr>`
        )
        .join('');
      panel.innerHTML = `
        <div class="panel-head"><div>
          <div class="panel-title">Audit log</div>
          <div class="panel-desc">Recent sensitive actions - role changes, deletions and invitations.</div>
        </div></div>
        <table class="users-table">
          <thead><tr><th>When</th><th>Action</th><th>By</th><th>Target / details</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="u-empty">No activity yet.</td></tr>'}</tbody>
        </table>`;
    } catch (e) {
      panel.innerHTML = `<div class="u-empty" style="color:var(--red-dark);">Could not load audit log: ${escapeHtml(e.message)}</div>`;
    }
  }

  const invitePanel = document.getElementById('invite-panel');
  if (invitePanel) {
    invitePanel.addEventListener('click', (e) => {
      if (e.target.id === 'inv-send') sendInvite();
    });
  }

  (async () => {
    await loadEmail();
    await loadRoles();
    await loadUsers();
    renderInvite();
    await loadAudit();
  })();
});

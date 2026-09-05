// Makes the sidebar clickable on every page, injects role-aware extras
(function () {
  const ROUTES = {
    Overview: '/overview.html',
    Projects: '/projects.html',
    Vulnerabilities: '/vulnerabilities.html',
    Trends: '/trends.html',
    'Security by design': '/security-by-design.html',
    Integrations: '/integrations.html',
    Settings: '/settings.html',
    Admin: '/admin.html',
    Profile: '/profile.html',
  };

  function wireStaticItems() {
    document.querySelectorAll('nav .nav-item').forEach((el) => {
      const label = el.textContent.trim();
      const href = ROUTES[label];
      if (!href) return;
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        window.location.href = href;
      });
    });
  }

  function attachLogout(el) {
    el.addEventListener('click', async () => {
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } catch (e) {
        /* ignore - log out client-side regardless */
      }
      window.location.href = '/login.html';
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    wireStaticItems();

    // Any pre-existing [data-logout] element (if a page added one) still works.
    document.querySelectorAll('[data-logout]').forEach(attachLogout);

    const navEl = document.querySelector('nav');

    // Profile link - available to every signed-in user.
    if (navEl && !navEl.querySelector('[data-profile-link]')) {
      const prof = document.createElement('div');
      prof.className = 'nav-item';
      prof.setAttribute('data-profile-link', '');
      prof.style.cursor = 'pointer';
      prof.innerHTML = '<i class="ti ti-user-circle"></i>Profile';
      prof.addEventListener('click', () => (window.location.href = '/profile.html'));
      navEl.appendChild(prof);
    }

    // Role-aware extras. /api/auth/me returns the current account (incl. role).
    try {
      const me = await api('/api/auth/me');
      const perms = me && me.user && Array.isArray(me.user.permissions) ? me.user.permissions : [];

      // Hide sidebar entries the role can't reach, so navigation matches the
      // server-side page guards (see server.js). Integrations needs
      // "manage_mappings"; Settings needs "toggle_integrations". Read-only
      // viewers therefore see neither.
      const pageNeeds = { Integrations: 'manage_mappings', Settings: 'toggle_integrations' };
      document.querySelectorAll('nav .nav-item').forEach((el) => {
        const need = pageNeeds[el.textContent.trim()];
        if (need && !perms.includes(need)) el.remove();
      });

      // Identity block at the top of the sidebar - the display name, when set,
      // was previously saved but never shown anywhere in the app (only the
      // Profile page's own input field). This makes a saved name actually
      // visible on every authenticated page, falling back to the email.
      if (navEl && me && me.user && !navEl.querySelector('[data-identity]')) {
        const idBlock = document.createElement('div');
        idBlock.className = 'nav-item';
        idBlock.setAttribute('data-identity', '');
        idBlock.style.cssText = 'font-weight:600;cursor:default;';
        idBlock.innerHTML = `<i class="ti ti-user-circle"></i>${escapeHtml(me.user.name || me.user.email)}`;
        idBlock.title = me.user.email;
        // Static display only — navigating to the profile is handled by the
        // "Profile" nav item below, to avoid two links doing the same thing.
        navEl.insertBefore(idBlock, navEl.firstChild);
      }

      // Admin link - only for users who can manage users/roles.
      if (navEl && perms.includes('manage_users') && !navEl.querySelector('[data-admin-link]')) {
        const item = document.createElement('div');
        item.className = 'nav-item';
        item.setAttribute('data-admin-link', '');
        item.style.cursor = 'pointer';
        item.innerHTML = '<i class="ti ti-users"></i>Admin';
        item.addEventListener('click', () => (window.location.href = '/admin.html'));
        navEl.appendChild(item);
      }
    } catch (e) {
      /* not logged in or /me failed - the page guard already handles redirects */
    }

    // Inject a Log out button into the sidebar nav if none exists yet, so it's
    if (navEl && !document.querySelector('[data-logout]')) {
      const out = document.createElement('div');
      out.className = 'nav-item';
      out.setAttribute('data-logout', '');
      out.style.cursor = 'pointer';
      out.innerHTML = '<i class="ti ti-logout"></i>Log out';
      navEl.appendChild(out);
      attachLogout(out);
    }
  });
})();

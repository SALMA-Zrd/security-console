function greetingWord() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

document.addEventListener('DOMContentLoaded', async () => {
  // Real greeting (uses the actual signed-in account), everything else here
  try {
    const account = await api('/api/settings/account');
    if (account) {
      const name = account.email.split('@')[0];
      document.getElementById('greeting-text').textContent = `${greetingWord()}, ${name}`;
    }
  } catch (e) {
    // Not fatal: the page is just a transition, it still redirects below.
  }

  setTimeout(() => {
    window.location.href = '/overview.html';
  }, 1800);
});

(() => {
  'use strict';

  const DEV_ACCOUNT_KEY = 'tabaja_card_designer_account_dev_v10';
  const APP_ACCOUNT_KEY = 'tabaja_card_designer_account_v10';

  function readCompanyId() {
    for (const key of [DEV_ACCOUNT_KEY, APP_ACCOUNT_KEY]) {
      try {
        const account = JSON.parse(localStorage.getItem(key) || 'null');
        const id = account?.companyId || account?.id || null;
        if (id) return id;
      } catch (_) {}
    }
    return null;
  }

  function hide(link) {
    link.hidden = true;
    link.style.display = 'none';
  }

  function show(link) {
    link.hidden = false;
    link.style.display = '';
  }

  async function isEnabled(client, companyId) {
    // Preferred path: protected server-side entitlement function.
    try {
      const { data, error } = await client.rpc('wf_is_enabled', {
        target_company: companyId
      });
      if (!error) return data === true;
      console.warn('[Workforce Launcher] wf_is_enabled RPC:', error.message);
    } catch (error) {
      console.warn('[Workforce Launcher] wf_is_enabled RPC failed:', error);
    }

    // Compatibility fallback if the project exposes entitlement SELECT.
    try {
      const { data, error } = await client
        .from('wf_company_entitlements')
        .select('enabled')
        .eq('company_id', companyId)
        .maybeSingle();
      if (error) throw error;
      return data?.enabled === true;
    } catch (error) {
      console.warn('[Workforce Launcher] entitlement fallback failed:', error);
      return false;
    }
  }


  function installNoFlashOpen(link) {
    if (!link || link.dataset.wfNoFlashBound === '1') return;
    link.dataset.wfNoFlashBound = '1';

    // Capture the click before the Identity shell's SPA navigation handler sees it.
    // This keeps the already-rendered Command Center untouched underneath Workforce.
    link.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

      try {
        const opened = window.open(link.href, 'tabaja-workforce');
        if (opened) {
          opened.focus();
          return;
        }
      } catch (_) {}

      // Only if the host blocks a separate window do we fall back to same-window navigation.
      window.location.assign(link.href);
    }, true);
  }

  async function sync() {
    const link = document.getElementById('workforceNavLink');
    if (!link) return;
    installNoFlashOpen(link);
    hide(link);

    try {
      if (!window.TabajaCloud?.getClient) return;
      const client = window.TabajaCloud.getClient();
      if (!client) return;

      const session = await window.TabajaCloud.getSession();
      if (!session?.user?.id) return;

      let companyId = readCompanyId();
      if (!companyId) {
        const workspace = await window.TabajaCloud.loadWorkspace(session.user.id);
        companyId = workspace?.companyId || null;
      }
      if (!companyId) return;

      if (await isEnabled(client, companyId)) show(link);
    } catch (error) {
      console.warn('[Workforce Launcher] unable to sync navigation:', error);
    }
  }

  // Initial load + SPA login/account changes + PWA return-to-page.
  window.addEventListener('DOMContentLoaded', () => {
    sync();
    setTimeout(sync, 500);
    setTimeout(sync, 1500);
  });
  window.addEventListener('tabaja:account-changed', () => setTimeout(sync, 0));
  window.addEventListener('pageshow', () => setTimeout(sync, 0));
  window.addEventListener('focus', () => setTimeout(sync, 0));
})();

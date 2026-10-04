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
    // Preserve the nav slot while entitlement is checked. This prevents
    // Workforce / Print Center / Reports from jumping vertically on focus/back.
    link.hidden = false;
    link.style.display = '';
    link.style.visibility = 'hidden';
    link.style.pointerEvents = 'none';
  }

  function show(link) {
    link.dataset.wfEntitlementReady = '1';
    link.hidden = false;
    link.style.display = '';
    link.style.visibility = 'visible';
    link.style.pointerEvents = '';
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


  function installSameTabNavigation(link) {
    if (!link || link.dataset.wfSameTabBound === '1') return;
    link.dataset.wfSameTabBound = '1';

    // Workforce is part of the same Tabaja Platform flow. Keep navigation in
    // the current tab/window so Back to Main returns normally to index.html.
    link.removeAttribute('target');
    link.addEventListener('click', (event) => {
      event.preventDefault();
      window.location.assign(link.href);
    }, true);
  }

  async function sync() {
    const link = document.getElementById('workforceNavLink');
    if (!link) return;
    installSameTabNavigation(link);

    // IMPORTANT: once Workforce has been proven enabled and the nav slot is
    // visible, never hide it again during focus/pageshow/account re-checks.
    // Hiding a live slot caused the Workforce / Print Center / Reports group
    // to visually blink/reflow for a fraction of a second on return.
    const alreadyVisible = link.dataset.wfEntitlementReady === '1' ||
      (!link.hidden && link.style.display !== 'none' && link.style.visibility !== 'hidden');
    if (!alreadyVisible) hide(link);

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

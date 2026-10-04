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




  function installSingleWindowShell(link) {
    if (!link || link.dataset.wfShellBound === '1') return;
    link.dataset.wfShellBound = '1';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      let shell = document.getElementById('tabajaWorkforceShell');
      if (!shell) {
        shell = document.createElement('div');
        shell.id = 'tabajaWorkforceShell';
        shell.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#f7f8fb;display:none';
        const frame = document.createElement('iframe');
        frame.id = 'tabajaWorkforceFrame';
        frame.title = 'Workforce & Payroll';
        frame.src = 'workforce.html?embedded=1';
        frame.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#f7f8fb';
        shell.appendChild(frame);
        document.body.appendChild(shell);
      }
      // Workforce is a top-level module. Its parent is ALWAYS Command Center,
      // never whichever Identity child view happened to be open before it.
      if (typeof window.TabajaSetView === 'function') window.TabajaSetView('dashboard');
      shell.style.display = 'block';
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    }, true);
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.data?.type !== 'tabaja:workforce:close') return;
    const shell = document.getElementById('tabajaWorkforceShell');
    if (shell) shell.style.display = 'none';
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    if (typeof window.TabajaSetView === 'function') window.TabajaSetView('dashboard');
  });


  function installMainEscapeGuard() {
    if (document.documentElement.dataset.tabajaMainEscapeBound === '1') return;
    document.documentElement.dataset.tabajaMainEscapeBound = '1';

    const closeExitModal = () => {
      const modal = document.getElementById('tabajaExitConfirm');
      if (!modal) return;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    };

    const showExitModal = () => {
      let modal = document.getElementById('tabajaExitConfirm');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'tabajaExitConfirm';
        modal.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(10,18,32,.46);display:none;place-items:center;padding:20px';
        modal.innerHTML = '<div role="dialog" aria-modal="true" aria-labelledby="tabajaExitTitle" style="width:min(390px,92vw);background:#fff;border-radius:18px;padding:24px;box-shadow:0 24px 70px rgba(0,0,0,.28);font-family:inherit;color:#172033"><h3 id="tabajaExitTitle" style="margin:0 0 8px">Exit Tabaja Solution DEV?</h3><p style="margin:0 0 20px;color:#667085">Press Esc again or Cancel to stay on Command Center.</p><div style="display:flex;justify-content:flex-end;gap:10px"><button type="button" data-exit-cancel style="padding:10px 16px;border-radius:10px;border:1px solid #d0d5dd;background:#fff">Cancel</button><button type="button" data-exit-yes style="padding:10px 16px;border-radius:10px;border:0;background:#172033;color:#fff">Yes, Exit</button></div></div>';
        document.body.appendChild(modal);
        modal.querySelector('[data-exit-cancel]').addEventListener('click', closeExitModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeExitModal(); });
        modal.querySelector('[data-exit-yes]').addEventListener('click', async () => {
          closeExitModal();
          // "Exit" means a real application sign-out, not window.close().
          // Reuse the platform's existing logout flow so Supabase session + local app state
          // are cleared exactly the same way as the normal Logout button.
          const logout = document.getElementById('logoutBtn');
          if (logout) {
            logout.click();
            return;
          }
          try { await window.TabajaCloud?.signOut?.(); } catch (_) {}
          localStorage.removeItem('tabaja_card_designer_login');
          sessionStorage.removeItem('tabaja_card_designer_login');
          window.location.reload();
        });
      }
      modal.style.display = 'grid';
      modal.setAttribute('aria-hidden', 'false');
      modal.querySelector('[data-exit-cancel]')?.focus();
    };

    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const shell = document.getElementById('tabajaWorkforceShell');
      if (shell && shell.style.display !== 'none') return; // iframe owns its own Back stack.

      const modal = document.getElementById('tabajaExitConfirm');
      if (modal && modal.style.display !== 'none') {
        event.preventDefault();
        event.stopPropagation();
        closeExitModal();
        return;
      }

      const view = document.body.dataset.v8View || 'dashboard';
      if (view !== 'dashboard' && typeof window.TabajaBackView === 'function') {
        event.preventDefault();
        event.stopPropagation();
        window.TabajaBackView();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      showExitModal();
    }, true);
  }

  async function sync() {
    const link = document.getElementById('workforceNavLink');
    if (!link) return;
    installSingleWindowShell(link);

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
    installMainEscapeGuard();
    sync();
    setTimeout(sync, 500);
    setTimeout(sync, 1500);
  });
  window.addEventListener('tabaja:account-changed', () => setTimeout(sync, 0));
  window.addEventListener('pageshow', () => setTimeout(sync, 0));
  window.addEventListener('focus', () => setTimeout(sync, 0));
})();

(() => {
  'use strict';
  async function sync() {
    const link = document.getElementById('workforceNavLink');
    if (!link || !window.TabajaCloud?.getClient) return;
    link.hidden = true;
    link.style.display = 'none';
    try {
      const client = window.TabajaCloud.getClient();
      const session = await window.TabajaCloud.getSession();
      if (!client || !session?.user?.id) return;
      const workspace = await window.TabajaCloud.loadWorkspace(session.user.id);
      if (!workspace?.companyId) return;
      const { data, error } = await client
        .from('wf_company_entitlements')
        .select('enabled')
        .eq('company_id', workspace.companyId)
        .maybeSingle();
      if (error || data?.enabled !== true) return;
      link.hidden = false;
      link.style.display = '';
    } catch (_) {}
  }
  window.addEventListener('DOMContentLoaded', sync);
  window.addEventListener('tabaja:account-changed', () => setTimeout(sync, 0));
})();

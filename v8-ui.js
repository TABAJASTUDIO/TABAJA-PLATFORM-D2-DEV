(() => {
  const subtitles = {
    dashboard: 'Dashboard • Professional CR80 PVC Production Suite',
    templates: 'Card Design Center • Structured collections for professional card production',
    designer: 'Card Designer • Create and print one employee card',
    employees: 'Employees • Company identity records and staff directory',
    printcenter: 'Print Center • Production workflows and Zebra device controls',
    reports: 'Reports • Production statistics and operational summaries',
    nfc: 'NFC Studio • ACS ACR122U smart identity operations',
    batch: 'Print Center / Batch Printing • Excel workflow for up to 50 cards',
    quality: 'Print Center / Print Quality • Professional photo and text rendering',
    zebra: 'Print Center / Zebra Settings • ZC300 alignment and bleed controls',
    elements: 'Emoji & Flags • Design elements for identity cards'
  };

  const designerViews = new Set(['designer', 'batch', 'quality', 'zebra']);

  function enforceSingleWorkspace(view) {
    // Navigation stability guard: only one workspace may be visible at a time.
    // Inline visibility is intentional so a stale cached stylesheet cannot stack modules.
    const visibility = {
      v8Dashboard: view === 'dashboard',
      templateGalleryWorkspace: view === 'templates' || view === 'elements',
      employeeWorkspace: view === 'employees',
      printCenterWorkspace: view === 'printcenter',
      reportsWorkspace: view === 'reports',
      nfcWorkspace: view === 'nfc',
      v8Main: designerViews.has(view)
    };

    Object.entries(visibility).forEach(([id, visible]) => {
      const element = document.getElementById(id);
      if (!element) return;
      element.style.display = visible ? '' : 'none';
      element.setAttribute('aria-hidden', visible ? 'false' : 'true');
    });
  }

  function setView(view) {
    if (view === 'nfc' && window.TabajaAccess && !window.TabajaAccess.can('nfc')) view = 'dashboard';
    if (view === 'batch' && window.TabajaAccess && !window.TabajaAccess.can('batch')) view = 'printcenter';
    if (view === 'elements') view = 'designer';
    document.body.dataset.v8View = view;
    enforceSingleWorkspace(view);
    const elementsOnly = view === 'elements';
    const elementsLibrary = document.getElementById('elementsLibrary');
    if (elementsLibrary) elementsLibrary.hidden = !elementsOnly;
    if (elementsOnly) {
      document.querySelectorAll('#templateGalleryWorkspace > :not(#elementsLibrary)').forEach(el => { el.style.display = 'none'; });
    } else {
      document.querySelectorAll('#templateGalleryWorkspace > :not(#elementsLibrary)').forEach(el => { el.style.display = ''; });
    }
    // Keep production/design controls out of customer-facing module pages.
    const designerTopActions = document.getElementById('designerTopActions');
    if (designerTopActions) {
      const showDesignerTools = designerViews.has(view) && view !== 'batch';
      designerTopActions.style.display = showDesignerTools ? '' : 'none';
      designerTopActions.setAttribute('aria-hidden', showDesignerTools ? 'false' : 'true');
    }
    document.querySelectorAll('.v8-nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    const sub = document.getElementById('pageSubtitle');
    if (sub) sub.textContent = subtitles[view] || subtitles.dashboard;
    const title = document.querySelector('header h1');
    if (title) title.textContent = ({dashboard:'Command Center',templates:'Card Design Center',designer:'Identity Studio',employees:'Employee Center',printcenter:'Print Center',reports:'Reports',nfc:'NFC Studio',batch:'Batch Printing',quality:'Print Quality',zebra:'Zebra Settings',elements:'Emoji & Flags'})[view] || 'Tabaja Solution';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.TabajaSetView = setView;
  // One-level professional Back navigation used by Esc.
  // Child workspace -> logical parent -> Command Center.
  const backParent = Object.freeze({
    reports: 'printcenter',
    printcenter: 'designer',
    employees: 'designer',
    templates: 'dashboard',
    designer: 'dashboard',
    batch: 'printcenter',
    quality: 'printcenter',
    zebra: 'printcenter',
    nfc: 'dashboard',
    elements: 'designer'
  });

  function backView() {
    const current = document.body.dataset.v8View || 'dashboard';
    const parent = backParent[current] || 'dashboard';
    if (current === 'dashboard') return false;
    setView(parent);
    return true;
  }

  window.TabajaBackView = backView;

  function init() {
    const qualityTools = document.getElementById('qualityTools');
    const host = document.getElementById('qualityToolsHost');
    if (qualityTools && host) host.appendChild(qualityTools);

    document.querySelectorAll('.v8-nav-btn').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
    document.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.go)));

    const modes = document.querySelectorAll('[data-quality-mode]');
    modes.forEach(btn => btn.addEventListener('click', () => {
      modes.forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.qualityMode;
      const brightness = document.getElementById('photoBrightness');
      const contrast = document.getElementById('photoContrast');
      const saturation = document.getElementById('photoSaturation');
      const sharpness = document.getElementById('photoSharpness');
      const hq = document.getElementById('highQualityOutput');
      const auto = document.getElementById('autoEnhancePhotos');
      if (mode === 'standard') { brightness.value=0; contrast.value=0; saturation.value=0; sharpness.value=0; hq.checked=false; auto.checked=false; }
      if (mode === 'professional') { brightness.value=3; contrast.value=6; saturation.value=2; sharpness.value=2; hq.checked=true; auto.checked=true; }
      if (mode === 'ultra') { brightness.value=4; contrast.value=8; saturation.value=3; sharpness.value=3; hq.checked=true; auto.checked=true; }
      ['input','change'].forEach(evt => [brightness,contrast,saturation,sharpness,hq,auto].forEach(el => el && el.dispatchEvent(new Event(evt,{bubbles:true}))));
    }));

    const saveZebra = document.getElementById('saveZebraSettings');
    const resetZebra = document.getElementById('resetZebraSettings');
    const testZebra = document.getElementById('zebraTestCard');
    const status = document.getElementById('zebraSettingsStatus');
    const fields = ['zebraOffsetX','zebraOffsetY','zebraBleed'];
    const saved = JSON.parse(localStorage.getItem('tabaja-zebra-settings') || '{}');
    fields.forEach(id => { const el=document.getElementById(id); if(el && saved[id] !== undefined) el.value=saved[id]; });
    saveZebra?.addEventListener('click', () => {
      const data={}; fields.forEach(id => data[id]=document.getElementById(id).value);
      localStorage.setItem('tabaja-zebra-settings', JSON.stringify(data));
      status.textContent=`Saved: X ${data.zebraOffsetX} mm • Y ${data.zebraOffsetY} mm • Bleed ${data.zebraBleed} mm`;
    });
    resetZebra?.addEventListener('click', () => {
      document.getElementById('zebraOffsetX').value=0; document.getElementById('zebraOffsetY').value=0; document.getElementById('zebraBleed').value=1;
      localStorage.removeItem('tabaja-zebra-settings'); status.textContent='Default Zebra settings restored.';
    });
    testZebra?.addEventListener('click', () => {
      setView('designer');
      status.textContent='Test mode ready. Use Print Current (Stable) after checking the card preview.';
    });

    setView('dashboard');
  }
  window.addEventListener('DOMContentLoaded', init);
})();

(() => {
  'use strict';

  const IMPORTS = Object.freeze({
    full_company_setup: {
      label: 'Full Company Setup',
      validator: 'wf_validate_full_company_setup_import_batch',
      confirmer: 'wf_confirm_full_company_setup_import_batch',
      hint: 'Areas → Sites → Posts → Shifts → Employees → Assignments → Salary & Transport.',
      sheets: ['Areas','Sites','Posts','Shifts','Employees','Assignments','Salary_Transport']
    },
    employees_only: {
      label: 'Employees Only',
      validator: 'wf_validate_employee_import_batch',
      confirmer: 'wf_confirm_employee_import_batch',
      hint: 'Creates new employees or safely links matching employee codes. Existing Identity details are not overwritten.',
      sheets: ['Employees']
    },
    sites_assignments: {
      label: 'Sites & Assignments',
      validator: 'wf_validate_sites_assignments_import_batch',
      confirmer: 'wf_confirm_sites_assignments_import_batch',
      hint: 'Imports employee assignments into Areas / Sites / Posts / Shifts that already exist in Workforce.',
      sheets: ['Assignments']
    },
    salary_transport: {
      label: 'Salary & Transport',
      validator: 'wf_validate_salary_transport_import_batch',
      confirmer: 'wf_confirm_salary_transport_import_batch',
      hint: 'Creates salary and transport records as Pending for maker-checker approval.',
      sheets: ['Salary_Transport']
    },
    attendance: {
      label: 'Attendance',
      validator: 'wf_validate_attendance_import_batch',
      confirmer: 'wf_confirm_attendance_import_batch',
      hint: 'Creates attendance records as Pending for approval. Dates use DD/MM/YYYY.',
      sheets: ['Attendance']
    }
  });

  const FULL_RECORD_TYPES = Object.freeze({
    Areas: 'area', Sites: 'site', Posts: 'post', Shifts: 'shift', Employees: 'employee', Assignments: 'assignment', Salary_Transport: 'salary_transport'
  });

  const state = {
    client: null,
    session: null,
    workspace: null,
    entitlement: null,
    file: null,
    workbook: null,
    currentBatch: null,
    preview: [],
    busy: false
  };

  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));

  function setMessage(text, tone = 'info') {
    const el = $('wfMessage');
    if (!el) return;
    el.className = `wf-message ${tone}`;
    el.textContent = text;
  }

  function setGate(text, failed = false) {
    $('wfGateMessage').textContent = text;
    const spinner = document.querySelector('.wf-spinner');
    if (failed && spinner) spinner.style.display = 'none';
  }

  function setBusy(busy, text = '') {
    state.busy = busy;
    $('wfStageBtn').disabled = busy || !state.file;
    $('wfConfirmBtn').disabled = busy || state.currentBatch?.status !== 'ready';
    $('wfRefreshBtn').disabled = busy || !state.currentBatch?.id;
    if (text) setMessage(text, 'info');
  }

  function statusBadge(status) {
    const el = $('wfBatchStatus');
    const clean = String(status || 'NO BATCH').toLowerCase();
    el.textContent = String(status || 'NO BATCH').replaceAll('_',' ').toUpperCase();
    el.className = `wf-badge ${clean === 'no batch' ? 'neutral' : clean}`;
  }

  function renderBatch(batch) {
    state.currentBatch = batch || null;
    statusBadge(batch?.status || 'NO BATCH');
    $('wfBatchFile').textContent = batch?.original_filename || state.file?.name || 'No file staged';
    $('wfBatchId').textContent = batch?.id ? `Batch ${batch.id}` : 'Upload an Excel file to begin.';
    $('wfTotalRows').textContent = batch?.total_rows ?? 0;
    $('wfValidRows').textContent = batch?.valid_rows ?? 0;
    $('wfWarningRows').textContent = batch?.warning_rows ?? 0;
    $('wfErrorRows').textContent = batch?.error_rows ?? 0;

    const confirmable = batch?.status === 'ready' && Number(batch?.error_rows || 0) === 0;
    $('wfConfirmBtn').disabled = state.busy || !confirmable;
    $('wfRefreshBtn').disabled = state.busy || !batch?.id;

    if (!batch) $('wfConfirmHint').textContent = 'Validation must finish with zero errors before confirmation.';
    else if (batch.status === 'confirmed') $('wfConfirmHint').textContent = 'Import confirmed successfully. The batch is now locked.';
    else if (batch.status === 'ready' && Number(batch.error_rows || 0) === 0) $('wfConfirmHint').textContent = Number(batch.warning_rows || 0) ? 'Ready to confirm. Review the warnings first.' : 'Validation passed. Ready to confirm.';
    else if (Number(batch.error_rows || 0) > 0) $('wfConfirmHint').textContent = 'Fix the Excel errors and upload a corrected file before confirmation.';
    else $('wfConfirmHint').textContent = 'Validation is not ready for confirmation yet.';
  }

  function normalizeHeader(key) {
    return String(key || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function valueToText(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const d = String(value.getDate()).padStart(2,'0');
      const m = String(value.getMonth()+1).padStart(2,'0');
      return `${d}/${m}/${value.getFullYear()}`;
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value).trim();
  }

  function cleanObject(row) {
    const out = {};
    Object.entries(row || {}).forEach(([key, value]) => {
      const normalized = normalizeHeader(key);
      if (!normalized) return;
      out[normalized] = valueToText(value);
    });
    return out;
  }

  function isBlankRow(row) {
    return !Object.values(row || {}).some(v => String(v ?? '').trim() !== '');
  }

  function rowsFromSheet(workbook, sheetName) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, dateNF: 'dd/mm/yyyy' });
    return rows.map(cleanObject).filter(row => !isBlankRow(row));
  }

  function resolveSheet(workbook, desired) {
    if (workbook.Sheets[desired]) return desired;
    const wanted = normalizeHeader(desired);
    return workbook.SheetNames.find(name => normalizeHeader(name) === wanted) || null;
  }

  function buildRows(importType, workbook) {
    const cfg = IMPORTS[importType];
    if (!cfg) throw new Error('Unsupported import type.');
    const output = [];

    if (importType === 'full_company_setup') {
      cfg.sheets.forEach(sheetLabel => {
        const actual = resolveSheet(workbook, sheetLabel);
        if (!actual) return;
        rowsFromSheet(workbook, actual).forEach(row => output.push({ ...row, record_type: FULL_RECORD_TYPES[sheetLabel] }));
      });
      if (!output.length) throw new Error('No Full Company Setup rows found. Use the official template sheets.');
      return output;
    }

    const desired = cfg.sheets[0];
    const actual = resolveSheet(workbook, desired) || (workbook.SheetNames.length === 1 ? workbook.SheetNames[0] : null);
    if (!actual) throw new Error(`Sheet “${desired}” was not found in this workbook.`);
    const rows = rowsFromSheet(workbook, actual);
    if (!rows.length) throw new Error(`Sheet “${actual}” has no data rows.`);

    if (importType === 'sites_assignments') {
      return rows.map(row => ({
        employee_code: row.employee_code || '',
        area: row.area || row.area_name || '',
        site: row.site || row.site_name || '',
        post: row.post || row.post_name || '',
        shift: row.shift || row.shift_name || '',
        start_date: row.start_date || '',
        end_date: row.end_date || '',
        status: row.status || 'active'
      }));
    }

    return rows;
  }

  function referenceFor(row) {
    const n = row.normalized_data || {};
    const raw = row.raw_data || {};
    const type = n.record_type || raw.record_type || '';
    if (type === 'area') return n.area_name || raw.area_name || '';
    if (type === 'site') return n.site_name || raw.site_name || '';
    if (type === 'post') return n.post_name || raw.post_name || '';
    if (type === 'shift') return n.shift_name || raw.shift_name || '';
    if (type === 'employee') return [n.employee_code || raw.employee_code, n.full_name || raw.full_name].filter(Boolean).join(' - ');
    if (type === 'assignment') return `${n.employee_code || raw.employee_code || ''} → ${n.site_name || raw.site_name || raw.site || ''}`;
    if (type === 'salary_transport') return n.employee_code || raw.employee_code || '';
    return n.employee_name || n.employee_code || raw.employee_code || raw.full_name || raw.site || raw.site_name || `Row ${row.row_number}`;
  }

  function codesToText(value) {
    if (!Array.isArray(value) || !value.length) return '—';
    return value.join(', ');
  }

  function renderPreview(rows) {
    state.preview = rows || [];
    $('wfPreviewCount').textContent = `${state.preview.length} row${state.preview.length === 1 ? '' : 's'}`;
    const body = $('wfPreviewBody');
    if (!state.preview.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">No validation results yet.</td></tr>';
      return;
    }
    body.innerHTML = state.preview.map(row => {
      const status = row.validation_status || 'pending';
      const errors = codesToText(row.error_codes);
      const warnings = codesToText(row.warning_codes);
      return `<tr>
        <td>${escapeHtml(row.row_number)}</td>
        <td><span class="wf-status-pill ${escapeHtml(status)}">${escapeHtml(status.toUpperCase())}</span></td>
        <td>${escapeHtml(row.intended_action || '—')}</td>
        <td>${escapeHtml(referenceFor(row) || '—')}</td>
        <td class="wf-code-list">${escapeHtml(errors)}</td>
        <td class="wf-code-list warn">${escapeHtml(warnings)}</td>
      </tr>`;
    }).join('');
  }

  async function getBatch(batchId) {
    const { data, error } = await state.client
      .from('wf_import_batches')
      .select('id,company_id,import_type,original_filename,status,total_rows,valid_rows,warning_rows,error_rows,imported_rows,created_at,confirmed_at')
      .eq('company_id', state.workspace.companyId)
      .eq('id', batchId)
      .single();
    if (error) throw error;
    return data;
  }

  async function refreshPreview() {
    if (!state.currentBatch?.id) return;
    const { data, error } = await state.client
      .from('wf_import_rows')
      .select('row_number,raw_data,normalized_data,validation_status,intended_action,error_codes,warning_codes,matched_employee_id')
      .eq('company_id', state.workspace.companyId)
      .eq('batch_id', state.currentBatch.id)
      .order('row_number', { ascending: true });
    if (error) throw error;
    renderPreview(data || []);
    renderBatch(await getBatch(state.currentBatch.id));
  }

  async function reloadHistory() {
    if (!state.workspace?.companyId) return;
    const host = $('wfRecentBatches');
    host.innerHTML = '<div class="wf-empty-card">Loading recent batches…</div>';
    const { data, error } = await state.client
      .from('wf_import_batches')
      .select('id,import_type,original_filename,status,total_rows,valid_rows,warning_rows,error_rows,imported_rows,created_at')
      .eq('company_id', state.workspace.companyId)
      .order('created_at', { ascending: false })
      .limit(8);
    if (error) {
      host.innerHTML = `<div class="wf-empty-card">${escapeHtml(error.message)}</div>`;
      return;
    }
    if (!data?.length) {
      host.innerHTML = '<div class="wf-empty-card">No import batches yet.</div>';
      return;
    }
    host.innerHTML = data.map(batch => `<div class="wf-recent-row">
      <div><b>${escapeHtml(batch.original_filename || 'Untitled import')}</b><small>${escapeHtml((IMPORTS[batch.import_type]?.label || batch.import_type || '').replaceAll('_',' '))}</small></div>
      <span class="wf-badge ${escapeHtml(batch.status)}">${escapeHtml(String(batch.status).replaceAll('_',' ').toUpperCase())}</span>
      <small>${escapeHtml(batch.total_rows)} rows</small>
      <small>${escapeHtml(new Date(batch.created_at).toLocaleString())}</small>
    </div>`).join('');
  }

  async function parseSelectedFile(file) {
    if (!file) return;
    const ext = String(file.name || '').toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls')) throw new Error('Please choose an Excel .xlsx or .xls file.');
    const buffer = await file.arrayBuffer();
    state.workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
    state.file = file;
    $('wfFileLabel').textContent = file.name;
    $('wfStageBtn').disabled = false;
    setMessage(`Excel loaded locally: ${file.name}. Nothing has been uploaded yet.`, 'success');
  }

  async function insertRows(batchId, rows) {
    const payload = rows.map((raw, i) => ({
      company_id: state.workspace.companyId,
      batch_id: batchId,
      row_number: i + 1,
      raw_data: raw
    }));
    const chunkSize = 400;
    for (let i = 0; i < payload.length; i += chunkSize) {
      const { error } = await state.client.from('wf_import_rows').insert(payload.slice(i, i + chunkSize));
      if (error) throw error;
    }
  }

  async function stageAndValidate() {
    if (state.busy || !state.file || !state.workbook) return;
    const importType = $('wfImportType').value;
    const cfg = IMPORTS[importType];
    if (!cfg) return;

    setBusy(true, 'Reading Excel sheets and preparing staging rows…');
    try {
      const rows = buildRows(importType, state.workbook);
      if (rows.length > 10000) throw new Error('This file contains more than 10,000 rows. Split it into smaller imports.');

      const { data: batch, error: batchError } = await state.client
        .from('wf_import_batches')
        .insert({
          company_id: state.workspace.companyId,
          import_type: importType,
          original_filename: state.file.name,
          notes: 'Created from Workforce Import Center UI'
        })
        .select('id,company_id,import_type,original_filename,status,total_rows,valid_rows,warning_rows,error_rows,imported_rows,created_at')
        .single();
      if (batchError) throw batchError;

      renderBatch(batch);
      setMessage(`Staging ${rows.length} row${rows.length === 1 ? '' : 's'}…`, 'info');
      await insertRows(batch.id, rows);

      setMessage('Running server-side Workforce validation…', 'info');
      const { error: rpcError } = await state.client.rpc(cfg.validator, {
        target_company: state.workspace.companyId,
        target_batch: batch.id
      });
      if (rpcError) throw rpcError;

      await refreshPreview();
      const current = state.currentBatch;
      if (current.status === 'ready') {
        setMessage(Number(current.warning_rows || 0) ? `Validation passed with ${current.warning_rows} warning(s). Review them, then Confirm Import.` : 'Validation passed with zero errors. Ready to confirm.', Number(current.warning_rows || 0) ? 'warning' : 'success');
      } else {
        setMessage(`Validation found ${current.error_rows} error(s). Correct the Excel file and upload a new batch.`, 'error');
      }
      await reloadHistory();
    } catch (error) {
      console.error('[Workforce Import]', error);
      setMessage(error?.message || 'Import validation failed.', 'error');
      if (state.currentBatch?.id) {
        try { await refreshPreview(); } catch (_) {}
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    const batch = state.currentBatch;
    if (state.busy || !batch?.id || batch.status !== 'ready') return;
    const cfg = IMPORTS[batch.import_type];
    if (!cfg) return;

    const text = Number(batch.warning_rows || 0)
      ? `Confirm ${batch.total_rows} rows with ${batch.warning_rows} warning(s)? This will write approved staging data to Workforce tables.`
      : `Confirm ${batch.total_rows} validated rows? This will write data to Workforce tables.`;
    if (!window.confirm(text)) return;

    setBusy(true, 'Confirming import through the protected Workforce server function…');
    try {
      const { data, error } = await state.client.rpc(cfg.confirmer, {
        target_company: state.workspace.companyId,
        target_batch: batch.id
      });
      if (error) throw error;
      await refreshPreview();
      setMessage(`Import confirmed successfully. ${data?.imported_rows ?? data?.rows_imported ?? data?.attendance_records_created ?? state.currentBatch?.imported_rows ?? 0} row(s) processed. The batch is now locked.`, 'success');
      await reloadHistory();
    } catch (error) {
      console.error('[Workforce Confirm]', error);
      setMessage(error?.message || 'Confirm failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function clearFile() {
    state.file = null;
    state.workbook = null;
    $('wfFileInput').value = '';
    $('wfFileLabel').textContent = 'Drop an Excel file here';
    $('wfStageBtn').disabled = true;
    if (!state.currentBatch) setMessage('Choose an import type and Excel file.', 'info');
  }

  function bindUi() {
    $('wfImportType').addEventListener('change', () => {
      const cfg = IMPORTS[$('wfImportType').value];
      $('wfImportHint').textContent = cfg?.hint || '';
      clearFile();
    });

    const input = $('wfFileInput');
    const zone = $('wfDropZone');
    const choose = () => input.click();
    zone.addEventListener('click', event => { if (event.target?.id !== 'wfBrowseBtn') choose(); });
    zone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
    $('wfBrowseBtn').addEventListener('click', event => { event.stopPropagation(); choose(); });
    input.addEventListener('change', async () => {
      try { await parseSelectedFile(input.files?.[0]); }
      catch (error) { clearFile(); setMessage(error.message, 'error'); }
    });

    ['dragenter','dragover'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.add('drag'); }));
    ['dragleave','drop'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.remove('drag'); }));
    zone.addEventListener('drop', async event => {
      try { await parseSelectedFile(event.dataTransfer?.files?.[0]); }
      catch (error) { clearFile(); setMessage(error.message, 'error'); }
    });

    $('wfStageBtn').addEventListener('click', stageAndValidate);
    $('wfClearBtn').addEventListener('click', clearFile);
    $('wfConfirmBtn').addEventListener('click', confirmImport);
    $('wfRefreshBtn').addEventListener('click', async () => {
      try { setBusy(true, 'Refreshing batch status…'); await refreshPreview(); setMessage('Batch refreshed.', 'success'); }
      catch (error) { setMessage(error.message, 'error'); }
      finally { setBusy(false); }
    });
    $('wfReloadHistory').addEventListener('click', reloadHistory);
  }

  async function checkEntitlement() {
    // Use the protected server-side entitlement check first. This avoids
    // depending on direct SELECT access to the entitlement table.
    const { data: enabled, error: rpcError } = await state.client.rpc('wf_is_enabled', {
      target_company: state.workspace.companyId
    });

    if (!rpcError) {
      state.entitlement = { enabled: enabled === true, plan: null };

      // Plan is display-only; fetch it only when table SELECT is available.
      try {
        const { data } = await state.client
          .from('wf_company_entitlements')
          .select('company_id,enabled,plan')
          .eq('company_id', state.workspace.companyId)
          .maybeSingle();
        if (data) state.entitlement = data;
      } catch (_) {}

      return enabled === true;
    }

    // Compatibility fallback for older database builds.
    const { data, error } = await state.client
      .from('wf_company_entitlements')
      .select('company_id,enabled,plan')
      .eq('company_id', state.workspace.companyId)
      .maybeSingle();
    if (error) throw rpcError || error;
    state.entitlement = data || null;
    return data?.enabled === true;
  }

  async function init() {
    bindUi();
    try {
      if (!window.TabajaCloud?.getClient) throw new Error('Cloud connection is unavailable. Open the main DEV platform first.');
      state.client = window.TabajaCloud.getClient();
      if (!state.client) throw new Error('Cloud is not configured.');
      state.session = await window.TabajaCloud.getSession();
      if (!state.session?.user) throw new Error('No active cloud session. Sign in through the main Tabaja Solution DEV page first.');

      state.workspace = await window.TabajaCloud.loadWorkspace(state.session.user.id);
      if (!state.workspace?.companyId) throw new Error('No company workspace is linked to this user.');

      $('wfCompanyName').textContent = state.workspace.company || 'Workforce Company';
      $('wfUserEmail').textContent = state.session.user.email || state.workspace.role || '';

      const enabled = await checkEntitlement();
      const badge = $('wfEntitlementBadge');
      if (!enabled) {
        badge.textContent = 'MODULE OFF';
        badge.className = 'wf-badge failed';
        throw new Error('Workforce & Payroll is not enabled for this company. Enable the company entitlement first.');
      }

      badge.textContent = state.entitlement?.plan ? `WORKFORCE ${state.entitlement.plan}` : 'WORKFORCE ON';
      badge.className = 'wf-badge enabled';
      $('wfGate').hidden = true;
      $('wfWorkspace').hidden = false;
      setMessage('Workforce is connected. Choose an Excel file to begin.', 'success');
      await reloadHistory();
    } catch (error) {
      console.error('[Workforce Init]', error);
      setGate(error?.message || 'Unable to open Workforce.', true);
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();

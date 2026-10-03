(() => {
  'use strict';


  const MAIN_LOGIN_KEY = 'tabaja_card_designer_login';

  async function returnToIdentityPlatform(event) {
    if (event) event.preventDefault();

    // Preferred no-flash route: Workforce was opened from the live Identity
    // shell in a separate same-origin window. Closing this window reveals the
    // still-rendered Identity Platform instantly, so no Sign In screen repaints.
    try {
      if (window.opener && !window.opener.closed) {
        try { window.opener.focus(); } catch (_) {}
        window.close();
        // If the host refuses window.close(), continue to the safe fallback.
        await new Promise(resolve => setTimeout(resolve, 80));
        if (window.closed) return;
      }

      let liveSession = state.session || null;
      if (state.client?.auth?.getSession) {
        const { data, error } = await state.client.auth.getSession();
        if (error) throw error;
        liveSession = data?.session || liveSession;
      }
      if (!liveSession?.user?.id) throw new Error('Your cloud session has expired. Please sign in again.');

      window.sessionStorage.setItem(MAIN_LOGIN_KEY, '1');
      window.location.assign('index.html');
    } catch (error) {
      console.error('[Workforce Return]', error);
      setGate(error?.message || 'Unable to return to Identity Platform.', true);
    }
  }

  function bindIdentityReturnButtons() {
    document.querySelectorAll('[data-wf-back-main]').forEach((control) => {
      control.addEventListener('click', returnToIdentityPlatform);
    });
  }

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
    busy: false,
    dashboardBusy: false,
    dashboardLoaded: false,
    currentSection: 'dashboard',
    approvals: [],
    approvalsBusy: false,
    makerCheckerRequired: true,
    payrollRuns: [],
    payrollPeriods: [],
    selectedPayrollRun: null,
    payrollBusy: false,
    setupEmployees: [],
    setupBusy: false
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

  function batchStorageKey() {
    return state.workspace?.companyId ? `tabaja:wf:current-batch:${state.workspace.companyId}` : '';
  }

  function rememberBatch(batch) {
    try {
      const key = batchStorageKey();
      if (!key) return;
      if (batch?.id) window.sessionStorage.setItem(key, batch.id);
    } catch (_) {}
  }

  function renderBatch(batch) {
    state.currentBatch = batch || null;
    rememberBatch(batch);
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

  async function restoreBatchById(batchId, sourceLabel = 'last') {
    if (!batchId) return false;
    const batch = await getBatch(batchId);
    renderBatch(batch);
    const { data, error } = await state.client
      .from('wf_import_rows')
      .select('row_number,raw_data,normalized_data,validation_status,intended_action,error_codes,warning_codes,matched_employee_id')
      .eq('company_id', state.workspace.companyId)
      .eq('batch_id', batchId)
      .order('row_number', { ascending: true });
    if (error) throw error;
    renderPreview(data || []);
    if (batch.status === 'confirmed') setMessage(`Restored the ${sourceLabel} confirmed import batch.`, 'success');
    else if (batch.status === 'ready') setMessage(`Restored the ${sourceLabel} validated batch. It is still ready to confirm.`, 'success');
    else setMessage(`Restored ${sourceLabel} batch with status ${String(batch.status || '').replaceAll('_',' ')}.`, 'info');
    return true;
  }

  async function restoreRememberedBatch() {
    const key = batchStorageKey();
    if (!key) return false;
    let batchId = '';
    try { batchId = window.sessionStorage.getItem(key) || ''; } catch (_) {}

    if (batchId) {
      try {
        return await restoreBatchById(batchId, 'last');
      } catch (error) {
        console.warn('[Workforce Import] remembered batch could not be restored', error?.message || error);
        try { window.sessionStorage.removeItem(key); } catch (_) {}
      }
    }

    // Hard refresh/new Workforce window can lose sessionStorage context. In that case,
    // restore the newest batch from Supabase for this company instead of showing NO BATCH.
    try {
      const { data, error } = await state.client
        .from('wf_import_batches')
        .select('id')
        .eq('company_id', state.workspace.companyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data?.id) return false;
      return await restoreBatchById(data.id, 'latest');
    } catch (error) {
      console.warn('[Workforce Import] latest batch could not be restored', error?.message || error);
      return false;
    }
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


  function dashboardMessage(text, tone = 'info') {
    const el = $('wfDashboardMessage');
    if (!el) return;
    el.className = `wf-message ${tone}`;
    el.textContent = text;
  }

  function companyLocalDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function humanDate(isoDate) {
    if (!isoDate) return 'Today';
    const d = new Date(`${isoDate}T12:00:00`);
    return Number.isNaN(d.getTime()) ? isoDate : d.toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  function formatDateDMY(value) {
    if (!value) return '';
    const raw = String(value).trim();
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return dmy ? raw : raw;
  }

  function parseDateDMY(value) {
    const raw = String(value || '').trim();
    let y, m, d;
    let match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) { d = Number(match[1]); m = Number(match[2]); y = Number(match[3]); }
    else {
      match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return null;
      y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
    }
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
    return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }

  function formatMoney(value, currency = '') {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
    return currency ? `${formatted} ${currency}` : formatted;
  }

  function pickNumber(obj, keys) {
    for (const key of keys) {
      if (obj && obj[key] !== null && obj[key] !== undefined && Number.isFinite(Number(obj[key]))) return Number(obj[key]);
    }
    return null;
  }

  function pickText(obj, keys) {
    for (const key of keys) {
      const value = obj?.[key];
      if (value !== null && value !== undefined && String(value).trim() !== '') return String(value);
    }
    return '';
  }

  async function safeCount(table, extra = []) {
    try {
      let query = state.client.from(table).select('id', { count: 'exact', head: true }).eq('company_id', state.workspace.companyId);
      for (const [op, column, value] of extra) {
        if (typeof query[op] !== 'function') continue;
        query = query[op](column, value);
      }
      const { count, error } = await query;
      if (error) throw error;
      return Number(count || 0);
    } catch (error) {
      console.warn(`[Workforce Dashboard] ${table} count unavailable`, error?.message || error);
      return null;
    }
  }

  async function fetchAttendanceToday(today) {
    try {
      const { data, error } = await state.client
        .from('wf_attendance_records')
        .select('id,employee_id,site_id,attendance_status,approval_status,worked_minutes,overtime_minutes,clock_in_at,clock_out_at')
        .eq('company_id', state.workspace.companyId)
        .eq('work_date', today)
        .order('clock_in_at', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.warn('[Workforce Dashboard] attendance unavailable', error?.message || error);
      return null;
    }
  }

  async function fetchNameMap(table, ids, fields) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    if (!unique.length) return new Map();
    try {
      const { data, error } = await state.client.from(table).select(fields).in('id', unique);
      if (error) throw error;
      return new Map((data || []).map(row => [row.id, row]));
    } catch (error) {
      console.warn(`[Workforce Dashboard] ${table} lookup unavailable`, error?.message || error);
      return new Map();
    }
  }

  function renderTodayAttendance(records, employeeMap, siteMap) {
    const body = $('wfTodayAttendanceBody');
    if (!body) return;
    if (!records) {
      body.innerHTML = '<tr><td colspan="6" class="empty">Attendance data is not available for this account.</td></tr>';
      return;
    }
    if (!records.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">No attendance records for today yet.</td></tr>';
      return;
    }
    body.innerHTML = records.slice(0, 12).map(row => {
      const employee = employeeMap.get(row.employee_id) || {};
      const site = siteMap.get(row.site_id) || {};
      const status = String(row.attendance_status || '—').replaceAll('_', ' ');
      const approval = String(row.approval_status || '—').replaceAll('_', ' ');
      const employeeLabel = employee.full_name || employee.employee_code || row.employee_id || '—';
      return `<tr>
        <td><b>${escapeHtml(employeeLabel)}</b><small class="wf-cell-sub">${escapeHtml(employee.employee_code || '')}</small></td>
        <td><span class="wf-status-pill ${escapeHtml(String(row.attendance_status || ''))}">${escapeHtml(status.toUpperCase())}</span></td>
        <td>${escapeHtml(site.name || '—')}</td>
        <td>${escapeHtml(row.worked_minutes ?? 0)} min</td>
        <td>${escapeHtml(row.overtime_minutes ?? 0)} min</td>
        <td>${escapeHtml(approval.toUpperCase())}</td>
      </tr>`;
    }).join('');
  }

  async function loadApprovalBreakdown() {
    const definitions = [
      ['Salary changes', 'wf_employee_salary_history'],
      ['Transport overrides', 'wf_transport_employee_overrides'],
      ['Attendance', 'wf_attendance_records'],
      ['Leave requests', 'wf_leave_requests'],
      ['Advances / loans', 'wf_advances']
    ];
    const results = await Promise.all(definitions.map(async ([label, table]) => [label, await safeCount(table, [['eq', 'approval_status', 'pending']])]));
    const available = results.filter(([, count]) => count !== null);
    const total = available.reduce((sum, [, count]) => sum + count, 0);
    $('wfKpiPending').textContent = available.length ? String(total) : '—';
    $('wfApprovalTotalBadge').textContent = available.length ? `${total} ITEM${total === 1 ? '' : 'S'}` : 'UNAVAILABLE';
    $('wfApprovalTotalBadge').className = `wf-badge ${total > 0 ? 'needs_review' : 'confirmed'}`;
    const host = $('wfApprovalBreakdown');
    if (!available.length) {
      host.innerHTML = '<div class="wf-empty-card">Approval data is not available for this account.</div>';
      return;
    }
    host.innerHTML = available.map(([label, count]) => `<div class="wf-approval-row">
      <span>${escapeHtml(label)}</span><b>${escapeHtml(count)}</b>
    </div>`).join('');
  }

  async function loadPayrollSummary() {
    const status = $('wfPayrollStatus');
    try {
      const { data: settings } = await state.client
        .from('wf_company_settings')
        .select('currency_code')
        .eq('company_id', state.workspace.companyId)
        .maybeSingle();
      const currency = settings?.currency_code || '';

      const { data: runs, error: runError } = await state.client
        .from('wf_payroll_runs')
        .select('*')
        .eq('company_id', state.workspace.companyId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (runError) throw runError;
      const run = runs?.[0];
      if (!run) {
        status.textContent = 'NO RUN';
        status.className = 'wf-badge neutral';
        $('wfPayrollEmployees').textContent = '0';
        $('wfPayrollGross').textContent = '—';
        $('wfPayrollDeductions').textContent = '—';
        $('wfPayrollNet').textContent = '—';
        $('wfPayrollPeriod').textContent = 'No payroll run available yet.';
        $('wfPayrollUpdated').textContent = 'Create a payroll run when attendance and approvals are ready.';
        return;
      }

      const runStatus = pickText(run, ['status','approval_status','run_status']) || 'open';
      status.textContent = runStatus.replaceAll('_',' ').toUpperCase();
      status.className = `wf-badge ${runStatus.toLowerCase()}`;

      let snapshots = [];
      try {
        const { data, error } = await state.client
          .from('wf_payroll_employee_snapshots')
          .select('*')
          .eq('company_id', state.workspace.companyId)
          .order('created_at', { ascending: false })
          .limit(500);
        if (error) throw error;
        snapshots = data || [];
      } catch (error) {
        console.warn('[Workforce Dashboard] payroll snapshots unavailable', error?.message || error);
      }

      const runId = run.id;
      if (runId && snapshots.length) {
        const runKey = ['payroll_run_id','run_id'].find(key => Object.prototype.hasOwnProperty.call(snapshots[0], key));
        if (runKey) snapshots = snapshots.filter(row => row[runKey] === runId);
      }

      const grossFromRun = pickNumber(run, ['gross_pay','gross_amount','total_gross','gross']);
      const deductionsFromRun = pickNumber(run, ['total_deductions','deductions_total','deduction_amount','deductions']);
      const netFromRun = pickNumber(run, ['net_pay','net_amount','total_net','net']);
      const employeeCountFromRun = pickNumber(run, ['employee_count','employees_count','total_employees']);

      const sumKeys = (rows, keys) => rows.reduce((sum, row) => sum + (pickNumber(row, keys) || 0), 0);
      const gross = grossFromRun ?? (snapshots.length ? sumKeys(snapshots, ['gross_pay','gross_amount','gross']) : null);
      const deductions = deductionsFromRun ?? (snapshots.length ? sumKeys(snapshots, ['total_deductions','deductions_total','deductions']) : null);
      const net = netFromRun ?? (snapshots.length ? sumKeys(snapshots, ['net_pay','net_amount','net']) : null);
      const employeeCount = employeeCountFromRun ?? (snapshots.length || null);

      $('wfPayrollEmployees').textContent = employeeCount === null ? '—' : String(employeeCount);
      $('wfPayrollGross').textContent = formatMoney(gross, currency);
      $('wfPayrollDeductions').textContent = formatMoney(deductions, currency);
      $('wfPayrollNet').textContent = formatMoney(net, currency);

      let periodLabel = '';
      const start = pickText(run, ['period_start','start_date']);
      const end = pickText(run, ['period_end','end_date']);
      if (start || end) periodLabel = `${start || '—'} → ${end || '—'}`;
      if (!periodLabel) periodLabel = pickText(run, ['name','reference_no','reference']) || `Payroll run ${String(run.id || '').slice(0,8)}`;
      $('wfPayrollPeriod').textContent = periodLabel;
      $('wfPayrollUpdated').textContent = run.created_at ? `Created ${new Date(run.created_at).toLocaleString()}` : 'Latest Workforce payroll run.';
    } catch (error) {
      console.warn('[Workforce Dashboard] payroll unavailable', error?.message || error);
      status.textContent = 'UNAVAILABLE';
      status.className = 'wf-badge neutral';
      $('wfPayrollEmployees').textContent = '—';
      $('wfPayrollGross').textContent = '—';
      $('wfPayrollDeductions').textContent = '—';
      $('wfPayrollNet').textContent = '—';
      $('wfPayrollPeriod').textContent = 'Payroll summary is not available for this account yet.';
      $('wfPayrollUpdated').textContent = 'The Dashboard continues loading the other Workforce areas.';
    }
  }

  async function loadDashboardImports() {
    const host = $('wfDashboardImports');
    try {
      const { data, error } = await state.client
        .from('wf_import_batches')
        .select('id,import_type,original_filename,status,total_rows,imported_rows,created_at')
        .eq('company_id', state.workspace.companyId)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      if (!data?.length) {
        host.innerHTML = '<div class="wf-empty-card">No import activity yet.</div>';
        return;
      }
      host.innerHTML = data.map(batch => `<div class="wf-mini-row">
        <div><b>${escapeHtml(batch.original_filename || 'Untitled import')}</b><small>${escapeHtml(IMPORTS[batch.import_type]?.label || batch.import_type || '')}</small></div>
        <span class="wf-badge ${escapeHtml(batch.status || 'neutral')}">${escapeHtml(String(batch.status || '').replaceAll('_',' ').toUpperCase())}</span>
      </div>`).join('');
    } catch (error) {
      host.innerHTML = `<div class="wf-empty-card">${escapeHtml(error?.message || 'Import history unavailable.')}</div>`;
    }
  }


  const APPROVAL_SOURCES = Object.freeze([
    { kind: 'salary', label: 'Salary', table: 'wf_employee_salary_history' },
    { kind: 'transport', label: 'Transport', table: 'wf_transport_employee_overrides' },
    { kind: 'attendance', label: 'Attendance', table: 'wf_attendance_records' },
    { kind: 'leave', label: 'Leave', table: 'wf_leave_requests' },
    { kind: 'advance', label: 'Advance / Loan', table: 'wf_advances' }
  ]);

  function approvalMessage(text, tone = 'info') {
    const el = $('wfApprovalMessage');
    if (!el) return;
    el.className = `wf-message ${tone}`;
    el.textContent = text;
  }

  function approvalDetail(item) {
    const r = item.record || {};
    if (item.kind === 'salary') return `${formatMoney(r.base_amount, r.currency_code || '')} • ${String(r.pay_basis || 'salary').replaceAll('_',' ')} • effective ${r.effective_from || '—'}`;
    if (item.kind === 'transport') return `${String(r.method || 'transport').replaceAll('_',' ')} • ${r.amount === null || r.amount === undefined ? 'Rule-based amount' : formatMoney(r.amount)} • effective ${r.effective_from || '—'}`;
    if (item.kind === 'attendance') return `${r.work_date || '—'} • ${String(r.attendance_status || 'attendance').replaceAll('_',' ')} • ${r.worked_minutes ?? 0} worked min • ${r.overtime_minutes ?? 0} OT min`;
    if (item.kind === 'leave') return `${r.start_date || '—'} → ${r.end_date || '—'} • ${r.requested_units ?? '—'} unit(s)`;
    if (item.kind === 'advance') return `${formatMoney(r.principal_amount, r.currency_code || '')} • ${String(r.advance_type || 'advance').replaceAll('_',' ')} • ${r.issue_date || '—'}`;
    return 'Pending Workforce item';
  }

  function approvalSecondary(item) {
    const r = item.record || {};
    if (item.kind === 'salary') return r.notes || 'Salary change awaiting checker review.';
    if (item.kind === 'transport') return r.reason || 'Transport override awaiting checker review.';
    if (item.kind === 'attendance') return r.notes || 'Attendance record awaiting approval.';
    if (item.kind === 'leave') return r.reason || 'Leave request awaiting approval.';
    if (item.kind === 'advance') return r.purpose || r.notes || 'Advance / loan awaiting approval.';
    return '';
  }

  function renderApprovalQueue() {
    const host = $('wfApprovalQueue');
    if (!host) return;
    const filter = $('wfApprovalFilter')?.value || 'all';
    const items = (state.approvals || []).filter(item => filter === 'all' || item.kind === filter);

    if (!items.length) {
      host.innerHTML = '<div class="wf-empty-card">No pending items in this view.</div>';
      return;
    }

    host.innerHTML = items.map(item => {
      const r = item.record || {};
      const employee = item.employee || {};
      const employeeLabel = employee.full_name || employee.employee_code || 'Company-level item';
      const selfMade = !!(state.makerCheckerRequired && r.created_by && state.session?.user?.id && r.created_by === state.session.user.id);
      const created = r.created_at ? new Date(r.created_at).toLocaleString() : '';
      const disabled = selfMade ? 'disabled' : '';
      const checkerText = selfMade ? '<span class="wf-checker-note">Maker-checker: another authorised user must review this item.</span>' : '';
      return `<article class="wf-approval-item" data-kind="${escapeHtml(item.kind)}" data-id="${escapeHtml(r.id)}">
        <div class="wf-approval-item-main">
          <div class="wf-approval-item-top">
            <span class="wf-type-pill ${escapeHtml(item.kind)}">${escapeHtml(item.label)}</span>
            <span class="wf-pending-pill">PENDING</span>
          </div>
          <h3>${escapeHtml(employeeLabel)}</h3>
          <p class="wf-approval-detail">${escapeHtml(approvalDetail(item))}</p>
          <p class="wf-approval-secondary">${escapeHtml(approvalSecondary(item))}</p>
          <div class="wf-approval-meta">${employee.employee_code ? `<span>${escapeHtml(employee.employee_code)}</span>` : ''}${created ? `<span>${escapeHtml(created)}</span>` : ''}</div>
          ${checkerText}
        </div>
        <div class="wf-approval-actions">
          <button class="approve" type="button" data-approval-action="approved" data-kind="${escapeHtml(item.kind)}" data-id="${escapeHtml(r.id)}" ${disabled}>Approve</button>
          <button class="reject" type="button" data-approval-action="rejected" data-kind="${escapeHtml(item.kind)}" data-id="${escapeHtml(r.id)}" ${disabled}>Reject</button>
        </div>
      </article>`;
    }).join('');
  }

  async function fetchApprovalSource(source) {
    try {
      const { data, error } = await state.client
        .from(source.table)
        .select('*')
        .eq('company_id', state.workspace.companyId)
        .eq('approval_status', 'pending')
        .order('created_at', { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data || []).map(record => ({ ...source, record }));
    } catch (error) {
      console.warn(`[Approval Center] ${source.table} unavailable`, error?.message || error);
      return [];
    }
  }

  async function loadApprovalCenter() {
    if (!state.workspace?.companyId || state.approvalsBusy) return;
    state.approvalsBusy = true;
    $('wfApprovalRefresh').disabled = true;
    approvalMessage('Refreshing pending approvals…', 'info');
    try {
      try {
        const { data: settings } = await state.client
          .from('wf_company_settings')
          .select('maker_checker_required')
          .eq('company_id', state.workspace.companyId)
          .maybeSingle();
        state.makerCheckerRequired = settings?.maker_checker_required !== false;
      } catch (_) {
        state.makerCheckerRequired = true;
      }

      const groups = await Promise.all(APPROVAL_SOURCES.map(fetchApprovalSource));
      const queue = groups.flat();
      const employeeIds = [...new Set(queue.map(item => item.record?.employee_id).filter(Boolean))];
      const employeeMap = await fetchNameMap('employees', employeeIds, 'id,employee_code,full_name');
      queue.forEach(item => { item.employee = employeeMap.get(item.record?.employee_id) || null; });
      state.approvals = queue;

      const count = kind => queue.filter(item => item.kind === kind).length;
      const salary = count('salary');
      const transport = count('transport');
      const other = count('attendance') + count('leave') + count('advance');
      $('wfApprovalKpiTotal').textContent = String(queue.length);
      $('wfApprovalKpiSalary').textContent = String(salary);
      $('wfApprovalKpiTransport').textContent = String(transport);
      $('wfApprovalKpiOther').textContent = String(other);
      $('wfNavApprovalCount').textContent = queue.length ? String(queue.length) : '';
      renderApprovalQueue();

      if (!queue.length) approvalMessage('No pending approvals. Everything in the current scope is clear.', 'success');
      else if (state.makerCheckerRequired && queue.some(item => item.record?.created_by === state.session?.user?.id)) approvalMessage(`${queue.length} pending item(s). Items created by this same user require another authorised checker.`, 'warning');
      else approvalMessage(`${queue.length} pending item(s) ready for authorised review.`, 'success');
    } catch (error) {
      console.error('[Approval Center]', error);
      approvalMessage(error?.message || 'Unable to load approvals.', 'error');
    } finally {
      state.approvalsBusy = false;
      $('wfApprovalRefresh').disabled = false;
    }
  }

  async function actOnApproval(kind, id, action) {
    const item = (state.approvals || []).find(x => x.kind === kind && x.record?.id === id);
    if (!item) return;
    if (!['approved','rejected'].includes(action)) return;

    if (state.makerCheckerRequired && item.record?.created_by && item.record.created_by === state.session?.user?.id) {
      approvalMessage('Maker-checker is enabled. This item must be reviewed by another authorised user.', 'warning');
      return;
    }

    const verb = action === 'approved' ? 'Approve' : 'Reject';
    if (!window.confirm(`${verb} this ${item.label.toLowerCase()} item for ${item.employee?.full_name || item.employee?.employee_code || 'this record'}?`)) return;

    approvalMessage(`${verb} in progress…`, 'info');
    document.querySelectorAll('[data-approval-action]').forEach(btn => { btn.disabled = true; });
    try {
      const payload = {
        approval_status: action,
        reviewed_by: state.session.user.id,
        reviewed_at: new Date().toISOString(),
        updated_by: state.session.user.id
      };
      const { data, error } = await state.client
        .from(item.table)
        .update(payload)
        .eq('company_id', state.workspace.companyId)
        .eq('id', id)
        .eq('approval_status', 'pending')
        .select('id,approval_status')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('The item was not changed. It may have been reviewed already or your role may be view-only.');

      approvalMessage(`${item.label} ${action === 'approved' ? 'approved' : 'rejected'} successfully.`, 'success');
      await Promise.all([loadApprovalCenter(), loadApprovalBreakdown()]);
    } catch (error) {
      console.error('[Approval Center Action]', error);
      approvalMessage(error?.message || 'Approval action failed.', 'error');
      renderApprovalQueue();
    }
  }

  async function loadDashboard() {
    if (!state.workspace?.companyId || state.dashboardBusy) return;
    state.dashboardBusy = true;
    const refresh = $('wfDashboardRefresh');
    if (refresh) refresh.disabled = true;
    dashboardMessage('Refreshing live Workforce data…', 'info');

    const today = companyLocalDate();
    $('wfDashboardDate').textContent = humanDate(today);
    $('wfAttendanceDateBadge').textContent = today;

    try {
      const [employees, sites, attendance] = await Promise.all([
        safeCount('employees', [['eq','is_deleted',false], ['eq','status','active']]),
        safeCount('wf_sites', [['eq','is_active',true]]),
        fetchAttendanceToday(today)
      ]);

      $('wfKpiEmployees').textContent = employees === null ? '—' : String(employees);
      $('wfKpiSites').textContent = sites === null ? '—' : String(sites);

      if (attendance) {
        const present = attendance.filter(r => ['present','late','half_day'].includes(String(r.attendance_status || '').toLowerCase())).length;
        const late = attendance.filter(r => String(r.attendance_status || '').toLowerCase() === 'late').length;
        const absent = attendance.filter(r => ['absent','no_show'].includes(String(r.attendance_status || '').toLowerCase())).length;
        const pending = attendance.filter(r => String(r.approval_status || '').toLowerCase() === 'pending').length;
        $('wfKpiPresent').textContent = String(present);
        $('wfKpiAttendanceNote').textContent = `${attendance.length} attendance record${attendance.length === 1 ? '' : 's'} today`;
        $('wfTodayPresent').textContent = String(present);
        $('wfTodayLate').textContent = String(late);
        $('wfTodayAbsent').textContent = String(absent);
        $('wfTodayPending').textContent = String(pending);

        const [employeeMap, siteMap] = await Promise.all([
          fetchNameMap('employees', attendance.map(r => r.employee_id), 'id,employee_code,full_name'),
          fetchNameMap('wf_sites', attendance.map(r => r.site_id), 'id,name')
        ]);
        renderTodayAttendance(attendance, employeeMap, siteMap);
      } else {
        $('wfKpiPresent').textContent = '—';
        $('wfKpiAttendanceNote').textContent = 'Attendance data unavailable';
        $('wfTodayPresent').textContent = '—';
        $('wfTodayLate').textContent = '—';
        $('wfTodayAbsent').textContent = '—';
        $('wfTodayPending').textContent = '—';
        renderTodayAttendance(null, new Map(), new Map());
      }

      await Promise.all([
        loadApprovalBreakdown(),
        loadPayrollSummary(),
        loadDashboardImports()
      ]);

      state.dashboardLoaded = true;
      dashboardMessage('Dashboard refreshed from the live Workforce DEV database.', 'success');
    } catch (error) {
      console.error('[Workforce Dashboard]', error);
      dashboardMessage(error?.message || 'Dashboard refresh failed.', 'error');
    } finally {
      state.dashboardBusy = false;
      if (refresh) refresh.disabled = false;
    }
  }

  function payrollMessage(text, tone = 'info') {
    const el = $('wfPayrollMessage');
    if (!el) return;
    el.className = `wf-message ${tone}`;
    el.textContent = text;
  }

  function money(value, currency = '') {
    const n = Number(value || 0);
    return `${n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}${currency ? ` ${currency}` : ''}`;
  }

  function firstValue(obj, keys, fallback = 0) {
    for (const key of keys) if (obj && obj[key] != null) return obj[key];
    return fallback;
  }

  function selectedRun() {
    const id = $('wfPayrollRunSelect')?.value;
    return state.payrollRuns.find(r => r.id === id) || null;
  }

  function setPayrollBusy(busy) {
    state.payrollBusy = busy;
    ['wfPayrollRefresh','wfPayrollNewBtn','wfPayrollPreflightBtn','wfPayrollCalculateBtn','wfPayrollSubmitBtn','wfPayrollApproveBtn','wfPayrollRejectBtn','wfPayrollFinalizeBtn','wfPayrollReopenBtn'].forEach(id => {
      const el = $(id); if (el) el.disabled = busy || el.disabled;
    });
  }

  function updatePayrollActions(run) {
    const status = String(run?.status || '').toLowerCase();
    const has = !!run && !state.payrollBusy;
    $('wfPayrollPreflightBtn').disabled = !has || !['draft','preflight_failed','ready','reopened','rejected'].includes(status);
    $('wfPayrollCalculateBtn').disabled = !has || !['ready','reopened','rejected'].includes(status);
    $('wfPayrollSubmitBtn').disabled = !has || status !== 'ready';
    $('wfPayrollApproveBtn').disabled = !has || status !== 'pending_approval';
    $('wfPayrollRejectBtn').disabled = !has || status !== 'pending_approval';
    $('wfPayrollFinalizeBtn').disabled = !has || status !== 'approved';
    $('wfPayrollReopenBtn').disabled = !has || status !== 'finalized';
  }

  function payrollIssueAction(code) {
    const key = String(code || '').toUpperCase();
    const actions = {
      ATTENDANCE_MISSING: 'Add and approve attendance for this payroll period.',
      SALARY_MISSING_APPROVED: 'Add an effective salary record and have it approved.',
      TRANSPORT_UNRESOLVED: 'Complete the employee/site transport setup and approve it.',
      SALARY_CHANGE_WITHIN_PERIOD: 'Resolve the salary effective-date change before calculation.'
    };
    return actions[key] || 'Review this employee payroll setup, correct the issue, then run Preflight again.';
  }

  function renderPayrollIssues(rows, employeeMap = {}) {
    const host = $('wfPayrollIssues');
    const badge = $('wfPayIssueBadge');
    if (!host || !badge) return;
    const issues = rows || [];
    badge.textContent = `${issues.length} ISSUE${issues.length === 1 ? '' : 'S'}`;
    badge.className = `wf-badge ${issues.some(x => String(x.severity||x.issue_level||'').toLowerCase()==='error') ? 'rejected' : issues.length ? 'open' : 'approved'}`;
    if (!issues.length) { host.innerHTML = '<div class="wf-empty-card">No preflight issues. Payroll is clear at the last check.</div>'; return; }
    host.innerHTML = issues.map(x => {
      const level = String(x.severity || x.issue_level || x.level || 'warning').toLowerCase();
      const code = x.issue_code || x.code || x.issue_type || level.toUpperCase();
      const detail = x.message || x.issue_message || x.details || x.description || 'Payroll readiness issue.';
      const emp = employeeMap[x.employee_id] || {};
      const name = x.employee_name || x.employee_name_snapshot || emp.full_name || 'Employee';
      const employeeCode = x.employee_code || x.employee_code_snapshot || emp.employee_code || '';
      const severityLabel = level === 'error' ? 'ERROR' : level === 'warning' ? 'WARNING' : level.toUpperCase();
      return `<div class="wf-issue-row ${escapeHtml(level)}">
        <div class="wf-issue-top"><div><b>${escapeHtml(name)}</b>${employeeCode ? `<span class="wf-issue-employee-code">${escapeHtml(employeeCode)}</span>` : ''}</div><span class="wf-issue-severity ${escapeHtml(level)}">${escapeHtml(severityLabel)}</span></div>
        <div class="wf-issue-code">${escapeHtml(code)}</div>
        <small>${escapeHtml(typeof detail === 'string' ? detail : JSON.stringify(detail))}</small>
        <div class="wf-issue-action"><strong>ACTION</strong><span>${escapeHtml(payrollIssueAction(code))}</span></div>
      </div>`;
    }).join('');
  }

  function renderPayrollResults(rows, currency, profileMap = {}, period = {}, itemsBySnapshot = {}) {
    const host = $('wfPayrollResults');
    $('wfPayResultCount').textContent = `${rows.length} employee${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) { host.innerHTML = '<tr><td colspan="7" class="empty">No calculated payroll results yet.</td></tr>'; return; }
    host.innerHTML = rows.map(r => {
      const name = firstValue(r,['employee_name_snapshot','employee_name','full_name'],'Employee');
      const code = firstValue(r,['employee_code_snapshot','employee_code'],'');
      // base_salary_amount is the contractual monthly rate. For review we must show
      // the CALCULATED BASE item amount (e.g. first-month proration), not the rate.
      const snapshotItems = itemsBySnapshot[r.id] || [];
      const baseItem = snapshotItems.find(x => String(x.code || '').toUpperCase() === 'BASE' || String(x.category || '').toLowerCase() === 'base_salary');
      const basic = baseItem ? Number(baseItem.amount || 0) : firstValue(r,['base_pay','calculated_base_pay','basic_pay','base_salary_amount','basic_salary','base_amount'],0);
      const transport = firstValue(r,['transport_amount','transport_total'],0);
      const gross = firstValue(r,['gross_earnings','gross_amount','gross_total'], Number(basic)+Number(transport));
      const ded = firstValue(r,['total_deductions','deduction_amount','deduction_total'],0);
      const net = firstValue(r,['net_pay','net_amount','net_total','net_salary'], Number(gross)-Number(ded));
      const profile = profileMap[r.employee_id] || {};
      let proration = 'Full month';
      const hire = profile.hire_date;
      if (hire && period.period_start && period.period_end && hire > period.period_start && hire <= period.period_end) {
        const start = new Date(`${period.period_start}T12:00:00`);
        const end = new Date(`${period.period_end}T12:00:00`);
        const hired = new Date(`${hire}T12:00:00`);
        const days = Math.round((end - start) / 86400000) + 1;
        const payable = Math.round((end - hired) / 86400000) + 1;
        const pct = days > 0 ? ((payable / days) * 100).toFixed(2) : '0.00';
        proration = `${payable}/${days} days • ${pct}%`;
      }
      return `<tr><td><b>${escapeHtml(name)}</b>${code ? `<small class="wf-cell-sub">${escapeHtml(code)}</small>`:''}</td><td>${escapeHtml(money(basic,currency))}</td><td><b>${escapeHtml(proration)}</b>${hire ? `<small class="wf-cell-sub">Hire: ${escapeHtml(formatDateDMY(hire))}</small>` : ''}</td><td>${escapeHtml(money(transport,currency))}</td><td>${escapeHtml(money(gross,currency))}</td><td class="wf-money-deduct">${escapeHtml(money(ded,currency))}</td><td class="wf-money-net">${escapeHtml(money(net,currency))}</td></tr>`;
    }).join('');
  }

  async function loadPayrollRunDetail() {
    const run = selectedRun();
    state.selectedPayrollRun = run;
    if (!run) {
      $('wfPayStatus').textContent='—'; $('wfPayPeriod').textContent='No run selected'; $('wfPayEmployees').textContent='—'; $('wfPayGross').textContent='—'; $('wfPayNet').textContent='—'; $('wfPayDeductions').textContent='—';
      renderPayrollIssues([]); renderPayrollResults([], '', {}, {}); updatePayrollActions(null); return;
    }
    const period = state.payrollPeriods.find(p => p.id === run.payroll_period_id) || {};
    const currency = period.currency_code || 'SLE';
    $('wfPayStatus').textContent = String(run.status || 'draft').replaceAll('_',' ').toUpperCase();
    $('wfPayPeriod').textContent = `${period.period_code || run.run_label || 'Payroll'}${period.period_start ? ` • ${formatDateDMY(period.period_start)} → ${formatDateDMY(period.period_end)}` : ''}`;
    $('wfPayCurrency').textContent = currency;
    $('wfPayGross').textContent = money(run.gross_total,currency);
    $('wfPayDeductions').textContent = money(run.deduction_total,currency);
    $('wfPayNet').textContent = money(run.net_total,currency);
    $('wfNavPayrollStatus').textContent = String(run.status || '').replaceAll('_',' ');
    updatePayrollActions(run);

    const [snapRes, issueRes, itemRes] = await Promise.all([
      state.client.from('wf_payroll_employee_snapshots').select('*').eq('company_id',state.workspace.companyId).eq('payroll_run_id',run.id).order('employee_name_snapshot',{ascending:true}),
      state.client.from('wf_payroll_preflight_issues').select('*').eq('company_id',state.workspace.companyId).eq('payroll_run_id',run.id).order('created_at',{ascending:true}),
      state.client.from('wf_payroll_items').select('payroll_employee_id,employee_id,category,code,name,quantity,rate,amount,item_type').eq('company_id',state.workspace.companyId).eq('payroll_run_id',run.id)
    ]);
    const snaps = snapRes.error ? [] : (snapRes.data || []);
    const payrollItems = itemRes.error ? [] : (itemRes.data || []);
    const itemsBySnapshot = payrollItems.reduce((map, item) => {
      const key = item.payroll_employee_id;
      if (!key) return map;
      (map[key] ||= []).push(item);
      return map;
    }, {});
    const allIssues = issueRes.error ? [] : (issueRes.data || []);
    // Preflight issues are intentionally versioned for audit history.
    // The live Payroll screen must show only the newest preflight version,
    // otherwise repeated checks incorrectly stack historical issues together.
    const versionedIssues = allIssues.filter(x => Number.isFinite(Number(x.preflight_version)));
    const latestPreflightVersion = versionedIssues.length
      ? Math.max(...versionedIssues.map(x => Number(x.preflight_version)))
      : null;
    // A successful preflight with 0 issues creates no issue rows for its new version.
    // In that case the run itself is READY, so historical issue rows must not be shown
    // as if they still belong to the latest check.
    const runIsReady = String(run.status || '').toLowerCase() === 'ready';
    const issues = runIsReady
      ? []
      : (latestPreflightVersion == null
          ? allIssues
          : allIssues.filter(x => Number(x.preflight_version) === latestPreflightVersion));
    const issueEmployeeIds = [...new Set(issues.map(x => x.employee_id).filter(Boolean))];
    let issueEmployeeMap = {};
    if (issueEmployeeIds.length) {
      const empRes = await state.client.from('employees').select('id,employee_code,full_name').eq('company_id',state.workspace.companyId).in('id',issueEmployeeIds);
      if (!empRes.error) issueEmployeeMap = Object.fromEntries((empRes.data || []).map(e => [e.id,e]));
    }
    const snapEmployeeIds = [...new Set(snaps.map(x => x.employee_id).filter(Boolean))];
    let payrollProfileMap = {};
    if (snapEmployeeIds.length) {
      const profileRes = await state.client.from('wf_employee_profiles').select('employee_id,hire_date').eq('company_id',state.workspace.companyId).in('employee_id',snapEmployeeIds);
      if (!profileRes.error) payrollProfileMap = Object.fromEntries((profileRes.data || []).map(p => [p.employee_id,p]));
    }
    $('wfPayEmployees').textContent = String(snaps.length || run.employee_count || 0);
    renderPayrollResults(snaps,currency,payrollProfileMap,period,itemsBySnapshot); renderPayrollIssues(issues, issueEmployeeMap);
    const runPreflightVersion = Number(firstValue(run,['preflight_version','last_preflight_version','latest_preflight_version'],0)) || null;
    const displayPreflightVersion = runPreflightVersion || latestPreflightVersion;
    const versionNote = displayPreflightVersion == null ? '' : ` • preflight v${displayPreflightVersion}`;
    payrollMessage(`Payroll ${String(run.status||'draft').replaceAll('_',' ')} • ${snaps.length} employee snapshot(s)${versionNote}.`, issues.some(x=>String(x.severity||x.issue_level||'').toLowerCase()==='error') ? 'warning' : 'success');
  }

  async function loadPayroll() {
    if (!state.workspace?.companyId || state.payrollBusy) return;
    state.payrollBusy = true; payrollMessage('Loading payroll control…','info');
    try {
      const [periodRes, runRes] = await Promise.all([
        state.client.from('wf_payroll_periods').select('*').eq('company_id',state.workspace.companyId).order('period_start',{ascending:false}),
        state.client.from('wf_payroll_runs').select('*').eq('company_id',state.workspace.companyId).order('created_at',{ascending:false})
      ]);
      if (periodRes.error) throw periodRes.error; if (runRes.error) throw runRes.error;
      state.payrollPeriods = periodRes.data || []; state.payrollRuns = runRes.data || [];
      const sel=$('wfPayrollRunSelect'); const previous=sel.value;
      sel.innerHTML = state.payrollRuns.length ? state.payrollRuns.map(r=>{ const p=state.payrollPeriods.find(x=>x.id===r.payroll_period_id)||{}; return `<option value="${escapeHtml(r.id)}">${escapeHtml(p.period_code||r.run_label||'Payroll')} • Run ${escapeHtml(r.run_sequence||1)} • ${escapeHtml(String(r.status||'draft').replaceAll('_',' ').toUpperCase())}</option>`; }).join('') : '<option value="">No payroll runs yet</option>';
      if (previous && state.payrollRuns.some(r=>r.id===previous)) sel.value=previous;
      await loadPayrollRunDetail();
    } catch(error) { console.error('[Payroll]',error); payrollMessage(error?.message||'Unable to load payroll.','error'); }
    finally { state.payrollBusy=false; if ($('wfPayrollRefresh')) $('wfPayrollRefresh').disabled=false; if ($('wfPayrollNewBtn')) $('wfPayrollNewBtn').disabled=false; updatePayrollActions(selectedRun()); }
  }

  async function createMonthlyPayrollRun() {
    if (state.payrollBusy) return;
    const now=new Date(); const y=now.getFullYear(); const m=now.getMonth()+1; const code=`${y}-${String(m).padStart(2,'0')}`;
    const start=`${code}-01`; const end=new Date(y,m,0).toISOString().slice(0,10);
    try {
      state.payrollBusy=true; payrollMessage(`Preparing monthly payroll ${code}…`,'info');
      let period=state.payrollPeriods.find(p=>p.period_code===code);
      if (!period) {
        const {data,error}=await state.client.from('wf_payroll_periods').insert({company_id:state.workspace.companyId,period_code:code,period_start:start,period_end:end,pay_date:end,payroll_type:'regular',currency_code:'SLE',status:'open',notes:'Created from Workforce Payroll UI'}).select('*').single();
        if(error) throw error; period=data;
      }
      const existing=state.payrollRuns.filter(r=>r.payroll_period_id===period.id);
      const seq=existing.reduce((n,r)=>Math.max(n,Number(r.run_sequence||0)),0)+1;
      const {error}=await state.client.from('wf_payroll_runs').insert({company_id:state.workspace.companyId,payroll_period_id:period.id,run_sequence:seq,run_label:`${code} Regular Payroll`,status:'draft',notes:'Created from Workforce Payroll UI'});
      if(error) throw error; payrollMessage(`Payroll ${code} created. Run preflight before calculation.`,'success'); state.payrollBusy=false; await loadPayroll();
    } catch(error) { payrollMessage(error?.message||'Unable to create payroll run.','error'); }
    finally { state.payrollBusy=false; if ($('wfPayrollRefresh')) $('wfPayrollRefresh').disabled=false; if ($('wfPayrollNewBtn')) $('wfPayrollNewBtn').disabled=false; }
  }

  async function payrollRpc(name,args,successText) {
    const run=selectedRun(); if(!run||state.payrollBusy) return;
    state.payrollBusy=true; updatePayrollActions(run); payrollMessage(`${successText}…`,'info');
    try { const {data,error}=await state.client.rpc(name,args); if(error) throw error; payrollMessage(`${successText} completed successfully.`,'success'); state.payrollBusy=false; await loadPayroll(); return data; }
    catch(error){ console.error(`[Payroll ${name}]`,error); payrollMessage(error?.message||`${successText} failed.`,'error'); }
    finally{ state.payrollBusy=false; if ($('wfPayrollRefresh')) $('wfPayrollRefresh').disabled=false; if ($('wfPayrollNewBtn')) $('wfPayrollNewBtn').disabled=false; updatePayrollActions(selectedRun()); }
  }

  async function runPayrollPreflight(){ const r=selectedRun(); if(r) await payrollRpc('wf_run_payroll_preflight',{target_company:state.workspace.companyId,target_payroll_run:r.id},'Payroll preflight'); }
  async function calculatePayroll(){ const r=selectedRun(); if(r) await payrollRpc('wf_calculate_payroll',{target_company:state.workspace.companyId,target_payroll_run:r.id},'Payroll calculation'); }
  async function submitPayroll(){ const r=selectedRun(); if(r) await payrollRpc('wf_submit_payroll_for_approval',{target_company:state.workspace.companyId,target_payroll_run:r.id},'Submit for approval'); }
  async function reviewPayroll(decision){ const r=selectedRun(); if(r) await payrollRpc('wf_review_payroll',{target_company:state.workspace.companyId,target_payroll_run:r.id,decision,review_reason:null},decision==='approved'?'Payroll approval':'Payroll rejection'); }
  async function finalizePayroll(){ const r=selectedRun(); if(r) await payrollRpc('wf_finalize_payroll',{target_company:state.workspace.companyId,target_payroll_run:r.id},'Finalize payroll'); }
  async function reopenPayroll(){ const r=selectedRun(); if(!r)return; const reason=window.prompt('Reason for reopening this finalized payroll:',''); if(!reason?.trim())return; await payrollRpc('wf_reopen_payroll',{target_company:state.workspace.companyId,target_payroll_run:r.id,reopen_reason:reason.trim()},'Reopen payroll'); }

  function setupMessage(text, tone = 'info') {
    const el = $('wfSetupMessage'); if (!el) return;
    el.className = `wf-message ${tone}`; el.textContent = text;
  }

  function selectedSetupEmployee() {
    const id = $('wfSetupEmployee')?.value || '';
    return state.setupEmployees.find(e => e.id === id) || null;
  }

  function setupStatus(elId, text, kind) {
    const el=$(elId); if(!el)return; el.textContent=text; el.className=kind||'';
  }

  function setupHistory(rows, type) {
    if (!rows?.length) return `No ${type} records yet.`;
    return rows.slice(0,5).map(r => {
      if (type === 'salary') return `<div class="row"><b>${escapeHtml(r.pay_basis)} • ${escapeHtml(r.base_amount)} ${escapeHtml(r.currency_code||'SLE')}</b><br>${escapeHtml(formatDateDMY(r.effective_from))} • ${escapeHtml(String(r.approval_status||'').toUpperCase())}</div>`;
      if (type === 'transport') return `<div class="row"><b>${escapeHtml(String(r.method||'').replaceAll('_',' '))} • ${escapeHtml(r.amount ?? '—')}</b><br>${escapeHtml(formatDateDMY(r.effective_from))} • ${escapeHtml(String(r.approval_status||'').toUpperCase())}</div>`;
      return `<div class="row"><b>${escapeHtml(formatDateDMY(r.work_date))} • ${escapeHtml(String(r.attendance_status||'').replaceAll('_',' '))}</b><br>${escapeHtml(r.attendance_units ?? 0)} unit • ${escapeHtml(String(r.approval_status||'').toUpperCase())}</div>`;
    }).join('');
  }

  async function loadPayrollSetup() {
    if (!state.workspace?.companyId || state.setupBusy) return;
    state.setupBusy=true; setupMessage('Loading employee payroll setup…','info');
    try {
      const {data,error}=await state.client.from('employees').select('id,employee_code,full_name,job_title,department,status,is_deleted').eq('company_id',state.workspace.companyId).eq('is_deleted',false).eq('status','active').order('employee_code',{ascending:true});
      if(error) throw error;
      state.setupEmployees=data||[];
      const sel=$('wfSetupEmployee'); const previous=sel.value;
      sel.innerHTML=state.setupEmployees.length ? state.setupEmployees.map(e=>`<option value="${escapeHtml(e.id)}">${escapeHtml(e.employee_code||'NO CODE')} • ${escapeHtml(e.full_name||'Unnamed Employee')}</option>`).join('') : '<option value="">No active employees</option>';
      if(previous && state.setupEmployees.some(e=>e.id===previous)) sel.value=previous;
      const today=formatDateDMY(new Date().toISOString().slice(0,10));
      if(!$('wfSetupSalaryDate').value) $('wfSetupSalaryDate').value=today;
      if(!$('wfSetupTransportDate').value) $('wfSetupTransportDate').value=today;
      if(!$('wfSetupAttendanceDate').value) $('wfSetupAttendanceDate').value=today;
      await loadSelectedPayrollSetup();
    } catch(error){ console.error('[Payroll Setup]',error); setupMessage(error?.message||'Unable to load payroll setup.','error'); }
    finally{state.setupBusy=false;}
  }

  async function loadSelectedPayrollSetup() {
    const emp=selectedSetupEmployee();
    if(!emp){ $('wfSetupEmployeeMeta').textContent='No active employee selected.'; return; }
    $('wfSetupEmployeeMeta').textContent=`${emp.employee_code||'NO CODE'} • ${emp.full_name||'Unnamed Employee'} • ${emp.department||'No department'} • ${emp.job_title||'No job title'}`;
    setupMessage('Reading approved and pending payroll inputs…','info');
    try {
      const [profileRes,salaryRes,transportRes,attendanceRes]=await Promise.all([
        state.client.from('wf_employee_profiles').select('hire_date,payroll_eligible,employment_status').eq('company_id',state.workspace.companyId).eq('employee_id',emp.id).maybeSingle(),
        state.client.from('wf_employee_salary_history').select('*').eq('company_id',state.workspace.companyId).eq('employee_id',emp.id).order('effective_from',{ascending:false}),
        state.client.from('wf_transport_employee_overrides').select('*').eq('company_id',state.workspace.companyId).eq('employee_id',emp.id).order('effective_from',{ascending:false}),
        state.client.from('wf_attendance_records').select('*').eq('company_id',state.workspace.companyId).eq('employee_id',emp.id).order('work_date',{ascending:false}).limit(31)
      ]);
      if(profileRes.error)throw profileRes.error;if(salaryRes.error)throw salaryRes.error;if(transportRes.error)throw transportRes.error;if(attendanceRes.error)throw attendanceRes.error;
      const profile=profileRes.data||null, salaries=salaryRes.data||[], transports=transportRes.data||[], attendance=attendanceRes.data||[];
      $('wfSetupHireDate').value=formatDateDMY(profile?.hire_date||'');
      $('wfSetupHireDateSave').disabled=!profile;
      const salApproved=salaries.find(r=>r.approval_status==='approved'), salPending=salaries.find(r=>r.approval_status==='pending');
      const trApproved=transports.find(r=>r.approval_status==='approved' && r.is_active!==false), trPending=transports.find(r=>r.approval_status==='pending');
      const attApproved=attendance.filter(r=>r.approval_status==='approved').length, attPending=attendance.filter(r=>r.approval_status==='pending').length;
      setupStatus('wfSetupSalaryState',salApproved?'APPROVED':(salPending?'PENDING':'MISSING'),salApproved?'ok':(salPending?'pending':'missing'));
      setupStatus('wfSetupTransportState',trApproved?'APPROVED':(trPending?'PENDING':'MISSING'),trApproved?'ok':(trPending?'pending':'missing'));
      setupStatus('wfSetupAttendanceState',attApproved?`${attApproved} APPROVED`:(attPending?`${attPending} PENDING`:'MISSING'),attApproved?'ok':(attPending?'pending':'missing'));
      $('wfSetupSalaryHistory').innerHTML=setupHistory(salaries,'salary');
      $('wfSetupTransportHistory').innerHTML=setupHistory(transports,'transport');
      $('wfSetupAttendanceHistory').innerHTML=setupHistory(attendance,'attendance');
      setupMessage('Payroll setup loaded. New records are submitted as Pending for maker-checker approval.','success');
    } catch(error){console.error('[Payroll Setup employee]',error);setupMessage(error?.message||'Unable to read employee payroll setup.','error');}
  }

  async function saveSetupHireDate(){
    const emp=selectedSetupEmployee(), rawDate=$('wfSetupHireDate').value, date=parseDateDMY(rawDate);
    if(!emp)return setupMessage('Select an employee first.','warning');
    if(!date)return setupMessage('Enter hire date as DD/MM/YYYY.','warning');
    try{
      state.setupBusy=true;
      const {data,error}=await state.client.from('wf_employee_profiles').update({hire_date:date}).eq('company_id',state.workspace.companyId).eq('employee_id',emp.id).select('hire_date').maybeSingle();
      if(error)throw error;
      if(!data)throw new Error('No Workforce profile was updated for this employee.');
      await loadSelectedPayrollSetup();
      setupMessage(`✓ Hire date saved: ${formatDateDMY(data.hire_date || date)}. Monthly payroll will prorate the first employment month automatically.`,'success');
    }catch(error){setupMessage(error?.message||'Unable to save hire date.','error');}
    finally{state.setupBusy=false;}
  }

  async function saveSetupSalary(){
    const emp=selectedSetupEmployee(), amount=Number($('wfSetupSalaryAmount').value), date=parseDateDMY($('wfSetupSalaryDate').value), basis=$('wfSetupPayBasis').value;
    if(!emp)return setupMessage('Select an employee first.','warning'); if(!date||!Number.isFinite(amount)||amount<0)return setupMessage('Enter a valid salary amount and date as DD/MM/YYYY.','warning');
    if(basis==='monthly' && !date.endsWith('-01'))return setupMessage('Monthly salary changes must start on the first day of a payroll month.','warning');
    try{state.setupBusy=true;const {error}=await state.client.from('wf_employee_salary_history').insert({company_id:state.workspace.companyId,employee_id:emp.id,pay_basis:basis,base_amount:amount,currency_code:'SLE',effective_from:date,effective_to:null,approval_status:'pending',notes:'Created from Workforce Payroll Setup'});if(error)throw error;$('wfSetupSalaryAmount').value='';setupMessage('Salary submitted as PENDING. Approve it from Approval Center with another authorised user when maker-checker applies.','success');await loadSelectedPayrollSetup();await loadApprovalCenter();}catch(error){setupMessage(error?.message||'Unable to submit salary.','error');}finally{state.setupBusy=false;}
  }

  async function saveSetupTransport(){
    const emp=selectedSetupEmployee(), amount=Number($('wfSetupTransportAmount').value), date=parseDateDMY($('wfSetupTransportDate').value), method=$('wfSetupTransportMethod').value;
    if(!emp)return setupMessage('Select an employee first.','warning'); if(!date||!Number.isFinite(amount)||amount<0)return setupMessage('Enter a valid transport amount and date as DD/MM/YYYY.','warning');
    try{state.setupBusy=true;const {error}=await state.client.from('wf_transport_employee_overrides').insert({company_id:state.workspace.companyId,employee_id:emp.id,method,amount,effective_from:date,effective_to:null,approval_status:'pending',is_active:true,reason:'Created from Workforce Payroll Setup'});if(error)throw error;$('wfSetupTransportAmount').value='';setupMessage('Transport submitted as PENDING for approval.','success');await loadSelectedPayrollSetup();await loadApprovalCenter();}catch(error){setupMessage(error?.message||'Unable to submit transport.','error');}finally{state.setupBusy=false;}
  }

  async function ensureAttendancePeriod(date){
    const d=new Date(`${date}T00:00:00`); const start=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; const end=new Date(d.getFullYear(),d.getMonth()+1,0).toISOString().slice(0,10);
    let {data,error}=await state.client.from('wf_attendance_periods').select('*').eq('company_id',state.workspace.companyId).eq('period_start',start).eq('period_end',end).maybeSingle(); if(error)throw error;
    if(!data){const res=await state.client.from('wf_attendance_periods').insert({company_id:state.workspace.companyId,period_start:start,period_end:end,status:'open',notes:'Created from Workforce Payroll Setup'}).select('*').single();if(res.error)throw res.error;data=res.data;} return data;
  }

  async function saveSetupAttendance(){
    const emp=selectedSetupEmployee(), date=parseDateDMY($('wfSetupAttendanceDate').value), status=$('wfSetupAttendanceStatus').value, units=Number($('wfSetupAttendanceUnits').value);
    if(!emp)return setupMessage('Select an employee first.','warning'); if(!date||!Number.isFinite(units)||units<0||units>1)return setupMessage('Enter a valid attendance date and units from 0 to 1.','warning');
    try{state.setupBusy=true;const period=await ensureAttendancePeriod(date);const {error}=await state.client.from('wf_attendance_records').insert({company_id:state.workspace.companyId,employee_id:emp.id,attendance_period_id:period.id,work_date:date,attendance_status:status,attendance_units:units,worked_minutes:0,late_minutes:0,early_leave_minutes:0,overtime_minutes:0,source:'manual',approval_status:'pending',notes:'Created from Workforce Payroll Setup'});if(error)throw error;setupMessage('Attendance submitted as PENDING for approval.','success');await loadSelectedPayrollSetup();await loadApprovalCenter();}catch(error){setupMessage(error?.message||'Unable to submit attendance.','error');}finally{state.setupBusy=false;}
  }

  function showSection(section) {
    const target = ['dashboard','import','approvals','setup','payroll'].includes(section) ? section : 'dashboard';
    state.currentSection = target;
    const dashboard = $('wfDashboardView');
    const imports = $('wfImportView');
    const approvals = $('wfApprovalView');
    const setup = $('wfSetupView');
    const payroll = $('wfPayrollView');
    if (dashboard) dashboard.hidden = target !== 'dashboard';
    if (imports) imports.hidden = target !== 'import';
    if (approvals) approvals.hidden = target !== 'approvals';
    if (setup) setup.hidden = target !== 'setup';
    if (payroll) payroll.hidden = target !== 'payroll';

    document.querySelectorAll('.wf-nav button[data-section]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.section === target);
    });

    if (target === 'dashboard') {
      $('wfPageTitle').textContent = 'Workforce Dashboard';
      $('wfPageSubtitle').textContent = 'Daily workforce, attendance, approvals and payroll visibility.';
      window.location.hash = 'dashboard';
      // Keep the last live values on screen when returning from another
      // Workforce page. Refresh only on first load or via Refresh Dashboard.
      if (state.workspace?.companyId && !state.dashboardLoaded) loadDashboard();
    } else if (target === 'approvals') {
      $('wfPageTitle').textContent = 'Approval Center';
      $('wfPageSubtitle').textContent = 'Review pending Workforce changes with maker-checker protection.';
      window.location.hash = 'approvals';
      if (state.workspace?.companyId) loadApprovalCenter();
    } else if (target === 'setup') {
      $('wfPageTitle').textContent = 'Employee Payroll Setup';
      $('wfPageSubtitle').textContent = 'Prepare salary, transport and attendance inputs for payroll.';
      window.location.hash = 'setup';
      if (state.workspace?.companyId) loadPayrollSetup();
    } else if (target === 'payroll') {
      $('wfPageTitle').textContent = 'Payroll';
      $('wfPageSubtitle').textContent = 'Preflight, calculate, review, approve and finalize payroll safely.';
      window.location.hash = 'payroll';
      if (state.workspace?.companyId) loadPayroll();
    } else {
      $('wfPageTitle').textContent = 'Excel Import Center';
      $('wfPageSubtitle').textContent = 'Stage, validate, preview and confirm workforce data safely.';
      window.location.hash = 'import';
      if (state.workspace?.companyId) reloadHistory();
    }
  }

  function bindUi() {
    document.querySelectorAll('.wf-nav button[data-section]').forEach(button => {
      if (button.disabled) return;
      button.addEventListener('click', () => showSection(button.dataset.section));
    });
    $('wfDashboardRefresh')?.addEventListener('click', loadDashboard);
    $('wfSidebarBackDashboard')?.addEventListener('click', () => showSection('dashboard'));
    $('wfDashboardOpenImport')?.addEventListener('click', () => showSection('import'));
    $('wfApprovalRefresh')?.addEventListener('click', loadApprovalCenter);
    $('wfSetupRefresh')?.addEventListener('click', loadPayrollSetup);
    $('wfSetupEmployee')?.addEventListener('change', loadSelectedPayrollSetup);
    $('wfSetupHireDateSave')?.addEventListener('click', saveSetupHireDate);
    $('wfSetupSalarySave')?.addEventListener('click', saveSetupSalary);
    $('wfSetupTransportSave')?.addEventListener('click', saveSetupTransport);
    $('wfSetupAttendanceSave')?.addEventListener('click', saveSetupAttendance);
    $('wfPayrollRefresh')?.addEventListener('click', loadPayroll);
    $('wfPayrollRunSelect')?.addEventListener('change', loadPayrollRunDetail);
    $('wfPayrollNewBtn')?.addEventListener('click', createMonthlyPayrollRun);
    $('wfPayrollPreflightBtn')?.addEventListener('click', runPayrollPreflight);
    $('wfPayrollCalculateBtn')?.addEventListener('click', calculatePayroll);
    $('wfPayrollSubmitBtn')?.addEventListener('click', submitPayroll);
    $('wfPayrollApproveBtn')?.addEventListener('click', () => reviewPayroll('approved'));
    $('wfPayrollRejectBtn')?.addEventListener('click', () => reviewPayroll('rejected'));
    $('wfPayrollFinalizeBtn')?.addEventListener('click', finalizePayroll);
    $('wfPayrollReopenBtn')?.addEventListener('click', reopenPayroll);
    $('wfApprovalFilter')?.addEventListener('change', renderApprovalQueue);
    $('wfApprovalQueue')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-approval-action]');
      if (!button || button.disabled) return;
      actOnApproval(button.dataset.kind, button.dataset.id, button.dataset.approvalAction);
    });

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
      bindIdentityReturnButtons();

      const hash = String(window.location.hash || '').toLowerCase();
      const initialSection = hash === '#import' ? 'import' : (hash === '#approvals' ? 'approvals' : (hash === '#setup' ? 'setup' : (hash === '#payroll' ? 'payroll' : 'dashboard')));
      showSection(initialSection);
      loadApprovalCenter();
      await restoreRememberedBatch();
      await reloadHistory();
    } catch (error) {
      console.error('[Workforce Init]', error);
      setGate(error?.message || 'Unable to open Workforce.', true);
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();

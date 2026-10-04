(() => {
  'use strict';

  const STORAGE_KEY = 'tabaja-employees-v11';
  function activeTenantId() {
    try {
      const activeId = localStorage.getItem('tabaja_card_designer_active_account_v11');
      if (activeId) return activeId;
      const account = JSON.parse(localStorage.getItem('tabaja_card_designer_account_dev_v10') || 'null');
      return String(account?.id || account?.email || account?.company || 'default').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'default';
    } catch (_) { return 'default'; }
  }
  const tenantKey = (key) => `${key}__${activeTenantId()}`;

  let employees = [];
let photoData = '';
let loadedCompanyId = null;
let assignmentFoundation = null;

  const $ = (id) => document.getElementById(id);
  const safe = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  function loadEmployees() {
    try {
      const parsed = JSON.parse(localStorage.getItem(tenantKey(STORAGE_KEY)) || '[]');
      employees = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('Unable to load employees:', error);
      employees = [];
    }
  }

  function saveEmployees() {
  try {
    const lightCache = employees.map((employee) => ({
      ...employee,
      photo: ''
    }));

    localStorage.setItem(
      tenantKey(STORAGE_KEY),
      JSON.stringify(lightCache)
    );
  } catch (error) {
    console.warn('Unable to save employee cache:', error);
  }
}

  function fullName(employee) {
    return [employee.firstName, employee.lastName].filter(Boolean).join(' ').trim() || 'Unnamed Employee';
  }

  function initials(employee) {
    return [employee.firstName, employee.lastName].filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'E';
  }

  function updateStats() {
    $('employeeTotal').textContent = employees.length;
    $('employeeActive').textContent = employees.filter((item) => item.status === 'Active').length;
    $('employeeInactive').textContent = employees.filter((item) => item.status === 'Inactive').length;
    $('employeeDepartments').textContent = new Set(employees.map((item) => item.department.trim().toLowerCase()).filter(Boolean)).size;
  }

  function filteredEmployees() {
    const query = $('employeeSearch').value.trim().toLowerCase();
    const status = $('employeeStatusFilter').value;
    return employees.filter((employee) => {
      const text = [employee.employeeId, fullName(employee), employee.department, employee.jobTitle, employee.company, employee.email, employee.phone]
        .join(' ').toLowerCase();
      return (!query || text.includes(query)) && (status === 'all' || employee.status === status);
    });
  }

  function renderEmployees() {
    const rows = filteredEmployees();
    const tbody = $('employeeTableBody');
    const empty = $('employeeEmptyState');
    tbody.innerHTML = '';

    rows.forEach((employee) => {
      const tr = document.createElement('tr');
      const avatar = employee.photo
        ? `<img class="employee-avatar" src="${employee.photo}" alt="">`
        : `<span class="employee-avatar">${safe(initials(employee))}</span>`;
      tr.innerHTML = `
        <td>${avatar}</td>
        <td><b>${safe(employee.employeeId)}</b><span class="employee-muted">${safe(employee.company || '—')}</span></td>
        <td><span class="employee-name">${safe(fullName(employee))}</span><span class="employee-muted">${safe(employee.email || employee.phone || 'No contact details')}</span></td>
        <td>${safe(employee.department || '—')}</td>
        <td>${safe(employee.jobTitle || '—')}</td>
        <td><span class="employee-status ${employee.status.toLowerCase()}">${safe(employee.status)}</span></td>
        <td><div class="employee-actions">
          <button type="button" data-action="designer" data-key="${safe(employee.key)}">Use in Designer</button>
          <button type="button" data-action="edit" data-key="${safe(employee.key)}">Edit</button>
          <button type="button" class="danger" data-action="delete" data-key="${safe(employee.key)}">Delete</button>
        </div></td>`;
      tbody.appendChild(tr);
    });

    empty.classList.toggle('hidden', employees.length > 0 || rows.length > 0);
    if (!rows.length && employees.length) {
      empty.classList.remove('hidden');
      empty.querySelector('h3').textContent = 'No matching employees';
      empty.querySelector('p').textContent = 'Try another search or status filter.';
      $('emptyAddEmployeeBtn').style.display = 'none';
    } else {
      empty.querySelector('h3').textContent = 'No employees yet';
      empty.querySelector('p').textContent = 'Add your first employee to start building the company directory.';
      $('emptyAddEmployeeBtn').style.display = '';
    }
    updateStats();
  }

  function resetForm() {
    $('employeeForm').reset();
    $('employeeRecordKey').value = '';
    $('employeeStatusInput').value = 'Active';
    $('employeeModalTitle').textContent = 'Add Employee';
    $('employeeFormMessage').textContent = '';
    $('employeeFormMessage').className = 'employee-form-message';
    photoData = '';
    renderPhotoPreview();
  }

  function renderPhotoPreview() {
    $('employeePhotoPreview').innerHTML = photoData ? `<img src="${photoData}" alt="Employee photo preview">` : '<span>Photo</span>';
  }

  function paymentFields() {
    return {
      method: $('employeePaymentMethodInput'), accountName: $('employeePaymentAccountNameInput'),
      afrimoney: $('employeeAfrimoneyNumberInput'), bankName: $('employeeBankNameInput'), bankAccount: $('employeeBankAccountInput')
    };
  }

  function syncPaymentFields() {
    const f = paymentFields(); if (!f.method) return;
    const method = f.method.value;
    $('employeeAfrimoneyField').style.display = method === 'afrimoney' ? '' : 'none';
    $('employeeBankNameField').style.display = method === 'bank' ? '' : 'none';
    $('employeeBankAccountField').style.display = method === 'bank' ? '' : 'none';
  }

  async function loadPaymentProfile(employee) {
    const f = paymentFields(); if (!f.method) return;
    f.method.value=''; f.accountName.value=''; f.afrimoney.value=''; f.bankName.value=''; f.bankAccount.value=''; syncPaymentFields();
    const account = JSON.parse(localStorage.getItem('tabaja_card_designer_account_dev_v10') || 'null');
    const companyId = account?.companyId || account?.id;
    const employeeId = employee?.id || employee?.key;
    if (!account?.cloud || !companyId || !employeeId || !window.TabajaCloud?.loadEmployeePaymentProfile) return;
    try {
      const row = await window.TabajaCloud.loadEmployeePaymentProfile(companyId, employeeId);
      if (!row) return;
      f.method.value=row.payment_method || ''; f.accountName.value=row.account_name || '';
      f.afrimoney.value=row.afrimoney_number || ''; f.bankName.value=row.bank_name || ''; f.bankAccount.value=row.bank_account_number || '';
      syncPaymentFields();
    } catch (e) { console.warn('Unable to load payment profile:', e); }
  }

  function setReadinessValue(id, value) {
    const el = $(id); if (!el) return;
    const status = String(value || 'missing').toLowerCase();
    el.textContent = status.toUpperCase();
    el.className = `employee-readiness-value ${status}`;
  }

  async function loadPayrollReadiness(employee) {
    setReadinessValue('employeeSalaryReadiness', 'loading');
    setReadinessValue('employeeTransportReadiness', 'loading');
    setReadinessValue('employeePaymentReadiness', 'loading');
    setReadinessValue('employeeOverallReadiness', 'loading');
    const account = JSON.parse(localStorage.getItem('tabaja_card_designer_account_dev_v10') || 'null');
    const companyId = account?.companyId || account?.id;
    const employeeId = employee?.id || employee?.key;
    if (!account?.cloud || !companyId || !employeeId || !window.TabajaCloud?.loadEmployeePayrollReadiness) {
      ['employeeSalaryReadiness','employeeTransportReadiness','employeePaymentReadiness','employeeOverallReadiness'].forEach(id => setReadinessValue(id, 'not available'));
      return;
    }
    try {
      const r = await window.TabajaCloud.loadEmployeePayrollReadiness(companyId, employeeId);
      setReadinessValue('employeeSalaryReadiness', r?.salary || 'missing');
      setReadinessValue('employeeTransportReadiness', r?.transport || 'missing');
      setReadinessValue('employeePaymentReadiness', r?.paymentMethod || 'missing');
      setReadinessValue('employeeOverallReadiness', r?.ready ? 'ready' : 'not ready');
    } catch (e) {
      console.warn('Unable to load payroll readiness:', e);
      ['employeeSalaryReadiness','employeeTransportReadiness','employeePaymentReadiness','employeeOverallReadiness'].forEach(id => setReadinessValue(id, 'unavailable'));
    }
  }

  function fillSelect(id, rows, selected='', labelKey='name') {
    const el=$(id); if(!el) return;
    el.innerHTML='<option value="">Not assigned</option>' + (rows||[]).map(r=>`<option value="${safe(r.id)}">${safe(r[labelKey]||'Unnamed')}</option>`).join('');
    el.value=selected||'';
  }

  function syncAssignmentOptions() {
    if (!assignmentFoundation) return;
    const areaId=$('employeeAreaInput')?.value||'';
    const siteId=$('employeeSiteInput')?.value||'';
    const sites=(assignmentFoundation.sites||[]).filter(x=>!areaId || x.area_id===areaId);
    const keepSite=sites.some(x=>x.id===siteId)?siteId:'';
    fillSelect('employeeSiteInput',sites,keepSite);
    const posts=(assignmentFoundation.posts||[]).filter(x=>!keepSite || x.site_id===keepSite);
    const currentPost=$('employeePostInput')?.value||'';
    fillSelect('employeePostInput',posts,posts.some(x=>x.id===currentPost)?currentPost:'');
  }

  function assignmentTargetChanged() {
    const a=assignmentFoundation?.assignment; if(!a) return false;
    return (a.area_id||'')!==($('employeeAreaInput')?.value||'') || (a.site_id||'')!==($('employeeSiteInput')?.value||'') || (a.post_id||'')!==($('employeePostInput')?.value||'');
  }

  function updateTransferDateVisibility() {
    const wrap=$('employeeTransferDateWrap'); if(!wrap) return;
    wrap.classList.toggle('hidden', !assignmentTargetChanged());
  }

  function renderAssignmentHistory(f) {
    const box=$('employeeAssignmentHistory'); if(!box) return;
    const rows=f?.history||[]; if(!rows.length){ box.classList.add('hidden'); box.innerHTML=''; return; }
    const areaName=id=>(f.areas||[]).find(x=>x.id===id)?.name||'No area';
    const siteName=id=>(f.sites||[]).find(x=>x.id===id)?.name||'No site';
    const postName=id=>(f.posts||[]).find(x=>x.id===id)?.name||'No post';
    box.innerHTML='<h4>Assignment History</h4><div class="employee-assignment-history-list">'+rows.map(r=>`<div class="employee-assignment-history-row"><b>${safe(areaName(r.area_id))} → ${safe(siteName(r.site_id))}</b><span>${safe(String(r.status||'').toUpperCase())}</span><small>${safe(r.start_date||'—')} → ${safe(r.end_date||'Current')} · ${safe(postName(r.post_id))}</small></div>`).join('')+'</div>';
    box.classList.remove('hidden');
  }

  async function loadAssignmentFoundation(employee) {
    assignmentFoundation=null;
    $('employeeAssignmentState').textContent='Loading…';
    const account=JSON.parse(localStorage.getItem('tabaja_card_designer_account_dev_v10')||'null');
    const companyId=account?.companyId||account?.id, employeeId=employee?.id||employee?.key;
    if(!account?.cloud||!companyId||!employeeId||!window.TabajaCloud?.loadEmployeeAssignmentFoundation){ $('employeeAssignmentState').textContent='Not available'; return; }
    try {
      const f=await window.TabajaCloud.loadEmployeeAssignmentFoundation(companyId,employeeId); assignmentFoundation=f;
      const a=f?.assignment||null;
      fillSelect('employeeAreaInput',f?.areas||[],a?.area_id||'');
      fillSelect('employeeSiteInput',(f?.sites||[]).filter(x=>!a?.area_id||x.area_id===a.area_id),a?.site_id||'');
      fillSelect('employeePostInput',(f?.posts||[]).filter(x=>!a?.site_id||x.site_id===a.site_id),a?.post_id||'');
      $('employeeHireDateInput').value=a?.start_date||'';
      $('employeeTransferDateInput').value='';
      renderAssignmentHistory(f); updateTransferDateVisibility();
      $('employeeAssignmentState').textContent=a ? 'ACTIVE' : 'NOT ASSIGNED';
      $('employeeAssignmentHint').textContent=a ? 'Live Workforce assignment loaded.' : 'Choose Site and Hire Date to create the Workforce assignment.';
    } catch(e){ console.warn('Unable to load assignment foundation:',e); $('employeeAssignmentState').textContent='UNAVAILABLE'; $('employeeAssignmentHint').textContent='Workforce assignment could not be loaded.'; }
  }

  async function saveAssignmentIfRequested(companyId, employeeId) {
    if(!window.TabajaCloud?.saveEmployeeAssignment) return;
    const siteId=$('employeeSiteInput')?.value||'', startDate=$('employeeHireDateInput')?.value||'';
    if(!siteId && !startDate) return;
    if(!siteId || !startDate) throw new Error('Site and Hire Date must both be selected.');
    const transferDate=$('employeeTransferDateInput')?.value||'';
    if(assignmentTargetChanged() && !transferDate) throw new Error('Transfer Effective Date is required when Area, Site or Post changes.');
    await window.TabajaCloud.saveEmployeeAssignment(companyId,employeeId,{ assignmentId:assignmentFoundation?.assignment?.id||null, areaId:$('employeeAreaInput')?.value||null, siteId, postId:$('employeePostInput')?.value||null, startDate, transferDate });
  }

  function openModal(employee = null) {
    resetForm();
    if (employee) {
      $('employeeModalTitle').textContent = 'Edit Employee';
      $('employeeRecordKey').value = employee.key;
      $('employeeIdInput').value = employee.employeeId || '';
      $('employeeStatusInput').value = employee.status || 'Active';
      $('employeeFirstNameInput').value = employee.firstName || '';
      $('employeeLastNameInput').value = employee.lastName || '';
      $('employeeDepartmentInput').value = employee.department || '';
      $('employeeJobTitleInput').value = employee.jobTitle || '';
      $('employeeCompanyInput').value = employee.company || '';
      $('employeePhoneInput').value = employee.phone || '';
      $('employeeEmailInput').value = employee.email || '';
      $('employeeIssueDateInput').value = employee.issueDate || '';
      $('employeeExpiryDateInput').value = employee.expiryDate || '';
      $('employeeNotesInput').value = employee.notes || '';
      photoData = employee.photo || '';
      renderPhotoPreview();
      loadPaymentProfile(employee);
      loadPayrollReadiness(employee);
      loadAssignmentFoundation(employee);
    } else { syncPaymentFields(); fillSelect('employeeAreaInput',[]); fillSelect('employeeSiteInput',[]); fillSelect('employeePostInput',[]); $('employeeTransferDateWrap')?.classList.add('hidden'); $('employeeAssignmentHistory')?.classList.add('hidden'); $('employeeAssignmentState').textContent='Save employee first'; $('employeeAssignmentHint').textContent='Workforce assignment becomes available after the master employee is created.'; }
    $('employeeModal').classList.remove('hidden');
    setTimeout(() => $('employeeIdInput').focus(), 50);
  }

  function closeModal() {
    $('employeeModal').classList.add('hidden');
  }

  function resizePhoto(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) return reject(new Error('Please choose a valid image.'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Unable to read the selected image.'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('Unable to process the selected image.'));
        image.onload = () => {
          const maxWidth = 420;
          const maxHeight = 520;
          const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.84));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function saveForm(event) {
    event.preventDefault();
    const key = $('employeeRecordKey').value;
    const employeeId = $('employeeIdInput').value.trim();
    const firstName = $('employeeFirstNameInput').value.trim();
    const duplicate = employees.find((item) => item.employeeId.toLowerCase() === employeeId.toLowerCase() && item.key !== key);
    if (duplicate) {
      $('employeeFormMessage').textContent = 'Employee ID already exists.';
      return;
    }

    const record = {
      key: key || (crypto.randomUUID ? crypto.randomUUID() : `emp-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      employeeId,
      status: $('employeeStatusInput').value,
      firstName,
      lastName: $('employeeLastNameInput').value.trim(),
      department: $('employeeDepartmentInput').value.trim(),
      jobTitle: $('employeeJobTitleInput').value.trim(),
      company: $('employeeCompanyInput').value.trim(),
      phone: $('employeePhoneInput').value.trim(),
      email: $('employeeEmailInput').value.trim(),
      issueDate: $('employeeIssueDateInput').value,
      expiryDate: $('employeeExpiryDateInput').value,
      notes: $('employeeNotesInput').value.trim(),
      photo: photoData,
      updatedAt: new Date().toISOString()
    };

    if (!key) {
  record.createdAt = new Date().toISOString();
}

try {
  const account = JSON.parse(
    localStorage.getItem('tabaja_card_designer_account_dev_v10') || 'null'
  );

  const companyId = account?.companyId || account?.id;

  // Cloud first — Local Storage must never block the real save.
  if (
    account?.cloud &&
    companyId &&
    window.TabajaCloud?.saveEmployeeToCloud
  ) {
    const cloudId = await window.TabajaCloud.saveEmployeeToCloud(
      companyId,
      record
    );

    if (cloudId) {
      record.id = cloudId;
      record.key = cloudId;
      if (window.TabajaCloud?.saveEmployeePaymentProfile) {
        const f = paymentFields();
        await window.TabajaCloud.saveEmployeePaymentProfile(companyId, cloudId, {
          paymentMethod: f.method?.value || '', accountName: f.accountName?.value || '',
          afrimoneyNumber: f.afrimoney?.value || '', bankName: f.bankName?.value || '', bankAccountNumber: f.bankAccount?.value || ''
        });
      }
      await saveAssignmentIfRequested(companyId, cloudId);
    }
  }

  // Update local memory only after Cloud save succeeds.
  if (key) {
    const index = employees.findIndex((item) => item.key === key);

    if (index >= 0) {
      employees[index] = {
        ...employees[index],
        ...record
      };
    }
  } else {
    employees.unshift(record);
  }

  // Lightweight local cache only.
  saveEmployees();

  renderEmployees();
  closeModal();

} catch (error) {
  console.error('Unable to save employee:', error);

  $('employeeFormMessage').textContent =
    'Unable to save employee to Cloud. Please check your connection and try again.';
}
    }

  function useInDesigner(employee) {
    localStorage.setItem(tenantKey('tabaja-selected-employee-v11'), JSON.stringify(employee));
    document.querySelector('.v8-nav-btn[data-view="designer"]')?.click();
    window.dispatchEvent(new CustomEvent('tabaja:employee-selected', { detail: employee }));
    alert(`${fullName(employee)} is selected for the Card Designer.\n\nThis V11.0 test stores the selected record safely. Automatic template-field mapping comes in V11.1.`);
  }

  function handleTableClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const employee = employees.find((item) => item.key === button.dataset.key);
    if (!employee) return;
    if (button.dataset.action === 'edit') openModal(employee);
    if (button.dataset.action === 'designer') useInDesigner(employee);
    if (button.dataset.action === 'delete' && confirm(`Delete ${fullName(employee)}?`)) {
  const account = JSON.parse(
    localStorage.getItem('tabaja_card_designer_account_dev_v10') || 'null'
  );

  const companyId = account?.companyId || account?.id;

  if (
    account?.cloud &&
    companyId &&
    employee.id &&
    window.TabajaCloud?.archiveEmployeeInCloud
  ) {
    window.TabajaCloud.archiveEmployeeInCloud(companyId, employee.id)
      .then(() => {
        employees = employees.filter((item) => item.key !== employee.key);
        saveEmployees();
        renderEmployees();
      })
      .catch((error) => {
        console.error('Unable to archive employee:', error);
        alert('Unable to delete employee. Please try again.');
      });

    return;
  }

  employees = employees.filter((item) => item.key !== employee.key);
  saveEmployees();
  renderEmployees();
}
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify({ version: '11.0', exportedAt: new Date().toISOString(), employees }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tabaja-employees-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      const records = Array.isArray(data) ? data : data.employees;
      if (!Array.isArray(records)) throw new Error('Invalid backup');
      const valid = records.filter((item) => item && item.employeeId && item.firstName).map((item) => ({
        ...item,
        key: item.key || (crypto.randomUUID ? crypto.randomUUID() : `emp-${Date.now()}-${Math.random().toString(16).slice(2)}`),
        status: item.status === 'Inactive' ? 'Inactive' : 'Active'
      }));
      if (!confirm(`Import ${valid.length} employee record(s)? Existing records with the same Employee ID will be replaced.`)) return;
      const map = new Map(employees.map((item) => [item.employeeId.toLowerCase(), item]));
      valid.forEach((item) => map.set(item.employeeId.toLowerCase(), item));
      employees = Array.from(map.values());
      saveEmployees();
      renderEmployees();
    } catch (error) {
      alert('This file is not a valid Tabaja Employee backup.');
    } finally {
      $('importEmployeesFile').value = '';
    }
  }

  async function init() {
  if (!$('employeeWorkspace')) return;

  const account = JSON.parse(
    localStorage.getItem('tabaja_card_designer_account_dev_v10') || 'null'
  );

  const companyId = account?.companyId || account?.id;
loadedCompanyId = companyId || null;

  if (
    account?.cloud &&
    companyId &&
    window.TabajaCloud?.loadEmployeesFromCloud
  ) {
    try {
      employees = await window.TabajaCloud.loadEmployeesFromCloud(companyId);

      // Keep a local cache for this company, but Cloud is the source of truth.
      saveEmployees();
    } catch (error) {
      console.error('Unable to load cloud employees:', error);

      // If Cloud is temporarily unavailable, fall back to this company's cache.
      loadEmployees();
    }
  } else {
    loadEmployees();
  }

  renderEmployees();
    $('addEmployeeBtn').addEventListener('click', () => openModal());
    $('emptyAddEmployeeBtn').addEventListener('click', () => openModal());
    $('closeEmployeeModalBtn').addEventListener('click', closeModal);
    $('cancelEmployeeBtn').addEventListener('click', closeModal);
    $('employeeModal').addEventListener('click', (event) => { if (event.target === $('employeeModal')) closeModal(); });
    $('employeeForm').addEventListener('submit', saveForm);
    $('employeePaymentMethodInput')?.addEventListener('change', syncPaymentFields);
    $('employeeAreaInput')?.addEventListener('change', () => { syncAssignmentOptions(); updateTransferDateVisibility(); });
    $('employeeSiteInput')?.addEventListener('change', () => { if(!assignmentFoundation)return; const sid=$('employeeSiteInput').value; const site=(assignmentFoundation.sites||[]).find(x=>x.id===sid); if(site?.area_id) $('employeeAreaInput').value=site.area_id; const posts=(assignmentFoundation.posts||[]).filter(x=>!sid||x.site_id===sid); fillSelect('employeePostInput',posts,''); updateTransferDateVisibility(); });
    $('employeePostInput')?.addEventListener('change', updateTransferDateVisibility);
    $('employeeSearch').addEventListener('input', renderEmployees);
    $('employeeStatusFilter').addEventListener('change', renderEmployees);
    $('employeeTableBody').addEventListener('click', handleTableClick);
    $('employeePhotoInput').addEventListener('change', async (event) => {
      try {
        photoData = await resizePhoto(event.target.files[0]);
        renderPhotoPreview();
      } catch (error) {
        $('employeeFormMessage').textContent = error.message;
      }
      event.target.value = '';
    });
    $('removeEmployeePhotoBtn').addEventListener('click', () => { photoData = ''; renderPhotoPreview(); });
    $('exportEmployeesBtn').addEventListener('click', exportBackup);
    $('importEmployeesBtn').addEventListener('click', () => $('importEmployeesFile').click());
    $('importEmployeesFile').addEventListener('change', (event) => { if (event.target.files[0]) importBackup(event.target.files[0]); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('employeeModal').classList.contains('hidden')) closeModal(); });
  }
window.addEventListener('tabaja:account-changed', async () => {
  if (!$('employeeWorkspace')) return;

  const account = JSON.parse(
    localStorage.getItem('tabaja_card_designer_account_dev_v10') || 'null'
  );

  const companyId = account?.companyId || account?.id || null;

  // Same company: do nothing, avoid flicker.
  if (companyId === loadedCompanyId) return;

  // Real company change.
  loadedCompanyId = companyId;

  employees = [];
  renderEmployees();

  if (
    account?.cloud &&
    companyId &&
    window.TabajaCloud?.loadEmployeesFromCloud
  ) {
    try {
      employees = await window.TabajaCloud.loadEmployeesFromCloud(companyId);
      saveEmployees();
    } catch (error) {
      console.error('Unable to reload employees after account change:', error);
      loadEmployees();
    }
  } else {
    loadEmployees();
  }

  renderEmployees();
});
  window.addEventListener('DOMContentLoaded', init);
})();

/* Tabaja Workforce presentation layer v12.9.3.36.21
   READ-ONLY visualization layer: does not write to Supabase, payroll, roles, scope or core Workforce state. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const num = (id) => {
    const el=$(id); if(!el) return 0;
    const m=(el.textContent||'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : 0;
  };
  const money = (id) => num(id);
  const pct = (a,b) => b>0 ? Math.max(0,Math.min(100,(a/b)*100)) : 0;
  const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function ring(label, value, total, tone, detail){
    const p=pct(value,total);
    return `<article class="wfv-ring-card ${tone}"><div class="wfv-ring" style="--p:${p.toFixed(1)}"><div><strong>${esc(value)}</strong><span>${esc(label)}</span></div></div><div class="wfv-ring-copy"><b>${esc(label)}</b><span>${esc(detail)}</span><small>${p.toFixed(0)}% of active workforce</small></div></article>`;
  }
  function bar(label, value, max, tone){
    const p=max>0?Math.max(4,pct(value,max)):4;
    return `<div class="wfv-bar-row"><span>${esc(label)}</span><div><i class="${tone}" style="width:${p.toFixed(1)}%"></i></div><b>${esc(value)}</b></div>`;
  }
  function ensureLayer(){
    const dash=$('wfDashboardView'); if(!dash || $('wfvAnalytics')) return;
    const layer=document.createElement('section');
    layer.id='wfvAnalytics'; layer.className='wfv-analytics'; layer.setAttribute('aria-label','Workforce visual analytics');
    const kpis=dash.querySelector('.wf-kpi-grid');
    if(kpis) kpis.insertAdjacentElement('afterend',layer); else dash.prepend(layer);

    const quick=document.createElement('section');
    quick.id='wfvQuickActions'; quick.className='wfv-quick-actions';
    quick.innerHTML=`<div class="wfv-section-title"><div><span>WORKSPACE</span><h3>Quick actions</h3></div><small>Uses existing Workforce navigation</small></div><div class="wfv-action-grid">
      <button type="button" data-go="import"><i>⇩</i><span><b>Import Data</b><small>Open Import Center</small></span></button>
      <button type="button" data-go="approvals"><i>✓</i><span><b>Approvals</b><small>Review pending items</small></span></button>
      <button type="button" data-go="setup"><i>⚙</i><span><b>Payroll Setup</b><small>Salary & attendance</small></span></button>
      <button type="button" data-go="payroll"><i>$</i><span><b>Run Payroll</b><small>Open payroll control</small></span></button>
    </div>`;
    const msg=$('wfDashboardMessage'); if(msg) msg.insertAdjacentElement('beforebegin',quick); else dash.append(quick);
    quick.addEventListener('click',e=>{
      const b=e.target.closest('button[data-go]'); if(!b) return;
      const nav=document.querySelector(`.wf-nav button[data-section="${CSS.escape(b.dataset.go)}"]`);
      if(nav) nav.click();
    });
  }
  function render(){
    ensureLayer(); const layer=$('wfvAnalytics'); if(!layer) return;
    const employees=num('wfKpiEmployees'), sites=num('wfKpiSites'), present=num('wfKpiPresent'), pending=num('wfKpiPending');
    const late=num('wfTodayLate'), absent=num('wfTodayAbsent'), attPending=num('wfTodayPending');
    const gross=money('wfPayrollGross'), deductions=money('wfPayrollDeductions'), net=money('wfPayrollNet');
    const max=Math.max(present,late,absent,attPending,1);
    const payrollTotal=Math.max(gross,net+deductions,1);
    layer.innerHTML=`
      <div class="wfv-visual-head"><div><span>LIVE VISUAL ANALYTICS</span><h2>Workforce health</h2><p>Presentation layer reading the existing Workforce values.</p></div><div class="wfv-live"><i></i> Live data</div></div>
      <div class="wfv-visual-grid">
        <div class="wfv-rings">
          ${ring('Present today',present,employees,'blue',`${present} of ${employees || 0} active employees`)}
          ${ring('Active sites',sites,Math.max(sites,1),'green',`${sites} operational sites`)}
          ${ring('Pending approvals',pending,Math.max(employees,pending,1),'amber',`${pending} items need review`)}
        </div>
        <article class="wfv-chart-card"><div class="wfv-card-title"><div><span>ATTENDANCE</span><h3>Today distribution</h3></div><b>${esc($('wfAttendanceDateBadge')?.textContent || 'TODAY')}</b></div><div class="wfv-bars">
          ${bar('Present',present,max,'green')}${bar('Late',late,max,'amber')}${bar('Absent',absent,max,'red')}${bar('Pending',attPending,max,'blue')}
        </div></article>
        <article class="wfv-chart-card payroll"><div class="wfv-card-title"><div><span>PAYROLL</span><h3>Current position</h3></div><b>${esc($('wfPayrollStatus')?.textContent || '')}</b></div>
          <div class="wfv-payroll-viz"><div class="wfv-money-ring" style="--ded:${pct(deductions,payrollTotal).toFixed(1)}"><div><small>NET PAY</small><strong>${esc($('wfPayrollNet')?.textContent || '—')}</strong></div></div><div class="wfv-money-list"><p><span>Gross</span><b>${esc($('wfPayrollGross')?.textContent || '—')}</b></p><p><span>Deductions</span><b>${esc($('wfPayrollDeductions')?.textContent || '—')}</b></p><p><span>Employees</span><b>${esc($('wfPayrollEmployees')?.textContent || '—')}</b></p></div></div>
        </article>
      </div>`;
  }
  let timer=0;
  function schedule(){ clearTimeout(timer); timer=setTimeout(render,80); }
  document.addEventListener('DOMContentLoaded',()=>{
    ensureLayer(); render();
    const ids=['wfKpiEmployees','wfKpiSites','wfKpiPresent','wfKpiPending','wfTodayLate','wfTodayAbsent','wfTodayPending','wfPayrollGross','wfPayrollDeductions','wfPayrollNet','wfPayrollEmployees','wfPayrollStatus'];
    const obs=new MutationObserver(schedule);
    ids.forEach(id=>{const el=$(id); if(el) obs.observe(el,{childList:true,subtree:true,characterData:true,attributes:true});});
  });
})();

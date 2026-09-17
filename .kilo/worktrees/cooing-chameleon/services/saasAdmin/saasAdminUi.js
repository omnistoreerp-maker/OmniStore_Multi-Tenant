(function (root) {
  'use strict';
  const ns = root.OmniSaaSAdmin;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const row = (label, value) => `<div class="saas-admin-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  const engine = ns.SaaSAdminEngine.create({
    sessionProvider: async () => {
      const client = typeof root.getSupabaseClient === 'function' ? root.getSupabaseClient() : null;
      if (!client || !client.auth) return null;
      const sessionResult = await client.auth.getSession();
      const userResult = await client.auth.getUser();
      const session = sessionResult.data && sessionResult.data.session;
      const user = userResult.data && userResult.data.user;
      return session && user ? { accessToken: session.access_token, platformRole: user.app_metadata && user.app_metadata.platform_role } : null;
    }
  });
  const notice = () => `<div class="alert alert-warning"><strong>ERP Owner Only.</strong> إدارة SaaS منفصلة عن تشغيل المتجر. لا تُرسل أي طلبات قبل الاتصال اليدوي، والفوترة الحالية للمعاينة فقط بدون بوابة دفع.</div>`;
  const result = () => '<pre class="saas-admin-result">No SaaS administration action has run.</pre>';
  const button = (label, handler, danger) => `<button type="button" class="btn ${danger ? 'btn-danger' : 'btn-outline'} btn-sm" onclick="${handler}">${esc(label)}</button>`;
  const tenant = extra => `<div class="form-grid"><div class="form-group"><label>Tenant ID</label><input class="saasTenantId" autocomplete="off" placeholder="UUID"></div>${extra || ''}</div>`;
  function connection() {
    return `${notice()}<div class="report-card"><div class="table-title">SaaS Administration Connection</div><div class="form-grid">
      <div class="form-group"><label>Supabase URL</label><input id="saasSupabaseUrl" autocomplete="off" placeholder="https://project.supabase.co"></div>
      <div class="form-group"><label>Anon Key</label><input id="saasAnonKey" type="password" autocomplete="off"></div>
      <div class="form-group"><label>Edge Function URL</label><input id="saasEdgeUrl" autocomplete="off" placeholder="https://project.supabase.co/functions/v1/omnistore-saas-admin"></div>
      <div class="form-group"><label>Project Name</label><input id="saasProjectName" autocomplete="off"></div></div>
      <div class="saas-admin-actions">${button('Connect as ERP Owner','connectSaaSAdministration()')}</div>
      <div class="alert alert-info" style="margin-top:12px">Requires platform_role = erp_owner. Configuration and session tokens are kept in memory only.</div></div>${result()}`;
  }
  function dashboard() {
    const v = engine.snapshot().dashboard || {};
    const cards = [['All Customers',v.customers],['Active Customers',v.activeCustomers],['Suspended',v.suspendedCustomers],['Active Licenses',v.activeLicenses],['Expiring Licenses',v.expiringLicenses],['Revenue Preview',`${v.revenuePreview || 0} ${v.currency || 'USD'}`]];
    return `${notice()}<div class="saas-admin-actions">${button('Refresh Subscription Dashboard','refreshSaaSDashboard()')}</div><div class="saas-admin-grid">${cards.map(([a,b])=>`<div class="stat-card blue"><div class="stat-value">${esc(b == null ? '—' : b)}</div><div class="stat-label">${esc(a)}</div></div>`).join('')}</div>${result()}`;
  }
  function customers() {
    const values = engine.snapshot().customers;
    return `${notice()}<div class="saas-admin-actions">${button('Load All Customers','loadSaaSCustomers()')}</div><div class="overflow-x"><table class="data-table"><thead><tr><th>Business</th><th>Tenant</th><th>Status</th><th>Workspace</th><th>Plan</th><th>Last Login</th><th>Database</th><th>Storage</th></tr></thead><tbody>${values.length ? values.map(c=>`<tr><td>${esc(c.businessName)}</td><td>${esc(c.tenantId)}</td><td>${esc(c.status)}</td><td>${esc(c.workspaceStatus)}</td><td>${esc(c.currentPlan)}</td><td>${esc(c.lastLogin || '—')}</td><td>${esc(c.databaseVersion || '—')}</td><td>${esc(c.storageUsage || 0)}</td></tr>`).join('') : '<tr><td colspan="8">No customers loaded.</td></tr>'}</tbody></table></div>${result()}`;
  }
  function details(usageOnly) {
    const v = engine.snapshot().selectedCustomer;
    const values = usageOnly && v ? v.limitUsage : v;
    return `${notice()}${tenant()}<div class="saas-admin-actions">${button(usageOnly?'Load Workspace Usage':'Load Customer Details','loadSaaSCustomerDetails()')}</div><div class="report-card">${values ? Object.entries(values).map(([k,item])=>row(k,typeof item==='object'?JSON.stringify(item):item)).join('') : row('Status','No customer selected')}</div>${result()}`;
  }
  function actions() {
    const plans = ns.SubscriptionPlanManager.PLAN_CODES.map(p=>`<option value="${p}">${p}</option>`).join('');
    return `${notice()}${tenant(`<div class="form-group"><label>Plan</label><select id="saasPlanCode">${plans}</select></div>`)}<div class="saas-admin-actions">
      ${button('Activate Customer',"runSaaSCustomerAction('activate-customer')")}${button('Suspend Customer',"runSaaSCustomerAction('suspend-customer')",true)}
      ${button('Resume Customer',"runSaaSCustomerAction('resume-customer')")}${button('Renew Subscription',"runSaaSCustomerAction('renew-subscription')")}
      ${button('Change Plan',"runSaaSCustomerAction('change-plan')")}${button('Reset Password',"runSaaSCustomerAction('reset-password')",true)}
      ${button('Download Workspace Report','downloadSaaSWorkspaceReport()')}</div><div class="alert alert-info">Password reset uses the provider's reset flow; no password is displayed or stored.</div>${result()}`;
  }
  function licenses() {
    const plans = ns.SubscriptionPlanManager.PLAN_CODES.map(p=>`<option value="${p}">${p}</option>`).join('');
    return `${notice()}${tenant(`<div class="form-group"><label>Plan</label><select id="saasLicensePlan">${plans}</select></div><div class="form-group"><label>License Key / ID</label><input id="saasLicenseValue" autocomplete="off"></div><div class="form-group"><label>Renewal Months</label><input id="saasLicenseMonths" type="number" min="1" value="1"></div>`)}
      <div class="saas-admin-actions">${button('Generate License','generateSaaSLicense()',true)}${button('Validate License','validateSaaSLicense()')}${button('Renew License','renewSaaSLicense()')}${button('Revoke License','revokeSaaSLicense()',true)}</div>
      <div class="alert alert-warning">Raw license keys are shown once; only a SHA-256 hash is stored server-side.</div>${result()}`;
  }
  function plans() {
    const values=engine.snapshot().plans;
    const fields=ns.PlanLimitValidator.KEYS.map(key=>`<div class="form-group"><label>${esc(key)}</label><input class="saasPlanLimit" data-limit="${esc(key)}" type="number" min="0" value="0"></div>`).join('');
    return `${notice()}<div class="saas-admin-actions">${button('Load Subscription Plans','loadSaaSPlans()')}</div><div class="saas-admin-grid">${values.length?values.map(p=>`<div class="report-card"><div class="table-title">${esc(p.name||p.code)}</div>${row('Code',p.code)}${row('Price',`${p.price} ${p.currency}`)}${Object.entries(p.limits||{}).map(([k,v])=>row(k,v)).join('')}</div>`).join(''):'<div class="report-card">No plans loaded.</div>'}</div>
      <div class="report-card" style="margin-top:14px"><div class="table-title">Configure Plan Limits</div><div class="form-grid"><div class="form-group"><label>Plan</label><select id="saasEditPlan">${ns.SubscriptionPlanManager.PLAN_CODES.map(p=>`<option value="${p}">${p}</option>`).join('')}</select></div><div class="form-group"><label>Price</label><input id="saasPlanPrice" type="number" min="0" value="0"></div><div class="form-group"><label>Currency</label><input id="saasPlanCurrency" maxlength="3" value="USD"></div>${fields}</div><div class="saas-admin-actions">${button('Update Plan Limits','updateSaaSPlanLimits()',true)}</div></div>${result()}`;
  }
  function billing() {
    const v=engine.snapshot().billing;
    return `${notice()}${tenant()}<div class="saas-admin-actions">${button('Load Billing Preview','loadSaaSBillingPreview()')}</div><div class="report-card">${row('Invoices',v.invoices.length)}${row('Payments',v.payments.length)}${row('Renewals',v.renewals.length)}${row('Subscription History',v.subscriptionHistory.length)}${row('Revenue Preview',v.revenuePreview)}${row('Real Payment Gateway','Not connected')}</div>${result()}`;
  }
  function notifications() {
    const v=engine.snapshot().notifications;
    return `${notice()}<div class="saas-admin-actions">${button('Preview Notifications','loadSaaSNotificationPreview()')}</div><div class="report-card">${row('License Expiration',(v.categories.licenseExpiration||[]).length)}${row('Storage Limits',(v.categories.storageLimits||[]).length)}${row('Plan Limits',(v.categories.planLimits||[]).length)}${row('Inactive Customer',(v.categories.inactiveCustomer||[]).length)}${row('Failed Provision',(v.categories.failedProvision||[]).length)}${row('Notifications Sent','0 — Preview Only')}</div>${result()}`;
  }
  function audit() {
    const values=engine.snapshot().licenseAudit;
    return `${notice()}<div class="saas-admin-actions">${button('Load License Audit','loadSaaSLicenseAudit()')}</div><div class="report-card">${values.length?values.map(v=>row(v.action,`${v.created_at||''} — ${v.tenant_id||''}`)).join(''):row('Status','No audit loaded')}</div>${result()}`;
  }
  function content(view) {
    if(view==='saas-admin-center')return connection();
    if(view==='saas-all-customers')return customers();
    if(view==='saas-customer-details')return details(false);
    if(view==='saas-customer-status')return actions();
    if(view==='license-center')return licenses();
    if(view==='subscription-plans')return plans();
    if(view==='workspace-usage')return details(true);
    if(view==='license-audit')return audit();
    if(view==='saas-billing-preview')return billing();
    if(view==='saas-notifications')return notifications();
    return dashboard();
  }
  function renderSaaSAdminPage(view){const target=document.getElementById(`saas-admin-${view}`);if(target)target.innerHTML=content(view);}
  function output(value){const target=document.querySelector('.page.active .saas-admin-result');if(target)target.textContent=JSON.stringify(value,null,2);}
  const tenantId=()=>document.querySelector('.page.active .saasTenantId')?.value.trim()||'';
  async function call(work){try{const value=await work();output(value);return value;}catch(error){output({error:String(error&&error.message||error)});return null;}}
  async function connectSaaSAdministration(){return call(()=>engine.connect({supabaseUrl:document.getElementById('saasSupabaseUrl').value,anonKey:document.getElementById('saasAnonKey').value,edgeFunctionUrl:document.getElementById('saasEdgeUrl').value,projectName:document.getElementById('saasProjectName').value}));}
  async function refreshSaaSDashboard(){return call(()=>engine.refreshDashboard());}
  async function loadSaaSPlans(){return call(async()=>{const v=await engine.loadPlans();renderSaaSAdminPage('subscription-plans');return v;});}
  async function loadSaaSCustomers(){return call(async()=>{const v=await engine.loadCustomers();renderSaaSAdminPage('saas-all-customers');return v;});}
  async function loadSaaSCustomerDetails(){return call(async()=>{const v=await engine.loadCustomer(tenantId());renderSaaSAdminPage(document.querySelector('.page.active').id.replace('page-',''));return v;});}
  async function runSaaSCustomerAction(action){const id=tenantId(),planCode=document.getElementById('saasPlanCode')?.value;if(!root.confirm(`${action} for tenant ${id}?`))return null;return call(()=>engine.action(action,{tenantId:id,...((action==='change-plan'||action==='renew-subscription')?{planCode}:{})}));}
  async function generateSaaSLicense(){if(!root.confirm(`Generate a real license for ${tenantId()}?`))return null;return call(()=>engine.generateLicense(tenantId(),document.getElementById('saasLicensePlan').value));}
  async function validateSaaSLicense(){return call(()=>engine.validateLicense(document.getElementById('saasLicenseValue').value));}
  async function renewSaaSLicense(){if(!root.confirm('Renew this license?'))return null;return call(()=>engine.action('renew-license',{licenseId:document.getElementById('saasLicenseValue').value,months:Number(document.getElementById('saasLicenseMonths').value)}));}
  async function revokeSaaSLicense(){if(!root.confirm('Revoke this license now?'))return null;return call(()=>engine.action('revoke-license',{licenseId:document.getElementById('saasLicenseValue').value}));}
  async function loadSaaSBillingPreview(){return call(()=>engine.loadBilling(tenantId()||undefined));}
  async function loadSaaSNotificationPreview(){return call(()=>engine.loadNotifications());}
  async function loadSaaSLicenseAudit(){return call(()=>engine.loadLicenseAudit());}
  async function updateSaaSPlanLimits(){if(!root.confirm('Update this SaaS plan and its limits?'))return null;const limits={};document.querySelectorAll('.page.active .saasPlanLimit').forEach(input=>{limits[input.dataset.limit]=Number(input.value);});return call(()=>engine.updatePlan(document.getElementById('saasEditPlan').value,{price:Number(document.getElementById('saasPlanPrice').value),currency:document.getElementById('saasPlanCurrency').value,limits}));}
  async function downloadSaaSWorkspaceReport(){return call(async()=>{const v=await engine.action('workspace-report',{tenantId:tenantId()});const blob=new Blob([JSON.stringify(v,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`workspace-${tenantId()}.json`;a.click();URL.revokeObjectURL(url);return{downloaded:true,persistedInBrowser:false};});}
  Object.assign(root,{renderSaaSAdminPage,connectSaaSAdministration,refreshSaaSDashboard,loadSaaSPlans,loadSaaSCustomers,loadSaaSCustomerDetails,runSaaSCustomerAction,generateSaaSLicense,validateSaaSLicense,renewSaaSLicense,revokeSaaSLicense,loadSaaSBillingPreview,loadSaaSNotificationPreview,loadSaaSLicenseAudit,updateSaaSPlanLimits,downloadSaaSWorkspaceReport});
  root.OmniSaaSAdminUi=Object.freeze({version:'1.0.0',engine,renderSaaSAdminPage});
})(typeof globalThis !== 'undefined' ? globalThis : window);

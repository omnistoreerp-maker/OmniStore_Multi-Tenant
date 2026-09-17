(function (root) {
  'use strict';
  const ns = root.OmniCustomerProvisioning;
  const installerEngine = root.OmniSupabaseInstallerUi && root.OmniSupabaseInstallerUi.engine;
  const engine = ns.CustomerProvisioningEngine.create({ installerEngine });
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const row = (label, value) => `<div class="provision-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  const notice = () => `<div class="alert alert-warning"><strong>Real customer provisioning.</strong> Requires a validated Phase 26 connection and authenticated owner/admin. Creating or deleting a customer changes the configured Supabase project.</div>`;
  const tenantInput = (button, handler) => `<div class="form-grid"><div class="form-group"><label>Tenant ID</label><input class="workspaceTenantId" autocomplete="off" placeholder="UUID"></div></div><div class="provision-actions"><button type="button" class="btn btn-outline btn-sm" onclick="${handler}()">${button}</button></div>`;
  function form() {
    const defaults = ns.ProvisioningFormModel.defaults();
    const options = values => values.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
    return `${notice()}<div class="report-card"><div class="table-title">Create SaaS Customer</div>
      <div class="form-grid">
        <div class="form-group"><label>Business Name</label><input id="provisionBusinessName" autocomplete="off"></div>
        <div class="form-group"><label>Owner Name</label><input id="provisionOwnerName" autocomplete="off"></div>
        <div class="form-group"><label>Email</label><input id="provisionEmail" type="email" autocomplete="off"></div>
        <div class="form-group"><label>Password</label><input id="provisionPassword" type="password" autocomplete="new-password"><small>Sent once to the authenticated Edge Function, then cleared.</small></div>
        <div class="form-group"><label>Phone</label><input id="provisionPhone" autocomplete="off"></div>
        <div class="form-group"><label>Country</label><input id="provisionCountry" value="${esc(defaults.country)}" autocomplete="off"></div>
        <div class="form-group"><label>Timezone</label><input id="provisionTimezone" value="${esc(defaults.timezone)}" autocomplete="off"></div>
        <div class="form-group"><label>Currency</label><input id="provisionCurrency" value="${esc(defaults.currency)}" autocomplete="off"></div>
        <div class="form-group"><label>Business Type</label><select id="provisionBusinessType">${options(ns.ProvisioningFormModel.BUSINESS_TYPES)}</select></div>
        <div class="form-group"><label>Subscription Plan</label><select id="provisionPlan">${options(ns.ProvisioningFormModel.SUBSCRIPTION_PLANS)}</select></div>
        <div class="form-group"><label>Language</label><select id="provisionLanguage">${options(ns.ProvisioningFormModel.LANGUAGES)}</select></div>
        <div class="form-group"><label>Company Logo</label><input id="provisionLogo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"></div>
      </div>
      <div class="provision-actions"><button type="button" class="btn btn-danger btn-sm" onclick="createRealCustomer()">Create Customer</button></div>
      <div class="alert alert-info" style="margin-top:12px">The workspace API key is shown once. Store it securely outside the browser if needed.</div>
    </div>`;
  }
  function customers() {
    const state = engine.state();
    return `${notice()}<div class="provision-actions"><button type="button" class="btn btn-outline btn-sm" onclick="refreshRealCustomers()">Refresh Current Customers</button></div><div class="overflow-x" style="margin-top:12px"><table class="data-table"><thead><tr><th>Business</th><th>Tenant</th><th>Workspace</th><th>Status</th><th>Plan</th><th>Migration</th><th>Storage</th></tr></thead><tbody>${state.customers.length ? state.customers.map(customer => `<tr><td>${esc(customer.businessName)}</td><td>${esc(customer.tenantId)}</td><td>${esc(customer.workspaceId)}</td><td>${esc(customer.status)}</td><td>${esc(customer.subscriptionPlan)}</td><td>${esc(customer.migrationVersion)}</td><td>${esc(customer.storageBytes)} bytes</td></tr>`).join('') : '<tr><td colspan="7">No customers loaded.</td></tr>'}</tbody></table></div>`;
  }
  function details() {
    const value = engine.state().lastDetails;
    return `${notice()}${tenantInput('Load Customer Details','loadRealCustomerDetails')}<div class="report-card" style="margin-top:12px"><div class="table-title">Customer Details</div>${value ? Object.entries(value).map(([key,item]) => row(key,typeof item === 'object' ? JSON.stringify(item) : item)).join('') : row('Status','No customer selected')}</div>`;
  }
  function status() {
    const health = engine.state().lastHealth;
    return `${notice()}${tenantInput('Check Customer Status','checkRealWorkspaceHealth')}<div class="report-card" style="margin-top:12px"><div class="table-title">Workspace Status</div>${health ? row('Healthy',String(health.raw.healthy))+row('Status',health.raw.status)+row('Database Version',health.raw.databaseVersion)+row('Migration Version',health.raw.migrationVersion)+row('Isolation Score',`${health.isolation.score}%`) : row('Status','Not checked')}</div>`;
  }
  function health() {
    const value = engine.state().lastHealth;
    return `${notice()}${tenantInput('Validate Workspace Isolation','checkRealWorkspaceHealth')}<div class="report-card" style="margin-top:12px"><div class="table-title">Workspace Health & Isolation</div>${value ? Object.entries(value.isolation.checks).map(([key,item]) => row(key,String(item))).join('')+row('Score',`${value.isolation.score}%`)+row('Cross-tenant access','Blocked') : row('Status','Not checked')}</div>`;
  }
  function report() {
    const value = engine.state().lastProvision;
    return `${notice()}<div class="report-card"><div class="table-title">Customer Provision Report</div>${value ? Object.entries(value.report).map(([key,item]) => row(key,typeof item === 'object' ? JSON.stringify(item) : item)).join('') : row('Status','No customer provisioned in this session')}</div>`;
  }
  function history() {
    const values = engine.state().lastHistory;
    return `${notice()}${tenantInput('Load Provision History','loadRealProvisionHistory')}<div class="report-card" style="margin-top:12px"><div class="table-title">Provision History</div>${values.length ? values.map(item => row(`${item.action} — ${item.status}`,item.created_at || '')).join('') : row('Status','No history loaded')}</div>`;
  }
  function audit() {
    const values = engine.state().lastAudit;
    return `${notice()}${tenantInput('Load Workspace Audit','loadRealWorkspaceAudit')}<div class="report-card" style="margin-top:12px"><div class="table-title">Workspace Audit</div>${values.length ? values.map(item => row(item.event,item.created_at || '')).join('') : row('Status','No audit loaded')}</div>`;
  }
  function rollback() {
    return `${notice()}${tenantInput('Preview Tenant Rollback','previewRealCustomerRollback')}<div class="alert alert-danger" style="margin-top:12px">Deleting a customer is permanent. It requires an exact tenant-specific confirmation and targets one tenant only.</div><div class="provision-actions"><button type="button" class="btn btn-danger btn-sm" onclick="deleteRealCustomer()">Delete Customer Safely</button></div>`;
  }
  function content(view) {
    if (view === 'current-customers') return customers();
    if (view === 'customer-details') return details();
    if (view === 'customer-status') return status();
    if (view === 'workspace-health') return health();
    if (view === 'customer-provision-report') return report();
    if (view === 'provision-history') return history();
    if (view === 'workspace-audit') return audit();
    if (view === 'provision-rollback') return rollback();
    return form();
  }
  function renderCustomerProvisioningPage(view) {
    const target = document.getElementById(`customer-provision-${view}`);
    if (target) target.innerHTML = `${content(view)}<pre class="customer-provision-result">No provisioning action has run.</pre>`;
  }
  function activeTenantId() {
    const input = document.querySelector('.page.active .workspaceTenantId');
    return input ? input.value.trim() : '';
  }
  function output(value) {
    const target = document.querySelector('.page.active .customer-provision-result') || document.querySelector('.customer-provision-result');
    if (target) target.textContent = JSON.stringify(value, null, 2);
  }
  async function readLogo() {
    const input = document.getElementById('provisionLogo');
    const file = input && input.files && input.files[0];
    if (!file) return null;
    if (file.size > 2000000) throw new Error('LOGO_TOO_LARGE');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    return { mimeType: file.type, base64: root.btoa(binary), fileName: file.name };
  }
  async function createRealCustomer() {
    if (!root.confirm('Create this customer and provision a real Supabase workspace now?')) return null;
    const value = id => document.getElementById(id).value;
    const passwordInput = document.getElementById('provisionPassword');
    const password = passwordInput.value;
    passwordInput.value = '';
    const input = {
      businessName: value('provisionBusinessName'), ownerName: value('provisionOwnerName'),
      email: value('provisionEmail'), password, phone: value('provisionPhone'),
      country: value('provisionCountry'), timezone: value('provisionTimezone'), currency: value('provisionCurrency'),
      businessType: value('provisionBusinessType'), subscriptionPlan: value('provisionPlan'),
      language: value('provisionLanguage'), companyLogo: await readLogo()
    };
    try {
      const result = await engine.provision(input);
      if (!result.valid) { output(result); return result; }
      output({
        success: true,
        tenantId: result.result.tenantId,
        workspaceId: result.result.workspaceId,
        loginUrl: result.result.loginUrl,
        workspaceApiKeyShownOnce: result.result.apiKey,
        migrationVersion: result.result.migrationVersion,
        passwordRetained: false,
        accountingPosting: false,
        inventoryPosting: false
      });
      return result;
    } catch (error) { output({ error: String(error && error.message || error), passwordRetained: false }); return null; }
  }
  async function refreshRealCustomers() { try { const result = await engine.refreshCustomers(); renderCustomerProvisioningPage('current-customers'); output({ customersLoaded: result.length }); return result; } catch (error) { output({ error: String(error && error.message || error) }); return null; } }
  async function loadRealCustomerDetails() { try { const result = await engine.loadDetails(activeTenantId()); output(result); return result; } catch (error) { output({ error: String(error && error.message || error) }); return null; } }
  async function checkRealWorkspaceHealth() { try { const result = await engine.checkHealth(activeTenantId()); output(result); return result; } catch (error) { output({ error: String(error && error.message || error) }); return null; } }
  async function loadRealProvisionHistory() { try { const result = await engine.loadHistory(activeTenantId() || undefined); output(result); return result; } catch (error) { output({ error: String(error && error.message || error) }); return null; } }
  async function loadRealWorkspaceAudit() { try { const result = await engine.loadAudit(activeTenantId() || undefined); output(result); return result; } catch (error) { output({ error: String(error && error.message || error) }); return null; } }
  async function previewRealCustomerRollback() { try { const result = await engine.rollbackPreview(activeTenantId()); output(result); return result; } catch (error) { output({ error: String(error && error.message || error) }); return null; } }
  async function deleteRealCustomer() {
    const tenantId = activeTenantId();
    const expected = `DELETE_CUSTOMER:${tenantId}`;
    const confirmation = root.prompt(`Type exactly ${expected} to delete only this tenant:`) || '';
    if (confirmation !== expected) { output({ cancelled: true, reason: 'CONFIRMATION_MISMATCH' }); return null; }
    if (!root.confirm(`Final confirmation: permanently delete tenant ${tenantId}?`)) return null;
    try { const result = await engine.deleteCustomer(tenantId, confirmation); output(result); return result; }
    catch (error) { output({ error: String(error && error.message || error) }); return null; }
  }
  root.renderCustomerProvisioningPage = renderCustomerProvisioningPage;
  root.createRealCustomer = createRealCustomer;
  root.refreshRealCustomers = refreshRealCustomers;
  root.loadRealCustomerDetails = loadRealCustomerDetails;
  root.checkRealWorkspaceHealth = checkRealWorkspaceHealth;
  root.loadRealProvisionHistory = loadRealProvisionHistory;
  root.loadRealWorkspaceAudit = loadRealWorkspaceAudit;
  root.previewRealCustomerRollback = previewRealCustomerRollback;
  root.deleteRealCustomer = deleteRealCustomer;
  root.OmniCustomerProvisioningUi = Object.freeze({ version: '1.0.0', engine, renderCustomerProvisioningPage });
})(typeof globalThis !== 'undefined' ? globalThis : window);

(function (root) {
  'use strict';
  const tenancy = root.OmniTenancyPreview;
  const setup = root.OmniSupabaseSetupPreview;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const row = (label, value) => `<div class="tenant-preview-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  const warning = () => `<div class="alert alert-warning"><strong>Preview Only — SQL is not executed from the browser.</strong><br>Never put Supabase service_role key inside frontend code.</div>`;
  const action = (label, kind) => `<button type="button" class="btn btn-outline btn-sm tenant-preview-action" data-preview-action="${kind}" onclick="runTenantSetupPreview('${kind}')">${label}</button>`;
  function tenantCenter() {
    const health = tenancy.MultiTenantHealthChecker.check();
    return `${warning()}<div class="stats-grid"><div class="stat-card green"><div class="stat-value">${health.score}%</div><div class="stat-label">Multi-Tenant Readiness</div></div><div class="stat-card blue"><div class="stat-value">${tenancy.TenantManager.list().length}</div><div class="stat-label">Mock Workspaces</div></div><div class="stat-card blue"><div class="stat-value">tenant_id</div><div class="stat-label">Isolation Key</div></div></div><div class="tenant-preview-actions">${action('Preview Customer Workspace','workspace')}${action('Validate Tenant Schema','validate')}</div>`;
  }
  function currentWorkspace() {
    const tenant = tenancy.TenantManager.list()[0];
    const workspace = tenancy.CustomerWorkspace.preview(tenant);
    return `${warning()}<div class="tenant-preview-grid"><section class="report-card"><div class="table-title">Current Preview Context</div>${row('Tenant ID',workspace.tenantId)}${row('Workspace ID',workspace.workspaceId)}${row('Persistence',String(workspace.persisted))}</section><section class="report-card"><div class="table-title">Mappings</div>${row('Database',workspace.databaseMapping.strategy)}${row('Authentication',workspace.authenticationMapping.claim)}${row('Storage',workspace.storageMapping.prefix)}${row('Branding',workspace.brandingMapping.key)}${row('Configuration',workspace.configurationMapping.key)}</section></div>`;
  }
  function workspacePreview() {
    const tenants = tenancy.TenantManager.list();
    const switchPlan = tenancy.WorkspaceSwitcherPreview.preview(tenants[0].id, tenants[1].id, 'manager');
    return `${warning()}<div class="report-card"><div class="table-title">Workspace Switching Preview</div>${row('From',switchPlan.fromTenantId)}${row('To',switchPlan.toTenantId)}${row('Role',switchPlan.nextContext.role)}${row('Switched in reality',String(switchPlan.switchedInReality))}${row('Data loaded',String(switchPlan.dataLoaded))}${row('Persisted',String(switchPlan.persisted))}</div>`;
  }
  function provisioning() {
    const plan = tenancy.TenantProvisionPreview.preview({ id: 'tenant-new-customer', name: 'New Customer Preview' });
    return `${warning()}<div class="report-card"><div class="table-title">Customer Provisioning Preview</div>${row('Valid',String(plan.valid))}${row('Tenant created',String(plan.tenantCreated))}${row('Workspace created',String(plan.workspaceCreated))}${row('Backend contacted',String(plan.backendContacted))}${row('Planned steps',plan.plannedSteps.join(' → '))}<div class="tenant-preview-actions">${action('Preview Customer Workspace','workspace')}</div></div>`;
  }
  function health() {
    const result = tenancy.MultiTenantHealthChecker.check();
    return `${warning()}<div class="report-card"><div class="table-title">Multi-Tenant Health</div>${Object.entries(result.checks).map(([key,value]) => row(key,String(value))).join('')}${row('Score',`${result.score}%`)}</div>`;
  }
  function setupCenter() {
    const plan = setup.SupabaseSetupPlanner.createPlan();
    const report = setup.SupabaseSetupReportBuilder.build(plan);
    return `${warning()}<div class="stats-grid"><div class="stat-card green"><div class="stat-value">${report.readinessScore}%</div><div class="stat-label">Supabase Setup Readiness</div></div><div class="stat-card blue"><div class="stat-value">${report.plannedTables}</div><div class="stat-label">Planned Tables</div></div><div class="stat-card blue"><div class="stat-value">${report.plannedPolicies}</div><div class="stat-label">RLS Plans</div></div></div><div class="tenant-preview-actions">${action('Setup Supabase Tables — Preview Only','setup')}${action('Generate SQL Preview','sql')}${action('Validate Tenant Schema','validate')}</div>`;
  }
  function schema() {
    const plan = setup.SupabaseSetupPlanner.createPlan();
    return `${warning()}<div class="report-card"><div class="table-title">Schema Installer Preview</div>${plan.schema.tables.map(table => row(table.name,table.tenantScoped ? 'tenant_id required' : 'tenant root')).join('')}<div class="tenant-preview-actions">${action('Setup Supabase Tables — Preview Only','setup')}${action('Generate SQL Preview','sql')}</div></div>`;
  }
  function rls() {
    const plan = setup.SupabaseSetupPlanner.createPlan();
    return `${warning()}<div class="report-card"><div class="table-title">RLS Policy Preview</div>${plan.rls.policies.map(policy => row(policy.table,`${policy.operations.join(', ')} by tenant_id`)).join('')}<div class="tenant-preview-actions">${action('Preview RLS Policies','rls')}</div></div>`;
  }
  function edge() {
    const plan = setup.SupabaseEdgeFunctionPlanner.plan();
    return `${warning()}<div class="report-card"><div class="table-title">Future Edge Function Installer</div>${row('Function',plan.name)}${row('Secret location',plan.secretLocation)}${row('Callable now',String(plan.callableNow))}${row('API called',String(plan.apiCalled))}${row('SQL executed',String(plan.sqlExecuted))}${row('Steps',plan.steps.join(' → '))}<div class="tenant-preview-actions">${action('Preview Edge Function Installer','edge')}</div></div>`;
  }
  function content(view) {
    if (view === 'current-workspace') return currentWorkspace();
    if (view === 'workspace-preview') return workspacePreview();
    if (view === 'customer-provisioning-preview') return provisioning();
    if (view === 'multi-tenant-health') return health();
    if (view === 'supabase-setup-preview') return setupCenter();
    if (view === 'schema-installer-preview') return schema();
    if (view === 'rls-preview') return rls();
    if (view === 'edge-function-setup-plan') return edge();
    return tenantCenter();
  }
  function renderTenantPreviewPage(view) {
    const target = document.getElementById(`tenant-preview-${view}`);
    if (target) target.innerHTML = `${content(view)}<pre class="tenant-preview-result">اختر إجراء معاينة لعرض الخطة هنا. لا يتم حفظ أو تنفيذ أي شيء.</pre>`;
  }
  function runTenantSetupPreview(kind) {
    const plan = setup.SupabaseSetupPlanner.createPlan();
    const messages = {
      setup: 'Setup plan generated in memory. Tables were not created and SQL was not executed.',
      sql: plan.schema.generatedSqlPreview,
      validate: `Tenant schema validation: ${plan.validation.valid} (${plan.validation.score}%)`,
      workspace: JSON.stringify(tenancy.CustomerWorkspace.preview(tenancy.TenantManager.list()[0]), null, 2),
      rls: plan.rls.generatedSqlPreview,
      edge: JSON.stringify(plan.edgeFunction, null, 2)
    };
    const target = document.querySelector('.page.active .tenant-preview-result') || document.querySelector('.tenant-preview-result');
    if (target) target.textContent = messages[kind] || 'Preview generated in memory only.';
    return Object.freeze({ kind, previewOnly: true, sqlExecuted: false, apiCalled: false, saved: false });
  }
  root.renderTenantPreviewPage = renderTenantPreviewPage;
  root.runTenantSetupPreview = runTenantSetupPreview;
  root.OmniTenancyPreviewUi = Object.freeze({ version: '1.0.0', renderTenantPreviewPage, runTenantSetupPreview });
})(typeof globalThis !== 'undefined' ? globalThis : window);

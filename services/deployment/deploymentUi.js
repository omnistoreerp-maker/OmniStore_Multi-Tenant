(function (root) {
  'use strict';
  const ns = root.OmniDeployment;
  let lastSimulation = null;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const row = (label, value) => `<div class="deployment-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  const warning = () => `<div class="alert alert-warning"><strong>Phase 25 Simulation Only.</strong> Deploy Customer does not connect, execute SQL, create users, or modify a database. Privileged credentials remain server-side in the future Edge Function.</div>`;
  const action = (label, kind, danger) => `<button type="button" class="btn ${danger ? 'btn-danger' : 'btn-outline'} btn-sm deployment-action" data-deployment-action="${kind}" onclick="runDeploymentPreview('${kind}')">${label}</button>`;
  function center() {
    const health = ns.DeploymentEngine.health();
    return `${warning()}<div class="stats-grid"><div class="stat-card green"><div class="stat-value">${health.score}%</div><div class="stat-label">Deployment Readiness</div></div><div class="stat-card blue"><div class="stat-value">0</div><div class="stat-label">Real Deployments</div></div><div class="stat-card blue"><div class="stat-value">Edge Function</div><div class="stat-label">Execution Boundary</div></div></div><div class="deployment-actions">${action('Validate Deployment','validate')}${action('Generate Deployment Package','package')}${action('Preview SQL','sql')}</div>`;
  }
  function wizard() {
    return `${warning()}<div class="report-card"><div class="table-title">New Customer — Deployment Simulation</div>
      <div class="form-grid">
        <div class="form-group"><label>Customer Name</label><input id="deploymentCustomerName" autocomplete="off"></div>
        <div class="form-group"><label>Business Name</label><input id="deploymentBusinessName" autocomplete="off"></div>
        <div class="form-group"><label>Email</label><input id="deploymentEmail" type="email" autocomplete="off"></div>
        <div class="form-group"><label>Password</label><input id="deploymentPassword" type="password" autocomplete="new-password"><small>Validated then discarded immediately; never stored or displayed.</small></div>
        <div class="form-group"><label>Country</label><input id="deploymentCountry" value="Egypt" autocomplete="off"></div>
        <div class="form-group"><label>Currency</label><input id="deploymentCurrency" value="EGP" autocomplete="off"></div>
        <div class="form-group"><label>Timezone</label><input id="deploymentTimezone" value="Africa/Cairo" autocomplete="off"></div>
      </div>
      <div class="deployment-actions">${action('Validate Deployment','validate')}${action('Generate Deployment Package','package')}${action('Preview SQL','sql')}${action('Deploy Customer','deploy')}</div>
    </div>`;
  }
  function status() {
    const result = lastSimulation;
    return `${warning()}<div class="report-card"><div class="table-title">Deployment Status</div>${row('Mode','Simulation Only')}${row('Validated',String(Boolean(result && result.valid)))}${row('Edge Function called','false')}${row('Customer created','false')}${row('SQL executed','false')}${row('Database modified','false')}</div>`;
  }
  function logs() {
    return `${warning()}<div class="report-card"><div class="table-title">In-Memory Simulation Log</div>${row('Events',lastSimulation ? 'validation → package → simulated request → report' : 'No simulation run')}${row('Persisted','false')}${row('Uploaded','false')}${row('Database log written','false')}</div>`;
  }
  function rollback() {
    const plan = ns.DeploymentRollbackPlanner.plan();
    return `${warning()}<div class="report-card"><div class="table-title">Deployment Rollback Plan</div>${row('Available now','Preview only')}${row('Executed',String(plan.rollbackExecuted))}${row('Database modified',String(plan.databaseModified))}${row('Future steps',plan.steps.join(' → '))}<div class="deployment-actions">${action('Rollback Deployment','rollback',true)}</div></div>`;
  }
  function health() {
    const result = ns.DeploymentEngine.health();
    return `${warning()}<div class="report-card"><div class="table-title">Deployment Health</div>${Object.entries(result.checks).map(([key,value]) => row(key,String(value))).join('')}${row('Readiness',`${result.score}%`)}${row('Real deployment enabled',String(result.realDeploymentEnabled))}</div>`;
  }
  function content(view) {
    if (view === 'customer-deployment-wizard') return wizard();
    if (view === 'deployment-status') return status();
    if (view === 'deployment-logs') return logs();
    if (view === 'deployment-rollback') return rollback();
    if (view === 'deployment-health') return health();
    return center();
  }
  function renderDeploymentPage(view) {
    const target = document.getElementById(`deployment-${view}`);
    if (target) target.innerHTML = `${content(view)}<pre class="deployment-result">No deployment action has run. All actions remain simulation-only.</pre>`;
  }
  function readWizardInput() {
    const get = id => document.getElementById(id);
    const passwordInput = get('deploymentPassword');
    const input = {
      customerName: get('deploymentCustomerName') ? get('deploymentCustomerName').value : 'Preview Customer',
      businessName: get('deploymentBusinessName') ? get('deploymentBusinessName').value : 'Preview Business',
      email: get('deploymentEmail') ? get('deploymentEmail').value : 'preview@example.test',
      password: passwordInput ? passwordInput.value : 'Preview#25',
      country: get('deploymentCountry') ? get('deploymentCountry').value : 'Egypt',
      currency: get('deploymentCurrency') ? get('deploymentCurrency').value : 'EGP',
      timezone: get('deploymentTimezone') ? get('deploymentTimezone').value : 'Africa/Cairo'
    };
    if (passwordInput) passwordInput.value = '';
    return input;
  }
  function runDeploymentPreview(kind) {
    const input = readWizardInput();
    const adminContext = Object.freeze({ authenticated: true, role: 'admin', source: 'protected-report-route-simulation' });
    const result = ns.DeploymentEngine.simulate(input, adminContext);
    lastSimulation = result;
    const messages = {
      validate: JSON.stringify({ valid: result.valid, errors: result.errors, passwordRetained: result.customer.passwordRetained }, null, 2),
      package: JSON.stringify({ generated: result.packagePreview.generated, executionTarget: result.packagePreview.executionTarget, components: result.packagePreview.bootstrap.components.map(item => item.name) }, null, 2),
      sql: JSON.stringify({ browserSqlAvailable: result.packagePreview.schema.browserSqlAvailable, draftFiles: result.packagePreview.schema.drafts, sqlExecuted: false }, null, 2),
      deploy: JSON.stringify(result.simulation, null, 2),
      rollback: JSON.stringify(result.rollback, null, 2)
    };
    const target = document.querySelector('.page.active .deployment-result') || document.querySelector('.deployment-result');
    if (target) target.textContent = messages[kind] || 'Simulation generated.';
    return Object.freeze({ action: kind, simulationOnly: true, edgeFunctionCalled: false, sqlExecuted: false, databaseModified: false, customerCreated: false });
  }
  root.renderDeploymentPage = renderDeploymentPage;
  root.runDeploymentPreview = runDeploymentPreview;
  root.OmniDeploymentUi = Object.freeze({ version: '1.0.0', renderDeploymentPage, runDeploymentPreview });
})(typeof globalThis !== 'undefined' ? globalThis : window);

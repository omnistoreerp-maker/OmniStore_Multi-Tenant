(function (root) {
  'use strict';
  const ns = root.OmniSupabaseInstaller;
  let lastResult = null;
  let lastConnection = null;
  const sessionProvider = async () => {
    if (typeof root.getSupabaseClient !== 'function') return null;
    const client = root.getSupabaseClient();
    if (!client || !client.auth) return null;
    const sessionResult = await client.auth.getSession();
    const session = sessionResult && sessionResult.data && sessionResult.data.session;
    if (!session) return null;
    const userResult = await client.auth.getUser();
    const user = userResult && userResult.data && userResult.data.user;
    return user ? {
      accessToken: session.access_token,
      role: String(user.app_metadata && user.app_metadata.role || ''),
      userId: user.id
    } : null;
  };
  const engine = ns.DeploymentInstallerBridge.create({ fetchImpl: (...args) => root.fetch(...args), sessionProvider });
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const row = (label, value) => `<div class="installer-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  const notice = () => `<div class="alert alert-warning"><strong>Admin-only real deployment infrastructure.</strong> Connection and installation start only after explicit button clicks. The browser sends an authenticated JWT and anon key; privileged server credentials and database connection remain inside the Edge Function.</div>`;
  function installer() {
    const status = engine.status();
    return `${notice()}<div class="report-card"><div class="table-title">Supabase Project Configuration — Memory Only</div>
      <div class="form-grid">
        <div class="form-group"><label>Supabase URL</label><input id="realInstallerUrl" type="url" autocomplete="off" placeholder="https://project-ref.supabase.co"></div>
        <div class="form-group"><label>Anon Key</label><input id="realInstallerAnonKey" type="password" autocomplete="off" placeholder="Browser-safe anon/publishable key"></div>
        <div class="form-group"><label>Edge Function URL</label><input id="realInstallerEdgeUrl" type="url" autocomplete="off" placeholder="https://project-ref.supabase.co/functions/v1/omnistore-installer"></div>
        <div class="form-group"><label>Project Name</label><input id="realInstallerProjectName" autocomplete="off"></div>
      </div>
      <div class="installer-actions">
        <button type="button" class="btn btn-outline btn-sm" onclick="validateRealSupabaseConnection()">Validate Connection</button>
        <button type="button" id="installDatabaseButton" class="btn btn-danger btn-sm" onclick="installRealSupabaseDatabase()" ${status.installEnabled ? '' : 'disabled'}>Install Database</button>
      </div>
      <div class="alert alert-info" style="margin-top:12px">Installation requires a current Supabase session whose trusted <code>app_metadata.role</code> is <code>owner</code> or <code>admin</code>.</div>
    </div>`;
  }
  function progress() {
    const stages = lastResult && lastResult.progress ? lastResult.progress.stages : [];
    return `${notice()}<div class="report-card"><div class="table-title">Migration Progress</div>${stages.length ? stages.map(stage => row(stage.id,stage.status)).join('') : row('Status','No installation started')}${row('Browser persistence','false')}</div>`;
  }
  function report() {
    const value = lastResult && lastResult.report;
    return `${notice()}<div class="report-card"><div class="table-title">Installation Report</div>${row('Success',String(Boolean(value && value.success)))}${row('Installation ID',value && value.installationId || '-')}${row('Migration Version',value && value.migrationVersion || ns.MigrationManifest.VERSION)}${row('Accounting posting',String(Boolean(value && value.accountingPostingPerformed)))}${row('Inventory posting',String(Boolean(value && value.inventoryPostingPerformed)))}</div>`;
  }
  function verification() {
    const value = lastResult && lastResult.verification;
    return `${notice()}<div class="report-card"><div class="table-title">Verification Report</div>${value ? Object.entries(value.checks).map(([key,valid]) => row(key,String(valid))).join('') : row('Status','No verification result')}<div class="installer-actions"><button type="button" class="btn btn-outline btn-sm" onclick="verifyRealSupabaseInstallation()">Verify Installation</button><button type="button" class="btn btn-outline btn-sm" onclick="previewRealSupabaseRollback()">Preview Rollback</button></div></div>`;
  }
  function health() {
    const value = lastConnection && lastConnection.health;
    return `${notice()}<div class="report-card"><div class="table-title">Supabase Health</div>${row('Project Status',value && value.projectStatus || 'Not validated')}${row('API',String(Boolean(value && value.checks.api)))}${row('Auth',String(Boolean(value && value.checks.auth)))}${row('Edge Function',String(Boolean(value && value.checks.edgeFunction)))}${row('Storage',String(Boolean(value && value.checks.storage)))}${row('RLS',String(Boolean(value && value.checks.rls)))}${row('Realtime',String(Boolean(value && value.checks.realtime)))}${row('Database Version',value && value.databaseVersion || 'unknown')}${row('Migration Version',value && value.migrationVersion || 'not-installed')}${row('Latency',value ? `${value.latencyMs} ms` : '-')}</div>`;
  }
  function content(view) {
    if (view === 'migration-progress') return progress();
    if (view === 'installation-report') return report();
    if (view === 'verification-report') return verification();
    if (view === 'supabase-health') return health();
    return installer();
  }
  function renderRealSupabaseInstallerPage(view) {
    const target = document.getElementById(`real-installer-${view}`);
    if (target) target.innerHTML = `${content(view)}<pre class="real-installer-result">No connection or installation action has run.</pre>`;
  }
  function readConfiguration() {
    const value = id => {
      const element = document.getElementById(id);
      return element ? element.value : '';
    };
    return {
      supabaseUrl: value('realInstallerUrl'),
      anonKey: value('realInstallerAnonKey'),
      edgeFunctionUrl: value('realInstallerEdgeUrl'),
      projectName: value('realInstallerProjectName')
    };
  }
  function output(value) {
    const target = document.querySelector('.page.active .real-installer-result') || document.querySelector('.real-installer-result');
    if (target) target.textContent = JSON.stringify(value, null, 2);
  }
  async function validateRealSupabaseConnection() {
    const result = await engine.validateConnection(readConfiguration());
    lastConnection = result;
    const button = document.getElementById('installDatabaseButton');
    if (button) button.disabled = !result.valid;
    output({ valid: result.valid, errors: result.errors, health: result.health, config: result.config });
    return result;
  }
  async function installRealSupabaseDatabase() {
    if (!engine.status().installEnabled) { output({ error: 'VALID_CONNECTION_REQUIRED' }); return null; }
    const confirmed = root.confirm('Install the OmniStore database schema now? This will run real migrations inside the authenticated Supabase project.');
    if (!confirmed) { output({ cancelled: true, databaseModified: false }); return null; }
    try {
      lastResult = await engine.install(true);
      output(lastResult.report);
      return lastResult;
    } catch (error) {
      output({ error: String(error && error.message || error), secretExposed: false });
      return null;
    }
  }
  async function verifyRealSupabaseInstallation() {
    try { const result = await engine.verify(); output(result); return result; }
    catch (error) { output({ error: String(error && error.message || error) }); return null; }
  }
  async function previewRealSupabaseRollback() {
    try { const result = await engine.rollbackPreview(); output(result); return result; }
    catch (error) { output({ error: String(error && error.message || error) }); return null; }
  }
  root.renderRealSupabaseInstallerPage = renderRealSupabaseInstallerPage;
  root.validateRealSupabaseConnection = validateRealSupabaseConnection;
  root.installRealSupabaseDatabase = installRealSupabaseDatabase;
  root.verifyRealSupabaseInstallation = verifyRealSupabaseInstallation;
  root.previewRealSupabaseRollback = previewRealSupabaseRollback;
  root.OmniSupabaseInstallerUi = Object.freeze({ version: '1.0.0', engine, renderRealSupabaseInstallerPage });
})(typeof globalThis !== 'undefined' ? globalThis : window);

(function (root) {
  'use strict';
  const ns = root.OmniAuthPreview;
  const engine = ns.AuthenticationEngine.createEngine();
  let lastMockSession = null;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const row = (label, value) => `<div class="auth-preview-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  function center() {
    const validation = engine.validate();
    return `<div class="stats-grid" style="margin-bottom:14px">
      <div class="stat-card green"><div class="stat-value">${validation.readinessScore}%</div><div class="stat-label">Authentication Readiness</div></div>
      <div class="stat-card blue"><div class="stat-value">${engine.users().length}</div><div class="stat-label">Mock Users</div></div>
      <div class="stat-card blue"><div class="stat-value">${engine.roles().length}</div><div class="stat-label">Roles</div></div>
      <div class="stat-card blue"><div class="stat-value">${ns.PermissionEngine.PERMISSIONS.length}</div><div class="stat-label">Permissions</div></div>
    </div><div class="auth-preview-grid">
      <section class="report-card"><div class="table-title">حالة الأمان</div>${row('Backend','None')}${row('Real login','Disabled')}${row('Session storage','None')}${row('Password storage','None')}${row('API calls','0')}</section>
      <section class="report-card"><div class="table-title">المكونات</div>${ns.AuthenticationValidator.REQUIRED_COMPONENTS.map(name => row(name, validation.checks.components ? 'Ready' : 'Review')).join('')}</section>
    </div>`;
  }
  function users() {
    return `<div class="auth-preview-grid">${engine.users().map(user => `<div class="report-card"><div class="table-title">${esc(user.displayName)}</div>${row('ID',user.id)}${row('Role',user.role)}${row('Enabled',String(user.enabled))}${row('Storage','None')}</div>`).join('')}</div>`;
  }
  function roles() {
    return `<div class="auth-preview-grid">${engine.roles().map(role => `<div class="report-card"><div class="table-title">${esc(role.name)}</div>${row('Role ID',role.id)}${row('Permissions',role.permissions.join(', '))}</div>`).join('')}</div>`;
  }
  function permissions() {
    return `<div class="report-card"><div class="table-title">Permission Registry</div>${ns.PermissionEngine.PERMISSIONS.map(permission => row(permission, 'Preview permission')).join('')}</div>`;
  }
  function login() {
    const userOptions = engine.users().map(user => `<option value="${user.id}">${esc(user.displayName)} — ${user.role}</option>`).join('');
    const routeOptions = Object.keys(ns.RouteGuard.ROUTES).map(route => `<option value="${route}">${esc(route)}</option>`).join('');
    return `<div class="report-card"><div class="alert alert-warning">Mock Preview فقط. لا تكتب كلمة مرور؛ لا يوجد حقل كلمة مرور أو اتصال Backend.</div>
      <div class="form-grid"><div class="form-group"><label>Mock User</label><select id="authPreviewUser">${userOptions}</select></div><div class="form-group"><label>Route Access Preview</label><select id="authPreviewRoute">${routeOptions}</select></div></div>
      <div class="table-actions" style="justify-content:flex-start;margin-top:10px"><button type="button" class="btn btn-outline btn-sm" onclick="runMockLoginPreview()">Preview Login</button><button type="button" class="btn btn-outline btn-sm" onclick="runMockLogoutPreview()">Preview Logout</button><button type="button" class="btn btn-outline btn-sm" onclick="runRouteAccessPreview()">Preview Route Access</button></div>
      <div id="authLoginPreviewResult" style="margin-top:12px"><div class="alert alert-info">اختر مستخدمًا تجريبيًا ثم شغّل المعاينة.</div></div></div>`;
  }
  function session() {
    const user = engine.users()[2];
    const sessionPreview = ns.SessionManager.preview(user, { now: '2026-07-01T10:00:00.000Z', durationMinutes: 30 });
    const before = ns.SessionManager.expirationPreview(sessionPreview, '2026-07-01T10:20:00.000Z');
    const after = ns.SessionManager.expirationPreview(sessionPreview, '2026-07-01T10:31:00.000Z');
    return `<div class="auth-preview-grid"><div class="report-card"><div class="table-title">Mock Session</div>${row('Session ID',sessionPreview.id)}${row('User',sessionPreview.userId)}${row('Role',sessionPreview.role)}${row('Real session',String(sessionPreview.realSession))}${row('Stored',String(sessionPreview.stored))}</div><div class="report-card"><div class="table-title">Expiration Preview</div>${row('Expires at',sessionPreview.expiresAt)}${row('At 10:20 expired',String(before.expired))}${row('At 10:31 expired',String(after.expired))}${row('Session changed',String(after.sessionChanged))}</div></div>`;
  }
  function audit() {
    const auditPreview = engine.previewAudit([
      { type: 'login_preview', outcome: 'allowed', actor: 'mock-manager' },
      { type: 'route_access_preview', outcome: 'denied', actor: 'mock-cashier' }
    ]);
    const policy = engine.previewPasswordPolicy('Demo#123');
    return `<div class="stats-grid"><div class="stat-card green"><div class="stat-value">${auditPreview.securityHealth}%</div><div class="stat-label">Security Health Preview</div></div><div class="stat-card blue"><div class="stat-value">${auditPreview.total}</div><div class="stat-label">Audit Events</div></div></div><div class="auth-preview-grid" style="margin-top:12px"><div class="report-card"><div class="table-title">Audit Preview</div>${auditPreview.events.map(event => row(event.type,event.outcome)).join('')}${row('Persisted',String(auditPreview.persisted))}</div><div class="report-card"><div class="table-title">Password Policy Validation</div>${Object.entries(policy.checks).map(([key,value]) => row(key,String(value))).join('')}${row('Candidate retained',String(policy.retained))}</div></div>`;
  }
  function matrix() {
    const matrixRows = engine.permissionMatrix();
    return `<div class="overflow-x"><table class="data-table"><thead><tr><th>Role</th>${ns.PermissionEngine.PERMISSIONS.map(permission => `<th>${esc(permission)}</th>`).join('')}</tr></thead><tbody>${matrixRows.map(entry => `<tr><td>${esc(entry.role)}</td>${ns.PermissionEngine.PERMISSIONS.map(permission => `<td>${entry.permissions[permission] ? '✅' : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function content(view) {
    if (view === 'auth-preview-users') return users();
    if (view === 'auth-preview-roles') return roles();
    if (view === 'auth-preview-permissions') return permissions();
    if (view === 'auth-login-preview') return login();
    if (view === 'auth-session-preview') return session();
    if (view === 'auth-security-audit') return audit();
    if (view === 'auth-permission-matrix') return matrix();
    return center();
  }
  function renderAuthPreviewPage(view) {
    const target = document.getElementById(`auth-preview-${view}`);
    if (!target) return;
    target.innerHTML = `<div class="alert alert-info"><strong>Authentication Preview:</strong> لا Login حقيقي، لا Password storage، لا Session storage، لا Cookie، لا Backend، ولا API.</div>${content(view)}`;
  }
  function runMockLoginPreview() {
    const userId = document.getElementById('authPreviewUser').value;
    const result = engine.previewLogin({ userId });
    lastMockSession = result.mockSession;
    const target = document.getElementById('authLoginPreviewResult');
    target.innerHTML = `<div class="alert alert-info">wouldAuthenticate=${result.wouldAuthenticate} · authenticatedInReality=${result.authenticatedInReality} · backendContacted=${result.backendContacted} · credentialsStored=${result.credentialsStored}</div>`;
  }
  function runMockLogoutPreview() {
    const result = engine.previewLogout(lastMockSession);
    const target = document.getElementById('authLoginPreviewResult');
    target.innerHTML = `<div class="alert alert-info">wouldEndSession=${result.wouldEndSession} · realSessionEnded=${result.realSessionEnded} · storageCleared=${result.storageCleared}</div>`;
  }
  function runRouteAccessPreview() {
    const userId = document.getElementById('authPreviewUser').value;
    const route = document.getElementById('authPreviewRoute').value;
    const result = engine.previewRouteAccess(route, userId, lastMockSession);
    const target = document.getElementById('authLoginPreviewResult');
    target.innerHTML = `<div class="alert ${result.allowed ? 'alert-info' : 'alert-warning'}">route=${esc(route)} · allowed=${result.allowed} · navigationPerformed=${result.navigationPerformed}</div>`;
  }
  root.renderAuthPreviewPage = renderAuthPreviewPage;
  root.runMockLoginPreview = runMockLoginPreview;
  root.runMockLogoutPreview = runMockLogoutPreview;
  root.runRouteAccessPreview = runRouteAccessPreview;
  root.OmniAuthPreviewUi = Object.freeze({ version: '1.0.0', engine, renderAuthPreviewPage });
})(typeof globalThis !== 'undefined' ? globalThis : window);

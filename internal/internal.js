(function () {
  'use strict';

  const API = '/api/v1/internal';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function getAccessToken() {
    try {
      const raw = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
      if (raw) return raw;
      const cookies = document.cookie.split(';');
      for (const c of cookies) {
        const idx = c.indexOf('=');
        if (idx > -1 && c.slice(0, idx).trim() === 'access_token') return decodeURIComponent(c.slice(idx + 1).trim());
      }
    } catch (_) {}
    return null;
  }

  async function apiFetch(path, options) {
    const token = getAccessToken();
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(API + path, Object.assign({ method: 'GET', headers: headers }, options || {}));
    const body = await res.json().catch(() => null);
    return { status: res.status, body: body };
  }

  function renderBuildInfo(build) {
    const info = document.getElementById('build-info');
    if (!info || !build) return;
    const parts = ['v' + (build.version || '?')];
    if (build.buildId) parts.push('Build: ' + build.buildId);
    if (build.commitSha) parts.push('Commit: ' + build.commitSha.slice(0, 7));
    info.textContent = parts.join(' • ');
  }

  function renderDashboard(summary) {
    if (!summary) return;
    const byStatus = summary.byStatus || {};
    const setVal = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    setVal('dash-total', summary.total || 0);
    setVal('dash-new', (byStatus.NEW || 0) + (byStatus.TRIAGED || 0));
    setVal('dash-in-progress', (byStatus.IN_PROGRESS || 0) + (byStatus.APPROVED || 0) + (byStatus.READY_FOR_TEST || 0) + (byStatus.TESTED || 0) + (byStatus.READY_FOR_RELEASE || 0) + (byStatus.BLOCKED || 0));
    setVal('dash-released', (byStatus.RELEASED || 0) + (byStatus.READY_FOR_CUSTOMER_VERIFICATION || 0));
    setVal('dash-reopened', byStatus.REOPENED || 0);
    setVal('dash-resolved', byStatus.RESOLVED || 0);
    setVal('dash-needs', byStatus.NEEDS_EVIDENCE || 0);
    setVal('dash-historical', summary.historical || 0);
  }

  function statusBadgeClass(status) {
    return 'badge status status-' + status;
  }

  function renderRequestRow(r) {
    const needsAction = (r.status === 'READY_FOR_CUSTOMER_VERIFICATION' || r.status === 'RELEASED') && !r.historical;
    const isResolved = r.status === 'RESOLVED';
    const rowClass = 'request-row' + (r.historical ? ' historical' : '') + (needsAction ? ' action-required' : '') + (isResolved ? ' resolved' : '');
    const row = el('div', rowClass);
    row.dataset.requestId = r.id;
    const idCell = el('div', 'cell-id', r.customerRequestNumber || r.id);
    row.appendChild(idCell);
    const titleCell = el('div');
    const titleEl = el('div', 'cell-title', r.title);
    titleCell.appendChild(titleEl);
    const companyEl = el('div', 'cell-company', 'Company: ' + (r.companyId || '—'));
    titleCell.appendChild(companyEl);
    row.appendChild(titleCell);
    const statusCell = el('div');
    statusCell.appendChild(el('span', statusBadgeClass(r.status), r.status));
    if (r.historical) statusCell.appendChild(document.createTextNode(' '));
    if (r.historical) statusCell.appendChild(el('span', 'badge historical', 'HISTORICAL'));
    row.appendChild(statusCell);
    const priorityCell = el('div');
    priorityCell.appendChild(el('span', 'badge P' + (r.priority || '?').replace('P', ''), r.priority));
    priorityCell.appendChild(document.createTextNode(' '));
    priorityCell.appendChild(el('span', 'badge', r.product));
    row.appendChild(priorityCell);
    const releaseCell = el('div', 'cell-release');
    if (r.releaseId && typeof r.releaseId === 'object') {
      releaseCell.textContent = 'v' + (r.releaseId.version || '?') + ' / ' + (r.releaseId.buildId || '?');
    } else {
      releaseCell.textContent = '—';
    }
    row.appendChild(releaseCell);
    const dateCell = el('div', 'cell-date', (r.updatedAt || '').slice(0, 10));
    row.appendChild(dateCell);
    row.addEventListener('click', () => openDetail(r.id));
    return row;
  }

  function renderRequests(requests) {
    const list = document.getElementById('request-list');
    const empty = document.getElementById('requests-empty');
    if (!list) return;
    list.innerHTML = '';
    if (!requests || requests.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    requests.forEach(r => list.appendChild(renderRequestRow(r)));
  }

  function renderReleases(releases) {
    const list = document.getElementById('release-list');
    const empty = document.getElementById('releases-empty');
    if (!list) return;
    list.innerHTML = '';
    if (!releases || releases.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    for (const r of releases) {
      const row = el('div', 'release-row');
      row.appendChild(el('div', 'release-version', 'v' + (r.version || '?')));
      const info = el('div');
      info.appendChild(el('div', null, 'Build: ' + (r.buildId || '—')));
      const commit = r.commitSha ? r.commitSha.slice(0, 7) : '—';
      info.appendChild(el('div', 'cell-date', 'Commit: ' + commit));
      row.appendChild(info);
      const artifact = el('div', 'release-artifact');
      artifact.textContent = r.artifactSha256 ? r.artifactSha256.slice(0, 16) + '…' : '—';
      row.appendChild(artifact);
      const env = el('div', 'badge', r.environment || '—');
      row.appendChild(env);
      const date = el('div', 'cell-date', (r.releasedAt || r.createdAt || '').slice(0, 10));
      row.appendChild(date);
      list.appendChild(row);
    }
  }

  function populateCompanyFilter(companies) {
    const sel = document.getElementById('filter-company');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">All</option>';
    for (const c of (companies || [])) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    }
    sel.value = current;
  }

  async function loadDashboard() {
    const { status, body } = await apiFetch('/dashboard');
    if (status === 200 && body && body.success) {
      renderBuildInfo(body.data.currentBuild);
      renderDashboard(body.data.summary);
    } else if (status === 403) {
      alert('Platform administrator access required.');
    }
  }

  async function loadChanges() {
    const params = new URLSearchParams();
    const status = document.getElementById('filter-status').value;
    const company = document.getElementById('filter-company').value;
    const priority = document.getElementById('filter-priority').value;
    const product = document.getElementById('filter-product').value;
    const historical = document.getElementById('filter-historical').value;
    if (status) params.set('status', status);
    if (company) params.set('companyId', company);
    if (priority) params.set('priority', priority);
    if (product) params.set('product', product);
    if (historical) params.set('historical', historical);
    const { status: code, body } = await apiFetch('/changes?' + params.toString());
    if (code === 200 && body && body.success) {
      renderRequests(body.data.requests);
      if (body.data.companies) populateCompanyFilter(body.data.companies);
    }
  }

  async function loadReleases() {
    const { status, body } = await apiFetch('/releases');
    if (status === 200 && body && body.success) {
      renderReleases(body.data.releases);
    }
  }

  async function openDetail(requestId) {
    const { status, body } = await apiFetch('/changes/' + encodeURIComponent(requestId));
    if (status !== 200 || !body || !body.success) {
      alert('Failed to load request detail');
      return;
    }
    const data = body.data;
    const req = data.request;
    const timeline = data.timeline || [];
    const releaseMatch = data.releaseMatch;
    const title = document.getElementById('modal-title');
    const body2 = document.getElementById('modal-body');
    title.textContent = req.customerRequestNumber + ' — ' + req.title;
    body2.innerHTML = '';
    // Request section
    const reqSection = el('div', 'detail-section');
    reqSection.appendChild(el('h4', null, 'Request'));
    const reqGrid = el('div', 'detail-grid');
    [
      { label: 'Company', value: req.companyId },
      { label: 'Status', value: req.status },
      { label: 'Type', value: req.type },
      { label: 'Priority', value: req.priority },
      { label: 'Product', value: req.product },
      { label: 'Created', value: (req.createdAt || '').slice(0, 19).replace('T', ' ') },
      { label: 'Last updated', value: (req.updatedAt || '').slice(0, 19).replace('T', ' ') },
      { label: 'Historical', value: req.historical ? 'Yes' : 'No' }
    ].forEach(d => {
      const item = el('div', 'detail-item');
      item.appendChild(el('div', 'detail-label', d.label));
      item.appendChild(el('div', 'detail-value', d.value || '—'));
      reqGrid.appendChild(item);
    });
    reqSection.appendChild(reqGrid);
    if (req.description) {
      const desc = el('p');
      desc.textContent = req.description;
      reqSection.appendChild(desc);
    }
    body2.appendChild(reqSection);
    // Release section
    if (req.releaseId) {
      const relObj = req.releaseId;
      const relSection = el('div', 'detail-section');
      relSection.appendChild(el('h4', null, 'Release'));
      const relGrid = el('div', 'detail-grid');
      [
        { label: 'Release ID', value: relObj.id || '—' },
        { label: 'Version', value: relObj.version || '—' },
        { label: 'Build ID', value: relObj.buildId || '—' },
        { label: 'Commit SHA', value: relObj.commitSha || '—' },
        { label: 'Artifact SHA-256', value: relObj.artifactSha256 || '—' },
        { label: 'Environment', value: relObj.environment || '—' },
        { label: 'Released', value: relObj.releasedAt ? relObj.releasedAt.slice(0, 19).replace('T', ' ') : '—' },
        { label: 'Match', value: releaseMatch && releaseMatch.matches ? '✓ Matches current build' : '✗ ' + (releaseMatch ? releaseMatch.reason : 'NO_MATCH') }
      ].forEach(d => {
        const item = el('div', 'detail-item');
        item.appendChild(el('div', 'detail-label', d.label));
        item.appendChild(el('div', 'detail-value', d.value));
        relGrid.appendChild(item);
      });
      relSection.appendChild(relGrid);
      body2.appendChild(relSection);
    }
    // Implementation evidence
    if (req.implementationCommits && req.implementationCommits.length > 0) {
      const commitSection = el('div', 'detail-section');
      commitSection.appendChild(el('h4', null, 'Implementation Commits'));
      const commitList = el('p');
      commitList.textContent = req.implementationCommits.join(', ');
      commitSection.appendChild(commitList);
      body2.appendChild(commitSection);
    }
    if (req.testEvidence && req.testEvidence.length > 0) {
      const testSection = el('div', 'detail-section');
      testSection.appendChild(el('h4', null, 'Test Evidence'));
      req.testEvidence.forEach(t => testSection.appendChild(el('p', null, t)));
      body2.appendChild(testSection);
    }
    // Verification section
    if (data.verifications && data.verifications.length > 0) {
      const verSection = el('div', 'detail-section');
      verSection.appendChild(el('h4', null, 'Verification History'));
      data.verifications.forEach(v => {
        const verBox = el('div', 'detail-item');
        verBox.appendChild(el('div', 'detail-label', (v.verifiedAt || '').slice(0, 19).replace('T', ' ') + ' • ' + (v.verifiedBy || '—')));
        verBox.appendChild(el('div', 'detail-value', v.result + ' • Build: ' + (v.buildId || '—')));
        if (v.artifactSha256) verBox.appendChild(el('div', 'detail-label', 'Artifact: ' + v.artifactSha256.slice(0, 16) + '…'));
        if (v.note) verBox.appendChild(el('div', null, v.note));
        verSection.appendChild(verBox);
      });
      body2.appendChild(verSection);
    }
    // Resolution
    if (req.resolution) {
      const resSection = el('div', 'detail-section');
      resSection.appendChild(el('h4', null, 'Resolution'));
      resSection.appendChild(el('p', null, req.resolution));
      body2.appendChild(resSection);
    }
    // Timeline
    if (timeline.length > 0) {
      const tlSection = el('div', 'detail-section');
      tlSection.appendChild(el('h4', null, 'Audit Timeline'));
      const tlDiv = el('div', 'timeline');
      timeline.forEach(ev => {
        const item = el('div', 'timeline-item');
        let cls = '';
        if (ev.type === 'verification') {
          cls = ev.result === 'CONFIRMED' ? 'verified' : 'failed';
        } else if (ev.toStatus === 'RELEASED' || ev.toStatus === 'READY_FOR_CUSTOMER_VERIFICATION') {
          cls = 'released';
        } else if (ev.toStatus === 'REOPENED') {
          cls = 'reopened';
        } else if (ev.toStatus === 'RESOLVED') {
          cls = 'resolved';
        }
        if (cls) item.className = 'timeline-item ' + cls;
        const label = el('div', 'timeline-label');
        if (ev.type === 'verification') {
          label.textContent = ev.result === 'CONFIRMED' ? '✓ Customer confirmed resolution' : '✗ Customer reported issue remains';
        } else if (ev.fromStatus) {
          label.textContent = ev.fromStatus + ' → ' + ev.toStatus;
        } else {
          label.textContent = 'Created (' + ev.toStatus + ')';
        }
        const meta = el('div', 'timeline-meta');
        meta.textContent = (ev.timestamp || '').slice(0, 19).replace('T', ' ') + ' • ' + (ev.actor || 'system') + (ev.actorType ? ' (' + ev.actorType + ')' : '');
        item.appendChild(label);
        item.appendChild(meta);
        if (ev.note) item.appendChild(el('div', 'timeline-note', ev.note));
        tlDiv.appendChild(item);
      });
      tlSection.appendChild(tlDiv);
      body2.appendChild(tlSection);
    }
    document.getElementById('modal-overlay').hidden = false;
  }

  function closeModal() {
    document.getElementById('modal-overlay').hidden = true;
  }

  function closeReleaseModal() {
    document.getElementById('release-modal-overlay').hidden = true;
  }

  async function submitRelease(ev) {
    ev.preventDefault();
    const msg = document.getElementById('release-form-message');
    msg.hidden = true;
    const data = {
      version: document.getElementById('rel-version').value.trim(),
      buildId: document.getElementById('rel-buildId').value.trim(),
      artifactSha256: document.getElementById('rel-artifactSha256').value.trim(),
      commitSha: document.getElementById('rel-commitSha').value.trim() || null,
      environment: document.getElementById('rel-environment').value,
      notes: document.getElementById('rel-notes').value.trim()
    };
    const { status, body } = await apiFetch('/releases', { method: 'POST', body: JSON.stringify(data) });
    if (status === 201 && body && body.success) {
      msg.className = 'form-message success';
      msg.textContent = 'Release v' + body.data.release.version + ' registered successfully.';
      msg.hidden = false;
      document.getElementById('release-form').reset();
      await loadReleases();
    } else {
      msg.className = 'form-message error';
      msg.textContent = (body && body.message) || 'Failed to register release.';
      msg.hidden = false;
    }
  }

  function init() {
    const applyBtn = document.getElementById('filter-apply');
    if (applyBtn) applyBtn.addEventListener('click', loadChanges);
    const closeBtn = document.getElementById('modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeModal(); });
    const releaseClose = document.getElementById('release-modal-close');
    if (releaseClose) releaseClose.addEventListener('click', closeReleaseModal);
    const releaseOverlay = document.getElementById('release-modal-overlay');
    if (releaseOverlay) releaseOverlay.addEventListener('click', (ev) => { if (ev.target === releaseOverlay) closeReleaseModal(); });
    const addReleaseBtn = document.getElementById('add-release-btn');
    if (addReleaseBtn) addReleaseBtn.addEventListener('click', () => {
      document.getElementById('release-modal-overlay').hidden = false;
    });
    const releaseForm = document.getElementById('release-form');
    if (releaseForm) releaseForm.addEventListener('submit', submitRelease);
    loadDashboard();
    loadChanges();
    loadReleases();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

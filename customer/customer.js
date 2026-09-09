(function () {
  'use strict';

  const API = '/api/v1/customer';

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
    const parts = ['Current build: v' + (build.version || '?')];
    if (build.buildId) parts.push('Build: ' + build.buildId);
    if (build.commitSha) parts.push('Commit: ' + build.commitSha.slice(0, 7));
    if (build.artifactSha256) parts.push('Artifact: ' + build.artifactSha256.slice(0, 12) + '…');
    info.textContent = parts.join(' • ');
  }

  function statusClass(status) {
    if (status === 'RESOLVED') return 'resolved';
    if (status === 'RELEASED' || status === 'READY_FOR_CUSTOMER_VERIFICATION') return 'released';
    if (status === 'REOPENED') return 'reopened';
    if (status === 'NEEDS_EVIDENCE') return 'needs';
    return '';
  }

  function renderRequestCard(r) {
    const cardClass = 'request-card' + (r.historical ? ' historical' : '');
    const needsAction = r.status === 'READY_FOR_CUSTOMER_VERIFICATION' || r.status === 'RELEASED';
    const finalClass = cardClass + (needsAction && !r.historical ? ' action-required' : '') + (r.status === 'RESOLVED' ? ' resolved' : '');
    const card = el('div', finalClass);
    card.dataset.requestId = r.id;
    const header = el('div', 'request-header');
    const left = el('div');
    left.appendChild(el('div', 'request-id', r.customerRequestNumber || r.id));
    left.appendChild(el('div', 'request-title', r.title));
    header.appendChild(left);
    const right = el('div');
    if (r.historical) right.appendChild(el('span', 'badge historical', 'HISTORICAL'));
    right.appendChild(el('span', 'badge status status-' + r.status, r.status));
    header.appendChild(right);
    card.appendChild(header);
    const meta = el('div', 'request-meta');
    meta.appendChild(el('span', 'badge P' + (r.priority || '?').replace('P', ''), r.priority));
    meta.appendChild(el('span', 'badge', r.product));
    meta.appendChild(el('span', null, 'Updated: ' + (r.updatedAt || '').slice(0, 10)));
    card.appendChild(meta);
    // Customer-facing status
    const facing = el('div', 'request-facing-status ' + statusClass(r.status), r.customerFacingStatus || r.status);
    card.appendChild(facing);
    if (r.description) card.appendChild(el('p', 'request-description', r.description));
    if (r.releaseId) {
      const relObj = typeof r.releaseId === 'object' ? r.releaseId : {};
      const rel = el('div', 'request-release');
      rel.innerHTML = '<strong>Release:</strong> v' + (relObj.version || '?') + ' / Build: ' + (relObj.buildId || '?');
      if (relObj.artifactSha256) {
        rel.innerHTML += ' / Artifact: ' + relObj.artifactSha256.slice(0, 12) + '…';
      }
      card.appendChild(rel);
    }
    if (r.resolution) {
      const res = el('div', 'request-release');
      res.innerHTML = '<strong>Resolution:</strong> ' + (r.resolution || '');
      card.appendChild(res);
    }
    // Clear verification actions for RELEASED / READY_FOR_CUSTOMER_VERIFICATION
    if (r.status === 'READY_FOR_CUSTOMER_VERIFICATION' || r.status === 'RELEASED') {
      const actions = el('div', 'request-actions');
      const confirmBtn = el('button', 'btn-success', '✓ Confirm Issue Resolved');
      confirmBtn.addEventListener('click', (ev) => { ev.stopPropagation(); verifyRequest(r.id, 'CONFIRMED'); });
      const failBtn = el('button', 'btn-danger', '✗ Issue Still Exists');
      failBtn.addEventListener('click', (ev) => { ev.stopPropagation(); verifyRequest(r.id, 'FAILED'); });
      actions.appendChild(confirmBtn);
      actions.appendChild(failBtn);
      card.appendChild(actions);
    } else if (r.status === 'RESOLVED') {
      const actions = el('div', 'request-actions');
      const reopenBtn = el('button', 'btn-secondary', 'Reopen this request');
      reopenBtn.addEventListener('click', (ev) => { ev.stopPropagation(); reopenRequest(r.id); });
      actions.appendChild(reopenBtn);
      card.appendChild(actions);
    }
    // Click to open detail
    card.addEventListener('click', () => openDetail(r.id));
    return card;
  }

  function renderRequests(requests) {
    const historical = document.getElementById('requests-historical');
    const current = document.getElementById('requests-current');
    const historicalEmpty = document.getElementById('historical-empty');
    const currentEmpty = document.getElementById('current-empty');
    if (!historical || !current) return;
    historical.innerHTML = '';
    current.innerHTML = '';
    const hist = requests.filter(r => r.historical);
    const cur = requests.filter(r => !r.historical);
    hist.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    cur.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    if (hist.length === 0) historicalEmpty.hidden = false;
    else { historicalEmpty.hidden = true; hist.forEach(r => historical.appendChild(renderRequestCard(r))); }
    if (cur.length === 0) currentEmpty.hidden = false;
    else { currentEmpty.hidden = true; cur.forEach(r => current.appendChild(renderRequestCard(r))); }
  }

  async function loadRequests() {
    const { status, body } = await apiFetch('/requests');
    if (status === 200 && body && body.success) {
      renderBuildInfo(body.data.currentBuild);
      renderRequests(body.data.requests || []);
    } else {
      const root = document.getElementById('requests-current');
      if (root) root.innerHTML = '<p class="empty-state">Unable to load requests. Please sign in.</p>';
    }
  }

  async function openDetail(requestId) {
    const { status, body } = await apiFetch('/requests/' + encodeURIComponent(requestId));
    if (status !== 200 || !body || !body.success) {
      alert('Failed to load request detail');
      return;
    }
    const data = body.data;
    const req = data.request;
    const timeline = data.timeline || [];
    const releaseMatch = data.releaseMatch;
    const artifactId = data.artifactIdentity;
    const modal = document.getElementById('modal');
    const title = document.getElementById('modal-title');
    const body2 = document.getElementById('modal-body');
    title.textContent = req.customerRequestNumber + ' — ' + req.title;
    body2.innerHTML = '';
    // Facing status
    body2.appendChild(el('div', 'request-facing-status ' + statusClass(req.status), req.customerFacingStatus || req.status));
    // Description
    const descSection = el('div', 'detail-section');
    descSection.appendChild(el('h4', null, 'Description'));
    descSection.appendChild(el('p', null, req.description || 'No description.'));
    body2.appendChild(descSection);
    // Details grid
    const detailsSection = el('div', 'detail-section');
    detailsSection.appendChild(el('h4', null, 'Details'));
    const grid = el('div', 'detail-grid');
    [
      { label: 'Type', value: req.type },
      { label: 'Priority', value: req.priority },
      { label: 'Product', value: req.product },
      { label: 'Created', value: (req.createdAt || '').slice(0, 10) },
      { label: 'Last updated', value: (req.updatedAt || '').slice(0, 10) },
      { label: 'Status', value: req.status }
    ].forEach(d => {
      const item = el('div', 'detail-item');
      item.appendChild(el('div', 'detail-label', d.label));
      item.appendChild(el('div', 'detail-value', d.value || '—'));
      grid.appendChild(item);
    });
    detailsSection.appendChild(grid);
    body2.appendChild(detailsSection);
    // Release info
    if (req.releaseId) {
      const relObj = req.releaseId;
      const relSection = el('div', 'detail-section');
      relSection.appendChild(el('h4', null, 'Release Evidence'));
      const relGrid = el('div', 'detail-grid');
      [
        { label: 'Version', value: relObj.version || '—' },
        { label: 'Build', value: relObj.buildId || '—' },
        { label: 'Commit', value: relObj.commitSha ? relObj.commitSha.slice(0, 12) : '—' },
        { label: 'Artifact SHA-256', value: relObj.artifactSha256 ? relObj.artifactSha256.slice(0, 16) + '…' : '—' },
        { label: 'Released', value: relObj.releasedAt ? relObj.releasedAt.slice(0, 10) : '—' },
        { label: 'Match', value: releaseMatch && releaseMatch.matches ? '✓ Matches current build' : '✗ Mismatch' }
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
      tlSection.appendChild(el('h4', null, 'Timeline'));
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
        }
        if (cls) item.className = 'timeline-item ' + cls;
        const label = el('div', 'timeline-label');
        if (ev.type === 'verification') {
          label.textContent = ev.result === 'CONFIRMED' ? 'Customer confirmed resolution' : 'Customer reported issue remains';
        } else if (ev.fromStatus) {
          label.textContent = ev.fromStatus + ' → ' + ev.toStatus;
        } else {
          label.textContent = 'Created (' + ev.toStatus + ')';
        }
        const meta = el('div', 'timeline-meta');
        meta.textContent = (ev.timestamp || '').slice(0, 19).replace('T', ' ') + ' • ' + (ev.actor || 'system');
        item.appendChild(label);
        item.appendChild(meta);
        if (ev.note) item.appendChild(el('div', 'timeline-note', ev.note));
        tlDiv.appendChild(item);
      });
      tlSection.appendChild(tlDiv);
      body2.appendChild(tlSection);
    }
    // Actions in modal
    if (req.status === 'READY_FOR_CUSTOMER_VERIFICATION' || req.status === 'RELEASED') {
      const actions = el('div', 'request-actions');
      const confirmBtn = el('button', 'btn-success', '✓ Confirm Issue Resolved');
      confirmBtn.addEventListener('click', () => { closeModal(); verifyRequest(req.id, 'CONFIRMED'); });
      const failBtn = el('button', 'btn-danger', '✗ Issue Still Exists');
      failBtn.addEventListener('click', () => { closeModal(); verifyRequest(req.id, 'FAILED'); });
      actions.appendChild(confirmBtn);
      actions.appendChild(failBtn);
      body2.appendChild(actions);
    } else if (req.status === 'RESOLVED') {
      const actions = el('div', 'request-actions');
      const reopenBtn = el('button', 'btn-secondary', 'Reopen this request');
      reopenBtn.addEventListener('click', () => { closeModal(); reopenRequest(req.id); });
      actions.appendChild(reopenBtn);
      body2.appendChild(actions);
    }
    document.getElementById('modal-overlay').hidden = false;
  }

  function closeModal() {
    document.getElementById('modal-overlay').hidden = true;
  }

  async function submitNewRequest(ev) {
    ev.preventDefault();
    const form = ev.target;
    const msg = document.getElementById('form-message');
    msg.hidden = true;
    const data = {
      title: form.title.value,
      description: form.description.value,
      type: form.type.value,
      priority: form.priority.value,
      product: form.product.value
    };
    const { status, body } = await apiFetch('/requests', { method: 'POST', body: JSON.stringify(data) });
    if (status === 201 && body && body.success) {
      msg.className = 'form-message success';
      msg.textContent = 'Request ' + body.data.request.customerRequestNumber + ' has been submitted successfully.';
      msg.hidden = false;
      form.reset();
      await loadRequests();
    } else {
      msg.className = 'form-message error';
      msg.textContent = (body && body.message) || 'Failed to create request.';
      msg.hidden = false;
    }
  }

  async function verifyRequest(id, result) {
    const note = result === 'FAILED' ? (prompt('What is still not working?') || '') : '';
    const { status, body } = await apiFetch('/requests/' + encodeURIComponent(id) + '/verify', {
      method: 'POST',
      body: JSON.stringify({ result: result, note: note })
    });
    if (status === 200 && body && body.success) {
      if (result === 'CONFIRMED') {
        alert('Thank you. Your request has been confirmed as resolved.');
      } else {
        alert('Thank you. Your request has been reopened.');
      }
      await loadRequests();
    } else {
      alert('Verification failed: ' + ((body && body.message) || 'Unknown error'));
    }
  }

  async function reopenRequest(id) {
    const note = prompt('Why are you reopening this request?') || '';
    const { status, body } = await apiFetch('/requests/' + encodeURIComponent(id) + '/reopen', {
      method: 'POST',
      body: JSON.stringify({ note: note })
    });
    if (status === 200 && body && body.success) {
      alert('Your request has been reopened.');
      await loadRequests();
    } else {
      alert('Reopen failed: ' + ((body && body.message) || 'Unknown error'));
    }
  }

  function init() {
    const form = document.getElementById('new-request-form');
    if (form) form.addEventListener('submit', submitNewRequest);
    const closeBtn = document.getElementById('modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeModal(); });
    loadRequests();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

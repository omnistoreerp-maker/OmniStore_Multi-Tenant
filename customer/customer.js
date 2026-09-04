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
    const el = document.getElementById('build-info');
    if (!el || !build) return;
    el.textContent = 'Build: v' + (build.version || '?') + ' / ' + (build.buildId || '?') + (build.commitSha ? ' / ' + build.commitSha.slice(0, 7) : '');
  }

  function renderRequestCard(r) {
    const card = el('div', 'request-card' + (r.historical ? ' historical' : ''));
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
    if (r.description) card.appendChild(el('p', 'request-description', r.description));
    if (r.releaseId) {
      const rel = el('div', 'request-release');
      const relObj = typeof r.releaseId === 'object' ? r.releaseId : { version: '?', buildId: '?' };
      rel.innerHTML = '<strong>Release:</strong> v' + (relObj.version || '?') + ' / Build: ' + (relObj.buildId || '?');
      card.appendChild(rel);
    }
    if (r.resolution) {
      const res = el('div', 'request-release');
      res.innerHTML = '<strong>Resolution:</strong> ' + (r.resolution || '');
      card.appendChild(res);
    }
    if (r.status === 'READY_FOR_CUSTOMER_VERIFICATION') {
      const actions = el('div', 'request-actions');
      const confirmBtn = el('button', 'btn-primary', 'Confirm Resolved');
      confirmBtn.addEventListener('click', () => verifyRequest(r.id, 'CONFIRMED'));
      const failBtn = el('button', 'btn-danger', 'Still Not Resolved');
      failBtn.addEventListener('click', () => verifyRequest(r.id, 'FAILED'));
      actions.appendChild(confirmBtn);
      actions.appendChild(failBtn);
      card.appendChild(actions);
    } else if (r.status === 'RESOLVED') {
      const actions = el('div', 'request-actions');
      const reopenBtn = el('button', 'btn-secondary', 'Reopen');
      reopenBtn.addEventListener('click', () => reopenRequest(r.id));
      actions.appendChild(reopenBtn);
      card.appendChild(actions);
    }
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
      msg.textContent = 'Request ' + body.data.request.customerRequestNumber + ' created.';
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
      await loadRequests();
    } else {
      alert('Reopen failed: ' + ((body && body.message) || 'Unknown error'));
    }
  }

  function init() {
    const form = document.getElementById('new-request-form');
    if (form) form.addEventListener('submit', submitNewRequest);
    loadRequests();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

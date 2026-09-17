(function () {
  'use strict';

  const API = '/api/v1/platform-public';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function renderStats(stats) {
    const root = document.getElementById('stats');
    if (!root || !Array.isArray(stats)) return;
    root.innerHTML = '';
    const title = el('h2', 'section-title', 'Platform Overview');
    root.appendChild(title);
    const grid = el('div', 'stats');
    for (const s of stats) {
      const card = el('div', 'stat-card');
      card.appendChild(el('div', 'stat-value', String(s.value)));
      card.appendChild(el('div', 'stat-label', s.label));
      if (s.description) {
        const desc = el('div', 'stat-label', s.description);
        desc.style.marginTop = '4px';
        card.appendChild(desc);
      }
      grid.appendChild(card);
    }
    root.appendChild(grid);
  }

  function renderFeatures(features) {
    const root = document.getElementById('features');
    if (!root || !Array.isArray(features)) return;
    root.innerHTML = '';
    const title = el('h2', 'section-title', 'Core Modules');
    root.appendChild(title);
    const grid = el('div', 'features');
    for (const f of features) {
      const card = el('div', 'feature-card');
      const iconWrap = el('div', 'feature-icon');
      const icon = el('i', '', '');
      icon.className = 'fa-solid ' + (f.icon || 'fa-circle');
      iconWrap.appendChild(icon);
      card.appendChild(iconWrap);
      card.appendChild(el('h3', 'feature-title', f.title || f.id));
      card.appendChild(el('p', 'feature-body', f.description || ''));
      grid.appendChild(card);
    }
    root.appendChild(grid);
  }

  function renderHighlights(highlights) {
    const root = document.getElementById('highlights');
    if (!root || !Array.isArray(highlights)) return;
    root.innerHTML = '';
    const title = el('h2', 'section-title', 'Why OmniStore');
    root.appendChild(title);
    const grid = el('div', 'highlights');
    for (const h of highlights) {
      const card = el('div', 'highlight-card');
      card.appendChild(el('h3', 'highlight-title', h.title || ''));
      card.appendChild(el('p', 'highlight-body', h.body || ''));
      grid.appendChild(card);
    }
    root.appendChild(grid);
  }

  async function loadJSON(path) {
    const res = await fetch(API + path, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Failed to load ' + path + ': ' + res.status);
    const json = await res.json();
    if (!json || !json.success) throw new Error('Invalid envelope for ' + path);
    return json.data;
  }

  async function init() {
    try {
      const [catalog] = await Promise.all([
        loadJSON('/catalog')
      ]);
      if (catalog.meta) {
        const nameEl = document.getElementById('meta-name');
        const taglineEl = document.getElementById('meta-tagline');
        const versionEl = document.getElementById('meta-version');
        if (nameEl && catalog.meta.name) nameEl.textContent = catalog.meta.name;
        if (taglineEl && catalog.meta.tagline) taglineEl.textContent = catalog.meta.tagline;
        if (versionEl && catalog.meta.version) versionEl.textContent = catalog.meta.version;
      }
      renderStats(catalog.stats || []);
      renderFeatures(catalog.features || []);
      renderHighlights(catalog.highlights || []);
    } catch (err) {
      console.error('platform.js init error:', err);
      const root = document.getElementById('stats');
      if (root) {
        root.innerHTML = '<p style="color:#b91c1c">Unable to load platform data. Please try again later.</p>';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

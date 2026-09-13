(function () {
  'use strict';

  const API = '/api/v1/companies-public';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function getCompanyIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return (params.get('id') || '').trim();
  }

  function show(elId) {
    const e = document.getElementById(elId);
    if (e) e.hidden = false;
  }

  function hide(elId) {
    const e = document.getElementById(elId);
    if (e) e.hidden = true;
  }

  function renderIdentity(identity) {
    if (!identity) return;
    const nameEl = document.getElementById('profile-name');
    const catEl = document.getElementById('profile-category');
    const descEl = document.getElementById('profile-short-description');
    const logoEl = document.getElementById('profile-logo');

    if (nameEl) nameEl.textContent = identity.displayName || 'Company Profile';
    if (catEl) catEl.textContent = identity.category || '';
    if (descEl) descEl.textContent = identity.shortDescription || '';
    if (logoEl && identity.logo && identity.logo.url) {
      logoEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = identity.logo.url;
      img.alt = identity.logo.alt || identity.displayName || 'Company logo';
      logoEl.appendChild(img);
    } else if (logoEl && identity.displayName) {
      logoEl.textContent = identity.displayName.charAt(0).toUpperCase();
    }

    const aboutDesc = document.getElementById('about-full-description');
    if (aboutDesc) {
      if (identity.fullDescription) {
        aboutDesc.textContent = identity.fullDescription;
      } else {
        hide('about-full-description');
        show('about-empty');
      }
    }
  }

  function renderContact(contact) {
    const grid = document.getElementById('contact-grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (!contact) {
      show('contact-empty');
      return;
    }
    const fields = [
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email' },
      { key: 'website', label: 'Website' },
      { key: 'address', label: 'Address' },
      { key: 'city', label: 'City' },
      { key: 'region', label: 'Region' },
      { key: 'workingHours', label: 'Working Hours' }
    ];
    let hasAny = false;
    for (const f of fields) {
      const v = contact[f.key];
      if (v && String(v).trim()) {
        hasAny = true;
        const item = el('div', 'contact-item');
        item.appendChild(el('div', 'contact-label', f.label));
        const val = el('div', 'contact-value');
        if (f.key === 'website' || f.key === 'email') {
          const a = document.createElement('a');
          a.href = f.key === 'email' ? 'mailto:' + v : (v.startsWith('http') ? v : 'https://' + v);
          a.textContent = v;
          a.rel = 'noopener noreferrer';
          a.target = '_blank';
          val.appendChild(a);
        } else if (f.key === 'phone') {
          const a = document.createElement('a');
          a.href = 'tel:' + v;
          a.textContent = v;
          val.appendChild(a);
        } else {
          val.textContent = v;
        }
        item.appendChild(val);
        grid.appendChild(item);
      }
    }
    if (!hasAny) show('contact-empty');
    else hide('contact-empty');

    const actions = document.getElementById('profile-actions');
    if (actions) {
      actions.innerHTML = '';
      if (contact.website) {
        const a = document.createElement('a');
        a.className = 'btn-primary';
        a.href = contact.website.startsWith('http') ? contact.website : 'https://' + contact.website;
        a.textContent = 'Visit Website';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        actions.appendChild(a);
      }
      if (contact.phone) {
        const a = document.createElement('a');
        a.className = 'btn-secondary';
        a.href = 'tel:' + contact.phone;
        a.textContent = 'Call';
        actions.appendChild(a);
      }
    }
  }

  function renderRefList(gridId, emptyId, items) {
    const grid = document.getElementById(gridId);
    const empty = document.getElementById(emptyId);
    if (!grid) return;
    grid.innerHTML = '';
    if (!Array.isArray(items) || items.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    for (const item of items) {
      const card = el('div', 'ref-card');
      if (item.title) card.appendChild(el('h3', 'ref-title', item.title));
      const metaParts = [];
      if (item.category) metaParts.push(item.category);
      if (item.displayState) metaParts.push(item.displayState);
      if (metaParts.length) {
        card.appendChild(el('p', 'ref-meta', metaParts.join(' • ')));
      }
      if (item.description || item.summary) {
        card.appendChild(el('p', 'ref-body', item.description || item.summary));
      }
      grid.appendChild(card);
    }
  }

  function renderMedia(items) {
    const grid = document.getElementById('media-grid');
    const empty = document.getElementById('media-empty');
    if (!grid) return;
    grid.innerHTML = '';
    if (!Array.isArray(items) || items.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    for (const m of items) {
      const item = el('div', 'media-item');
      const icon = el('div', 'media-icon');
      icon.textContent = m.type === 'video' ? '▶' : '◉';
      item.appendChild(icon);
      const info = el('div');
      info.appendChild(el('p', 'media-title', m.title || m.type || 'Media'));
      const metaParts = [];
      if (m.source) metaParts.push(m.source);
      if (m.type) metaParts.push(m.type);
      if (metaParts.length) info.appendChild(el('p', 'media-meta', metaParts.join(' • ')));
      item.appendChild(info);
      grid.appendChild(item);
    }
  }

  function renderSocial(channels) {
    const list = document.getElementById('social-list');
    const empty = document.getElementById('social-empty');
    if (!list) return;
    list.innerHTML = '';
    if (!Array.isArray(channels) || channels.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    for (const ch of channels) {
      const chip = document.createElement('span');
      chip.className = 'social-chip';
      const provider = ch.provider ? ch.provider.charAt(0).toUpperCase() + ch.provider.slice(1) : 'Channel';
      chip.textContent = ch.handle ? provider + ': ' + ch.handle : provider;
      list.appendChild(chip);
    }
  }

  function showError(message) {
    hide('about');
    hide('contact');
    hide('products');
    hide('services');
    hide('offers');
    hide('media');
    hide('social');
    show('error');
    const msg = document.getElementById('error-message');
    if (msg) msg.textContent = message || 'Unable to load this company profile.';
  }

  async function loadProfile(companyId) {
    const res = await fetch(API + '/' + encodeURIComponent(companyId) + '/profile', {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    if (res.status === 404) {
      throw new Error('Company profile not found');
    }
    if (!res.ok) {
      throw new Error('Failed to load profile: ' + res.status);
    }
    const json = await res.json();
    if (!json || !json.success || !json.data) {
      throw new Error('Invalid profile response');
    }
    return json.data;
  }

  async function init() {
    const companyId = getCompanyIdFromUrl();
    if (!companyId) {
      showError('No company ID specified. Use ?id=companyId in the URL.');
      return;
    }
    try {
      const profile = await loadProfile(companyId);
      renderIdentity(profile.identity);
      renderContact(profile.contact);
      renderRefList('products-grid', 'products-empty', profile.products);
      renderRefList('services-grid', 'services-empty', profile.services);
      renderRefList('offers-grid', 'offers-empty', profile.offers);
      renderMedia(profile.media);
      renderSocial(profile.socialChannels);
    } catch (err) {
      console.error('company.js init error:', err);
      showError(err.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

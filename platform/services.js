/* ============================================================
   OmniStore Unified Services Catalog — services.js
   Server-authoritative identity. All service data comes from
   GET /api/v1/services/catalog with same-origin credentials.
   RTL-first (ar). Static JS only. No framework. ============================================================ */

(function () {
  'use strict';

  const API_BASE = '/api/v1';
  const CATALOG_API = API_BASE + '/services/catalog';
  const LOGOUT_API = API_BASE + '/auth/logout';

  const htmlEl = document.documentElement;
  const storedLang = (function () {
    try {
      const v = localStorage.getItem('omnistore_services_lang');
      if (v === 'ar' || v === 'en') return v;
    } catch (e) {}
    return 'ar';
  })();

  htmlEl.setAttribute('lang', storedLang);
  htmlEl.setAttribute('dir', storedLang === 'ar' ? 'rtl' : 'ltr');

  // ---------- Elements ----------
  const langBtnAr = document.querySelector('button.omni-lang-btn[data-lang="ar"]');
  const langBtnEn = document.querySelector('button.omni-lang-btn[data-lang="en"]');
  const logoutBtn = document.getElementById('logoutBtn');
  const ctxRoleEl = document.getElementById('ctxRole');
  const contextBar = document.getElementById('contextBar');
  const pageStatus = document.getElementById('pageStatus');
  const searchInput = document.getElementById('searchInput');
  const categoryChips = document.getElementById('categoryChips');
  const scopeChips = document.getElementById('scopeChips');
  const clearFiltersBtn = document.getElementById('clearFilters');
  const serviceCountEl = document.getElementById('serviceCount');
  const serviceGrid = document.getElementById('service-grid');
  const emptyState = document.getElementById('emptyState');
  const emptyTitle = document.getElementById('emptyTitle');
  const emptyDesc = document.getElementById('emptyDesc');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalClose = document.getElementById('modalClose');
  const modalIcon = document.getElementById('modalIcon');
  const modalTitle = document.getElementById('modalTitle');
  const modalDesc = document.getElementById('modalDesc');
  const metaCategory = document.getElementById('metaCategory');
  const metaScope = document.getElementById('metaScope');
  const metaState = document.getElementById('metaState');
  const metaDestination = document.getElementById('metaDestination');
  const modalLaunch = document.getElementById('modalLaunch');

  // ---------- i18n ----------
  const UI = {
    ar: {
      page_title: 'خدمات OmniStore — كل خدماتك في مكان واحد',
      page_subtitle: 'الكتالوج الموحد للخدمات يعرض كل القدرات التي تم بناؤها بالفعل في منصة OmniStore، مصنفة حسب الدور والنطاق والصلاحية.',
      logout: 'تسجيل خروج',
      search_placeholder: 'ابحث باسم الخدمة أو وصفها…',
      filter_category: 'التصنيف',
      filter_scope: 'نطاق الخدمة',
      clear_filters: 'مسح كل الفلاتر',
      service_count: 'خدمة',
      loading: 'جارٍ تحميل الكتالوج…',
      error_title: 'تعذر تحميل الكتالوج',
      error_retry: 'محاولة مرة أخرى',
      auth_required: 'يُRequire تسجيل الدخول لعرض الكتالوج',
      scope_tenant: 'مستأجر',
      scope_master: 'منصة',
      scope_internal: 'داخلي',
      all_categories: 'الجميع',
      all_scopes: 'الجميع',
      details_title: 'تفاصيل الخدمة',
      category_label: 'التصنيف',
      scope_label: 'النطاق',
      status_label: 'الحالة',
      destination_label: 'الوجهة',
      source_label: 'المصدر',
      launch_btn: 'فتح الخدمة',
      backend_only_label: 'خدمة خلفية فقط — لا توجد واجهة تشغيل',
      not_verified_label: 'غير مؤكدة — غير متاحة للتشغيل',
      partial_label: 'قيد الاستكمال',
      ready_label: 'جاهزة',
      empty_title: 'لا توجد نتائج',
      empty_desc: 'جرب تعديل كلمات البحث أو الفلاتر.',
      context_role: 'الدور:',
      context_tenant: 'الشركة:'
    },
    en: {
      page_title: 'OmniStore Services — All Your Services in One Place',
      page_subtitle: 'The unified services catalog displays all capabilities already built in the OmniStore platform, categorized by role, scope, and permission.',
      logout: 'Logout',
      search_placeholder: 'Search by service name or description…',
      filter_category: 'Category',
      filter_scope: 'Service scope',
      clear_filters: 'Clear all filters',
      service_count: 'services',
      loading: 'Loading catalog…',
      error_title: 'Failed to load catalog',
      error_retry: 'Retry',
      auth_required: 'Authentication required to view catalog',
      scope_tenant: 'Tenant',
      scope_master: 'Platform',
      scope_internal: 'Internal',
      all_categories: 'All categories',
      all_scopes: 'All scopes',
      details_title: 'Service details',
      category_label: 'Category',
      scope_label: 'Scope',
      status_label: 'Status',
      destination_label: 'Destination',
      source_label: 'Source',
      launch_btn: 'Open service',
      backend_only_label: 'Backend-only capability — no operational frontend',
      not_verified_label: 'Not verified — not available for launch',
      partial_label: 'In progress',
      ready_label: 'Ready',
      empty_title: 'No results',
      empty_desc: 'Try adjusting your search or filters.',
      context_role: 'Role:',
      context_tenant: 'Company:'
    }
  };

  const STATE_LABELS = {
    ar: { READY: 'جاهزة', PARTIAL: 'قيد الاستكمال', BACKEND_ONLY: 'خلفية فقط', NOT_VERIFIED: 'غير مؤكدة' },
    en: { READY: 'Ready', PARTIAL: 'In progress', BACKEND_ONLY: 'Backend Only', NOT_VERIFIED: 'Not Verified' }
  };

  // ---------- State ----------
  let state = {
    lang: storedLang,
    services: [],
    search: '',
    category: '',
    scope: ''
  };

  // ---------- Helpers ----------
  function t(key) {
    return (UI[state.lang] && UI[state.lang][key]) || key;
  }

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function setPageDir(lang) {
    htmlEl.setAttribute('lang', lang);
    htmlEl.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    try { localStorage.setItem('omnistore_services_lang', lang); } catch (e) {}
    updateLangButtons();
  }

  function updateLangButtons() {
    if (langBtnAr) langBtnAr.classList.toggle('is-active', state.lang === 'ar');
    if (langBtnEn) langBtnEn.classList.toggle('is-active', state.lang === 'en');
  }

  function showStatus(msg, type) {
    pageStatus.textContent = msg;
    pageStatus.className = 'page-status ' + (type || '') + (type ? '' : ' hidden');
    if (!type) pageStatus.classList.add('hidden');
    else pageStatus.classList.remove('hidden');
  }

  function hideStatus() {
    pageStatus.classList.add('hidden');
  }

  // ---------- Render ----------
  function renderChips() {
    // Category chips
    categoryChips.innerHTML = '';
    const allCat = document.createElement('button');
    allCat.className = 'chip' + (state.category === '' ? ' is-active' : '');
    allCat.textContent = t('all_categories');
    allCat.setAttribute('aria-pressed', state.category === '' ? 'true' : 'false');
    allCat.addEventListener('click', () => { state.category = ''; renderChips(); renderServices(); });
    categoryChips.appendChild(allCat);

    const cats = [...new Set(state.services.map(s => s.category).filter(Boolean))];
    cats.forEach(cat => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (state.category === cat ? ' is-active' : '');
      chip.textContent = cat;
      chip.setAttribute('aria-pressed', state.category === cat ? 'true' : 'false');
      chip.addEventListener('click', () => { state.category = cat; renderChips(); renderServices(); });
      categoryChips.appendChild(chip);
    });

    // Scope chips
    scopeChips.innerHTML = '';
    const allScope = document.createElement('button');
    allScope.className = 'chip' + (state.scope === '' ? ' is-active' : '');
    allScope.textContent = t('all_scopes');
    allScope.setAttribute('aria-pressed', state.scope === '' ? 'true' : 'false');
    allScope.addEventListener('click', () => { state.scope = ''; renderChips(); renderServices(); });
    scopeChips.appendChild(allScope);

    const scopes = [...new Set(state.services.map(s => s.scope).filter(Boolean))];
    scopes.forEach(sc => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (state.scope === sc ? ' is-active' : '');
      chip.textContent = t('scope_' + sc);
      chip.setAttribute('aria-pressed', state.scope === sc ? 'true' : 'false');
      chip.addEventListener('click', () => { state.scope = sc; renderChips(); renderServices(); });
      scopeChips.appendChild(chip);
    });
  }

  function matchesSearch(svc) {
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    const haystack = [
      svc.name && svc.name.ar ? svc.name.ar : '',
      svc.name && svc.name.en ? svc.name.en : '',
      svc.description && svc.description.ar ? svc.description.ar : '',
      svc.description && svc.description.en ? svc.description.en : '',
      svc.category || '',
      svc.scope || ''
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  }

  function renderServices() {
    const filtered = state.services.filter(svc =>
      matchesSearch(svc) &&
      (!state.category || svc.category === state.category) &&
      (!state.scope || svc.scope === state.scope)
    );

    serviceGrid.innerHTML = '';

    if (filtered.length === 0) {
      emptyState.style.display = 'flex';
      emptyTitle.textContent = t('empty_title');
      emptyDesc.textContent = t('empty_desc');
      serviceCountEl.textContent = '0 ' + t('service_count');
      return;
    }

    emptyState.style.display = 'none';
    serviceCountEl.textContent = filtered.length + ' ' + t('service_count');

    filtered.forEach(svc => {
      const card = document.createElement('article');
      card.className = 'osc-card';
      card.setAttribute('role', 'gridcell');
      card.tabIndex = 0;

      const scopeLabel = {
        tenant: t('scope_tenant'),
        master: t('scope_master'),
        internal: t('scope_internal')
      }[svc.scope] || svc.scope;

      const stateLabel = STATE_LABELS[state.lang] && STATE_LABELS[state.lang][svc.status] ? STATE_LABELS[state.lang][svc.status] : svc.status;
      const name = svc.name && svc.name[state.lang] ? svc.name[state.lang] : (svc.name && svc.name.en ? svc.name.en : svc.id);
      const desc = svc.description && svc.description[state.lang] ? svc.description[state.lang] : (svc.description && svc.description.en ? svc.description.en : '');

      const isUnavailable = svc.status === 'NOT_VERIFIED';
      if (isUnavailable) card.classList.add('unavailable');

      card.innerHTML = `
        <div class="osc-card-header">
          <div class="osc-card-icon">📦</div>
          <div class="osc-card-body">
            <span class="osc-scope-label ${svc.scope}">${esc(scopeLabel)}</span>
            <h3 class="osc-card-name">${esc(name)}</h3>
            <p class="osc-card-desc">${esc(desc)}</p>
            <div class="osc-card-meta">
              <span class="osc-card-meta-item">${esc(STATE_LABELS[state.lang] && STATE_LABELS[state.lang][svc.status] ? STATE_LABELS[state.lang][svc.status] : svc.status)}</span>
            </div>
          </div>
        </div>
        <div class="osc-status-badge ${svc.status}">${esc(stateLabel)}</div>
      `;

      card.addEventListener('click', () => openModal(svc));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openModal(svc);
        }
      });
      serviceGrid.appendChild(card);
    });
  }

  // ---------- Modal ----------
  function openModal(svc) {
    const name = svc.name && svc.name[state.lang] ? svc.name[state.lang] : (svc.name && svc.name.en ? svc.name.en : svc.id);
    const desc = svc.description && svc.description[state.lang] ? svc.description[state.lang] : (svc.description && svc.description.en ? svc.description.en : '');
    const scopeLabel = {
      tenant: t('scope_tenant'),
      master: t('scope_master'),
      internal: t('scope_internal')
    }[svc.scope] || svc.scope;
    const stateLabel = STATE_LABELS[state.lang] && STATE_LABELS[state.lang][svc.status] ? STATE_LABELS[state.lang][svc.status] : svc.status;

    modalIcon.textContent = '📦';
    modalTitle.textContent = esc(name);
    modalDesc.textContent = esc(desc);
    metaCategory.textContent = esc(svc.category || '—');
    metaScope.textContent = esc(scopeLabel);
    metaState.textContent = esc(stateLabel);
    metaState.className = 'meta-value status-badge ' + svc.status;
    metaDestination.textContent = esc(svc.destination || '—');

    // Build launch action
    modalLaunch.innerHTML = '';
    if (svc.status === 'READY' && svc.destination) {
      const btn = document.createElement('button');
      btn.className = 'btn-primary';
      btn.textContent = t('launch_btn');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (svc.destination.startsWith('http')) {
          window.open(svc.destination, '_blank', 'noopener,noreferrer');
        } else {
          window.location.href = svc.destination;
        }
      });
      modalLaunch.appendChild(btn);
    } else if (svc.status === 'BACKEND_ONLY') {
      const span = document.createElement('span');
      span.className = 'meta-value';
      span.style.color = '#6b7280';
      span.textContent = t('backend_only_label');
      modalLaunch.appendChild(span);
    } else if (svc.status === 'NOT_VERIFIED') {
      const span = document.createElement('span');
      span.className = 'meta-value';
      span.style.color = '#9ca3af';
      span.textContent = t('not_verified_label');
      modalLaunch.appendChild(span);
    } else if (svc.status === 'PARTIAL') {
      const span = document.createElement('span');
      span.className = 'meta-value';
      span.style.color = '#f59e0b';
      span.textContent = t('partial_label');
      modalLaunch.appendChild(span);
    }

    modalOverlay.style.display = 'flex';
    modalOverlay.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    modalOverlay.style.display = 'none';
    modalOverlay.setAttribute('aria-hidden', 'true');
  }

  // ---------- Auth ----------
  async function loadCatalog() {
    showStatus(t('loading'), 'loading');
    try {
      const res = await fetch(CATALOG_API, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      });

      if (res.status === 401) {
        showStatus(t('auth_required'), 'error');
        if (logoutBtn) logoutBtn.style.display = 'inline-block';
        return;
      }

      if (!res.ok) {
        showStatus(t('error_title'), 'error');
        return;
      }

      const data = await res.json();

      // Show user context
      if (data.user) {
        contextBar.style.display = 'flex';
        if (ctxRoleEl) ctxRoleEl.textContent = data.user.role || '—';
      }

      state.services = data.services || [];
      renderChips();
      renderServices();
      hideStatus();
    } catch (err) {
      showStatus(t('error_title'), 'error');
      console.error('Catalog load error:', err);
    }
  }

  async function doLogout() {
    try {
      await fetch(LOGOUT_API, { method: 'POST', credentials: 'same-origin' });
    } catch (e) {}
    window.location.href = '/index.html';
  }

  // ---------- Init ----------
  function init() {
    // Language toggle
    if (langBtnAr) langBtnAr.addEventListener('click', () => { setPageLang('ar'); renderChips(); renderServices(); });
    if (langBtnEn) langBtnEn.addEventListener('click', () => { setPageLang('en'); renderChips(); renderServices(); });

    // Logout
    if (logoutBtn) logoutBtn.addEventListener('click', doLogout);

    // Search
    searchInput.addEventListener('input', (e) => {
      state.search = e.target.value;
      renderServices();
    });

    // Clear filters
    clearFiltersBtn.addEventListener('click', () => {
      state.search = '';
      state.category = '';
      state.scope = '';
      searchInput.value = '';
      renderChips();
      renderServices();
    });

    // Modal close
    modalClose.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    // Load catalog
    loadCatalog();
  }

  function setPageLang(lang) {
    state.lang = lang;
    setPageDir(lang);
    updateLangButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

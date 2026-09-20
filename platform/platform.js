(function () {
  'use strict';

  const API = '/api/v1/platform-public';
  const STORAGE_KEY = 'omnistore_platform_lang';

  const TRANSLATIONS = {
    en: {
      lang: 'en',
      dir: 'ltr',
      activity_label: 'Platform Activity',
      activity_hint: 'Live public activity stats are not configured yet.',
      live_label: 'Live',
      hero_title: 'Everything your business needs, one platform.',
      hero_desc: 'Explore the OmniStore ecosystem: marketplace, business services, and more.',
      cta: 'Open Application',
      nav_business: 'Business Management',
      footer_text: 'OmniStore Platform v',
      status_active: 'Active',
      status_coming_soon: 'Coming Soon',
      status_under_construction: 'Under Construction',
      cta_open: 'Open',
      section_platform_services: 'Platform Services',
      section_overview: 'Platform Overview',
      section_core_modules: 'Core Modules',
      section_why: 'Why OmniStore',
      section_marketplace: 'Marketplace',
      section_business_services: 'Business Management Services',
      section_student_services: 'Student Services',
      section_game_hosting: 'Game Hosting',
      section_media_reels: 'Media / Reels',
      section_support: 'Support',
      visitors_now_label: 'Visitors Now',
      registered_users_label: 'Registered Users',
      registered_users_hint: 'Accounts on the platform',
      active_businesses_label: 'Active Businesses',
      active_businesses_hint: 'Companies currently active',
      orders_today_label: 'Orders Today',
      orders_today_hint: 'Sales orders placed today',
      activity_unavailable: 'Unavailable',
      activity_error: 'Unable to load activity stats'
    },
    ar: {
      lang: 'ar',
      dir: 'rtl',
      activity_label: 'نشاط المنصة',
      activity_hint: 'إحصاءات النشاط العام المباشر غير مُفعّلة بعد.',
      live_label: 'مباشر',
      hero_title: 'كل ما تحتاجه أعمالك في منصة واحدة.',
      hero_desc: 'استكشف نظام OmniStore: السوق، خدمات الأعمال، والمزيد.',
      cta: 'فتح التطبيق',
      nav_business: 'إدارة الأعمال',
      footer_text: 'منصة OmniStore إصدار',
      status_active: 'متاح',
      status_coming_soon: 'قريباً',
      status_under_construction: 'قيد الإنشاء',
      cta_open: 'فتح',
      section_platform_services: 'خدمات المنصة',
      section_overview: 'نظرة عامة على المنصة',
      section_core_modules: 'الوحدات الأساسية',
      section_why: 'لماذا OmniStore',
      section_marketplace: 'السوق',
      section_business_services: 'خدمات إدارة الأعمال',
      section_student_services: 'خدمات الطلاب',
      section_game_hosting: 'استضافة الألعاب',
      section_media_reels: 'الوسائط / الريلز',
      section_support: 'الدعم',
      visitors_now_label: 'الزوار الآن',
      registered_users_label: 'المستخدمون المسجلون',
      registered_users_hint: 'حسابات على المنصة',
      active_businesses_label: 'الشركات النشطة',
      active_businesses_hint: 'الشركات النشطة حالياً',
      orders_today_label: 'طلبات اليوم',
      orders_today_hint: 'طلبات البيع المسجلة اليوم',
      activity_unavailable: 'غير متاح',
      activity_error: 'تعذر تحميل إحصاءات النشاط'
    }
  };

  function getLang() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'ar' || saved === 'en') return saved;
    } catch (_) {}
    return 'en';
  }

  function setLang(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (_) {}
    applyLang(lang);
  }

  function applyLang(lang) {
    const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
    const html = document.documentElement;
    html.setAttribute('lang', t.lang);
    html.setAttribute('dir', t.dir);

    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      const key = node.getAttribute('data-i18n');
      if (t[key] !== undefined) node.textContent = t[key];
    });

    const nameEl = document.getElementById('meta-name');
    const taglineEl = document.getElementById('meta-tagline');
    if (nameEl && t.platform_name) nameEl.textContent = t.platform_name;
    if (taglineEl && t.platform_tagline) taglineEl.textContent = t.platform_tagline;

    const switchBtn = document.getElementById('lang-switch');
    if (switchBtn) switchBtn.textContent = lang === 'en' ? 'العربية' : 'English';
  }

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

  function statusLabel(status) {
    const lang = getLang();
    const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
    if (status === 'active') return t.status_active;
    if (status === 'coming-soon') return t.status_coming_soon;
    if (status === 'under-construction') return t.status_under_construction;
    return status;
  }

  function sectionTitle(id) {
    const lang = getLang();
    const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
    const key = 'section_' + id;
    if (t[key]) return t[key];
    const fallback = TRANSLATIONS.en[key];
    if (fallback) return fallback;
    return id;
  }

  function renderSections(sections) {
    const root = document.getElementById('sections');
    if (!root) return;
    root.innerHTML = '';
    if (!Array.isArray(sections) || sections.length === 0) return;

    const lang = getLang();
    const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
    const title = el('h2', 'section-title', t.section_platform_services || 'Platform Services');
    root.appendChild(title);

    const grid = el('div', 'sections-grid');
    for (const s of sections) {
      const card = el('div', 'section-card');
      const iconWrap = el('div', 'section-icon');
      const icon = el('i', '', '');
      icon.className = 'fa-solid ' + (s.icon || 'fa-circle');
      iconWrap.appendChild(icon);
      card.appendChild(iconWrap);

      const header = el('div', 'section-header');
      header.appendChild(el('h3', 'section-title', sectionTitle(s.id)));
      const badge = el('span', 'section-badge ' + ('section-badge-' + (s.status || 'active').replace(/\s+/g, '-')), statusLabel(s.status));
      header.appendChild(badge);
      card.appendChild(header);

      card.appendChild(el('p', 'section-desc', s.description || ''));

      if (s.url && s.status === 'active') {
        const link = el('a', 'section-link', t.cta_open || 'Open');
        link.href = s.url;
        card.appendChild(link);
      } else {
        const disabled = el('span', 'section-link section-link-disabled', statusLabel(s.status));
        card.appendChild(disabled);
      }

      grid.appendChild(card);
    }
    root.appendChild(grid);
  }

  function renderActivity() {
    const lang = getLang();
    const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
    const visitorsRoot = document.getElementById('activity-visitors-now');
    const usersRoot = document.getElementById('activity-registered-users');
    const businessesRoot = document.getElementById('activity-active-businesses');
    const ordersRoot = document.getElementById('activity-orders-today');
    const liveRoot = document.getElementById('activity-visitors-live');

    if (visitorsRoot) visitorsRoot.textContent = '--';
    if (usersRoot) usersRoot.textContent = '--';
    if (businessesRoot) businessesRoot.textContent = '--';
    if (ordersRoot) ordersRoot.textContent = t.activity_unavailable;
    if (liveRoot) liveRoot.style.display = 'none';
  }

  function formatNumber(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '--';
    return String(n);
  }

  function animateValue(element, newValue) {
    if (!element) return;
    const current = element.textContent;
    if (current === String(newValue)) return;
    element.textContent = newValue;
    element.classList.remove('updating');
    void element.offsetWidth;
    element.classList.add('updating');
  }

  async function loadActivityStats() {
    const lang = getLang();
    const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
    const visitorsRoot = document.getElementById('activity-visitors-now');
    const usersRoot = document.getElementById('activity-registered-users');
    const businessesRoot = document.getElementById('activity-active-businesses');
    const ordersRoot = document.getElementById('activity-orders-today');
    const liveRoot = document.getElementById('activity-visitors-live');

    if (visitorsRoot) visitorsRoot.textContent = '...';
    if (usersRoot) usersRoot.textContent = '...';
    if (businessesRoot) businessesRoot.textContent = '...';
    if (ordersRoot) ordersRoot.textContent = '...';

    try {
      const data = await loadJSON('/stats');
      animateValue(visitorsRoot, formatNumber(data.visitorsNow));
      animateValue(usersRoot, formatNumber(data.registeredUsers));
      animateValue(businessesRoot, formatNumber(data.activeBusinesses));
      if (ordersRoot) {
        const val = data.ordersToday === null ? t.activity_unavailable : formatNumber(data.ordersToday);
        animateValue(ordersRoot, val);
      }
      if (liveRoot) liveRoot.style.display = 'inline-flex';
    } catch (err) {
      console.error('platform.js activity stats error:', err);
      if (visitorsRoot) visitorsRoot.textContent = '--';
      if (usersRoot) usersRoot.textContent = '--';
      if (businessesRoot) businessesRoot.textContent = '--';
      if (ordersRoot) ordersRoot.textContent = t.activity_unavailable;
      if (liveRoot) liveRoot.style.display = 'none';
    }
  }

  function visitorId() {
    const KEY = 'omnistore_platform_visitor_id';
    try {
      let id = localStorage.getItem(KEY);
      if (!id) {
        id = 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(KEY, id);
      }
      return id;
    } catch (_) {
      return 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }
  }

  async function sendHeartbeat() {
    const id = visitorId();
    try {
      await fetch(API + '/activity/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ visitorId: id })
      });
    } catch (err) {
      // heartbeat failures are non-critical
    }
  }

  let heartbeatTimer = null;
  let statsTimer = null;

  function startHeartbeat() {
    stopHeartbeat();
    sendHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, 60000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  function startStatsRefresh() {
    stopStatsRefresh();
    loadActivityStats();
    statsTimer = setInterval(loadActivityStats, 30000);
  }

  function stopStatsRefresh() {
    if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
  }

  function bindVisibility() {
    if (typeof document === 'undefined' || typeof document.visibilityState === 'undefined') return;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        startHeartbeat();
        startStatsRefresh();
      } else {
        stopHeartbeat();
        stopStatsRefresh();
      }
    });
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
      const lang = getLang();
      applyLang(lang);

      const [catalog, sections] = await Promise.all([
        loadJSON('/catalog'),
        loadJSON('/sections').catch(function () {
          return { sections: [] };
        })
      ]);

      if (catalog.meta) {
        const nameEl = document.getElementById('meta-name');
        const taglineEl = document.getElementById('meta-tagline');
        const versionEl = document.getElementById('meta-version');
        if (nameEl && catalog.meta.name) nameEl.textContent = catalog.meta.name;
        if (taglineEl && catalog.meta.tagline) taglineEl.textContent = catalog.meta.tagline;
        if (versionEl && catalog.meta.version) versionEl.textContent = catalog.meta.version;
      }

      renderActivity();
      renderStats(catalog.stats || []);
      renderFeatures(catalog.features || []);
      renderHighlights(catalog.highlights || []);
      renderSections((sections && sections.sections) || []);

      await loadActivityStats();
      startHeartbeat();
      startStatsRefresh();
    } catch (err) {
      console.error('platform.js init error:', err);
      const root = document.getElementById('stats');
      if (root) {
        root.innerHTML = '<p style="color:#b91c1c">Unable to load platform data. Please try again later.</p>';
      }
    }
  }

  function bindEvents() {
    const switchBtn = document.getElementById('lang-switch');
    if (switchBtn) {
      switchBtn.addEventListener('click', function () {
        const next = getLang() === 'en' ? 'ar' : 'en';
        setLang(next);
      });
    }
    bindVisibility();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindEvents();
      init();
    });
  } else {
    bindEvents();
    init();
  }
})();

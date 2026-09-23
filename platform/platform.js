(function () {
  'use strict';

  const API = '/api/v1/platform-public';
  const STORAGE_KEY = 'omnistore_platform_lang';

  const TRANSLATIONS = {
    en: {
      lang: 'en',
      dir: 'ltr',
      platform_name: 'OmniStore ERP',
      platform_tagline: 'Multi-Tenant Enterprise Resource Planning',
      brand_tag: 'Unified Services Platform',
      activity_label: 'Platform Activity',
      activity_hint: 'Live public activity stats are not configured yet.',
      live_label: 'Live',
      hero_badge: 'Unified System',
      hero_pill: 'Integrated digital and business solutions',
      hero_title: 'OmniStore ERP',
      hero_title_accent: 'One platform',
      hero_title_rest: 'for digital, business and entertainment services',
      hero_desc: 'A modern workspace combining cloud marketplaces, specialized hosting, and digital business services in one unified, performance-first stack.',
      cta: 'Open Application',
      cta_market: 'Explore Market',
      cta_business: 'Business Services',
      cta_title: 'Ready to start your journey with OmniStore?',
      cta_sub: 'Open the market or browse business services in seconds.',
      nav_home: 'Home',
      nav_market: 'Market',
      nav_business: 'Business Solutions',
      nav_game: 'Game Hosting',
      nav_app: 'Open Application',
      nav_market_short: 'Market',
      nav_business_short: 'Business',
      nav_game_short: 'Games',
      nav_app_short: 'App',
      footer_text: 'OmniStore Platform v',
      footer_rights: 'All rights reserved',
      trust_1_title: 'Multi-tenant',
      trust_1_sub: 'Full isolation per company',
      trust_2_title: 'Real-time sync',
      trust_2_sub: 'Data updates immediately',
      trust_3_title: 'Fine-grained RBAC',
      trust_3_sub: 'Access by role',
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
      platform_name: 'OmniStore ERP',
      platform_tagline: 'تخطيط موارد المؤسسات متعدد المستأجرين',
      brand_tag: 'منصة الخدمات الموحدة',
      activity_label: 'نشاط المنصة',
      activity_hint: 'إحصاءات النشاط العام المباشر غير مُفعّلة بعد.',
      live_label: 'مباشر',
      hero_badge: 'منظومة موحدة',
      hero_pill: 'حلول رقمية وتجارية متكاملة',
      hero_title: 'OmniStore ERP',
      hero_title_accent: 'منصة واحدة',
      hero_title_rest: 'للخدمات الرقمية والتجارية والترفيهية',
      hero_desc: 'بيئة عمل متقدمة تجمع بين الأسواق السحابية، وخدمات الاستضافة التخصصية، وحلول الأعمال الرقمية في بنية موحدة صممت للأداء والسرعة.',
      cta: 'Open Application',
      cta_market: 'استكشاف السوق',
      cta_business: 'خدمات الأعمال',
      cta_title: 'جاهز لبدء رحلتك مع OmniStore؟',
      cta_sub: 'افتح السوق أو استعرض حلول الأعمال خلال ثوانٍ.',
      nav_home: 'الرئيسية',
      nav_market: 'السوق',
      nav_business: 'حلول الأعمال',
      nav_game: 'استضافة الألعاب',
      nav_app: 'Open Application',
      nav_market_short: 'الماركت',
      nav_business_short: 'الأعمال',
      nav_game_short: 'الألعاب',
      nav_app_short: 'التطبيق',
      footer_text: 'منصة OmniStore إصدار',
      footer_rights: 'جميع الحقوق محفوظة',
      trust_1_title: 'تعدد المستأجرين',
      trust_1_sub: 'عزل كامل لكل شركة',
      trust_2_title: 'مزامنة لحظية',
      trust_2_sub: 'تتحدث البيانات فورياً',
      trust_3_title: 'صلاحيات دقيقة',
      trust_3_sub: 'وصول حسب الدور',
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

  const ICON_PATHS = {
    store: ['M3 9l1.5-5h15L21 9', 'M3 9h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9', 'M9 21v-6h6v6'],
    building: ['M3 21h18', 'M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16', 'M15 21V11h4a2 2 0 0 1 2 2v8', 'M9 7h2', 'M9 11h2', 'M9 15h2'],
    cap: ['M22 10 12 5 2 10l10 5 10-5z', 'M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5', 'M22 10v6'],
    game: ['M6 12h4', 'M8 10v4', 'M15 13h.01', 'M18 11h.01', 'M17.32 5H6.68a4 4 0 0 0-3.98 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z'],
    film: ['M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M7 3v18', 'M17 3v18', 'M3 8h4', 'M3 16h4', 'M17 8h4', 'M17 16h4'],
    server: ['M4 4h16v6H4z', 'M4 14h16v6H4z', 'M8 7h.01', 'M8 17h.01'],
    chart: ['M3 3v16a2 2 0 0 0 2 2h16', 'M7 15l4-4 4 4 5-6'],
    shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'm9 12 2 2 4-4'],
    bolt: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
    sync: ['M21 12a9 9 0 0 1-15.5 6.2L3 16', 'M3 12a9 9 0 0 1 15.5-6.2L21 8', 'M21 3v5h-5', 'M3 21v-5h5'],
    users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    circle: ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0']
  };

  function iconKey(name) {
    const n = String(name || '').toLowerCase();
    if (n.includes('store') || n.includes('shop') || n.includes('market') || n.includes('cart')) return 'store';
    if (n.includes('building') || n.includes('business') || n.includes('office')) return 'building';
    if (n.includes('graduat') || n.includes('student') || n.includes('school') || n.includes('cap')) return 'cap';
    if (n.includes('game') || n.includes('controller') || n.includes('pad')) return 'game';
    if (n.includes('film') || n.includes('video') || n.includes('media') || n.includes('reel')) return 'film';
    if (n.includes('server') || n.includes('cloud') || n.includes('host')) return 'server';
    if (n.includes('chart') || n.includes('graph') || n.includes('analytics') || n.includes('stats')) return 'chart';
    if (n.includes('shield') || n.includes('lock') || n.includes('secure') || n.includes('rbac')) return 'shield';
    if (n.includes('bolt') || n.includes('zap') || n.includes('fast') || n.includes('speed')) return 'bolt';
    if (n.includes('sync') || n.includes('refresh') || n.includes('link') || n.includes('realtime')) return 'sync';
    if (n.includes('user') || n.includes('people') || n.includes('team') || n.includes('account')) return 'users';
    return 'circle';
  }

  function svgIcon(name) {
    const key = iconKey(name);
    const paths = ICON_PATHS[key] || ICON_PATHS.circle;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    paths.forEach(function (d) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  function getLang() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'ar' || saved === 'en') return saved;
    } catch (_) {}
    return 'ar';
  }

  function setLang(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (_) {}
    applyLang(lang);
    rerenderDynamic();
  }

  function applyLang(lang) {
    const t = TRANSLATIONS[lang] || TRANSLATIONS.ar;
    const html = document.documentElement;
    html.setAttribute('lang', t.lang);
    html.setAttribute('dir', t.dir);

    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      const key = node.getAttribute('data-i18n');
      if (t[key] !== undefined) node.textContent = t[key];
    });

    const nameEl = document.getElementById('meta-name');
    const taglineEl = document.getElementById('meta-tagline');
    if (nameEl && t.platform_name && !nameEl.querySelector('.gradient-text')) {
      nameEl.textContent = t.platform_name;
    }
    if (taglineEl && t.platform_tagline) {
      taglineEl.textContent = t.platform_tagline;
    }

    const switchBtn = document.getElementById('lang-switch');
    if (switchBtn) switchBtn.textContent = lang === 'en' ? 'العربية' : 'English';
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function sectionHead(titleText, kickerText) {
    const head = el('div', 'section-head');
    head.appendChild(el('h2', 'section-title', titleText));
    if (kickerText) head.appendChild(el('span', 'section-kicker', kickerText));
    return head;
  }

  let lastCatalog = null;
  let lastSections = [];

  function renderStats(stats) {
    const root = document.getElementById('stats');
    if (!root || !Array.isArray(stats)) return;
    root.innerHTML = '';
    const lang = getLang();
    const t = TRANSLATIONS[lang] || TRANSLATIONS.ar;
    root.appendChild(sectionHead(t.section_overview || 'Platform Overview', 'Overview'));
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
    const lang = getLang();
    const t = TRANSLATIONS[lang] || TRANSLATIONS.ar;
    root.appendChild(sectionHead(t.section_core_modules || 'Core Modules', 'Modules'));
    const grid = el('div', 'features');
    for (const f of features) {
      const card = el('div', 'feature-card');
      const iconWrap = el('div', 'feature-icon');
      iconWrap.appendChild(svgIcon(f.icon || f.id || 'circle'));
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
    const lang = getLang();
    const t = TRANSLATIONS[lang] || TRANSLATIONS.ar;
    root.appendChild(sectionHead(t.section_why || 'Why OmniStore', 'Highlights'));
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
    const t = TRANSLATIONS[lang] || TRANSLATIONS.ar;
    if (status === 'active') return t.status_active;
    if (status === 'coming-soon') return t.status_coming_soon;
    if (status === 'under-construction') return t.status_under_construction;
    return status;
  }

  function sectionTitle(id) {
    const lang = getLang();
    const t = TRANSLATIONS[lang] || TRANSLATIONS.ar;
    const key = 'section_' + String(id).replace(/-/g, '_');
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
    const t = TRANSLATIONS[lang] || TRANSLATIONS.ar;
    root.appendChild(sectionHead(t.section_platform_services || 'Platform Services', 'Services'));

    const grid = el('div', 'sections-grid');
    for (const s of sections) {
      const card = el('div', 'section-card');
      const iconWrap = el('div', 'section-icon');
      iconWrap.appendChild(svgIcon(s.icon || s.id || 'circle'));
      card.appendChild(iconWrap);

      const header = el('div', 'section-header');
      header.appendChild(el('h3', 'section-card-title', sectionTitle(s.id)));
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
    const t = TRANSLATIONS[lang] || TRANSLATIONS.ar;
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

  function rerenderDynamic() {
    if (lastCatalog) {
      if (lastCatalog.stats) renderStats(lastCatalog.stats);
      if (lastCatalog.features) renderFeatures(lastCatalog.features);
      if (lastCatalog.highlights) renderHighlights(lastCatalog.highlights);
    }
    if (lastSections.length) renderSections(lastSections);
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
    const t = TRANSLATIONS[lang] || TRANSLATIONS.ar;
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

      lastCatalog = catalog;
      lastSections = (sections && sections.sections) || [];

      if (catalog.meta) {
        const nameEl = document.getElementById('meta-name');
        const taglineEl = document.getElementById('meta-tagline');
        const versionEl = document.getElementById('meta-version');
        if (nameEl && catalog.meta.name && !nameEl.querySelector('.gradient-text')) {
          nameEl.textContent = catalog.meta.name;
        }
        if (taglineEl && catalog.meta.tagline) {
          taglineEl.textContent = catalog.meta.tagline;
        }
        if (versionEl && catalog.meta.version) versionEl.textContent = catalog.meta.version;
        if (catalog.meta.name) {
          document.title = catalog.meta.name + ' | OmniStore Platform';
        }
      }

      renderActivity();
      renderStats(catalog.stats || []);
      renderFeatures(catalog.features || []);
      renderHighlights(catalog.highlights || []);
      renderSections(lastSections);

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

  // Public hook for analytics / visitor integrations (kept for external callers).
  window.initOmniVisitors = function initOmniVisitors() {
    try {
      startHeartbeat();
      startStatsRefresh();
    } catch (_) {}
  };

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

(function () {
  'use strict';

  const API = '/api/v1/platform-public';
  const STORAGE_KEY = 'omnistore_language';
  const LEGACY_STORAGE_KEY = 'omnistore_platform_lang';

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
      nav_students: 'Student Services',
      nav_education: 'Education',
      nav_game: 'Game Hosting',
      nav_online_games: 'Online Games',
      nav_app: 'Open Application',
      nav_market_short: 'Market',
      nav_business_short: 'Business',
      nav_students_short: 'Students',
      nav_education_short: 'Education',
      nav_game_short: 'Games',
      nav_online_games_short: 'Online Games',
      nav_app_short: 'App',
      nav_login: 'Sign in',
      nav_logout: 'Sign out',
      auth_title: 'Sign in',
      auth_sub: 'Use your account to reach your dashboards.',
      auth_user: 'Username',
      auth_pass: 'Password',
      auth_submit: 'Sign in',
      auth_logout: 'Sign out',
      auth_error_invalid: 'Incorrect username or password.',
      auth_error_denied: 'Your account cannot access this company.',
      auth_error_network: 'Network error. Please try again.',
      nav_soon: 'Soon',
      footer_text: 'OmniStore Platform v',
      footer_rights: 'All rights reserved',
      licenses: 'Licenses',
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
      section_online_games: 'Online Games',
      section_media_reels: 'Media / Reels',
      section_support: 'Support',
      section_education: 'Education',
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
      nav_students: 'خدمات الطلاب',
      nav_education: 'التعليم',
      nav_game: 'استضافة الألعاب',
      nav_online_games: 'ألعاب أونلاين',
      nav_app: 'Open Application',
      nav_market_short: 'الماركت',
      nav_business_short: 'الأعمال',
      nav_students_short: 'الطلاب',
      nav_education_short: 'التعليم',
      nav_game_short: 'الألعاب',
      nav_online_games_short: 'ألعاب أونلاين',
      nav_app_short: 'التطبيق',
      nav_login: 'تسجيل الدخول',
      nav_logout: 'تسجيل الخروج',
      auth_title: 'تسجيل الدخول',
      auth_sub: 'ادخل بيانات حسابك للوصول إلى لوحاتك.',
      auth_user: 'اسم المستخدم',
      auth_pass: 'كلمة المرور',
      auth_submit: 'دخول',
      auth_logout: 'تسجيل الخروج',
      auth_error_invalid: 'بيانات الدخول غير صحيحة.',
      auth_error_denied: 'لا يملك حسابك صلاحية الوصول.',
      auth_error_network: 'تعذر الاتصال. حاول مجددًا.',
      nav_soon: 'قريباً',
      footer_text: 'منصة OmniStore إصدار',
      footer_rights: 'جميع الحقوق محفوظة',
      licenses: 'التراخيص',
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
      section_online_games: 'ألعاب أونلاين',
      section_media_reels: 'الوسائط / الريلز',
      section_support: 'الدعم الفني',
      section_education: 'التعليم',
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
    if (n.includes('support') || n.includes('help') || n.includes('headset') || n.includes('life') || n.includes('ring')) return 'shield';
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
    if (window.OmniLang) return window.OmniLang.get();
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (saved === 'ar' || saved === 'en') return saved;
    } catch (_) {}
    return 'en';
  }

  function setLang(lang) {
    if (window.OmniLang) {
      window.OmniLang.set(lang);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (_) {}
    applyLang(lang);
    rerenderDynamic();
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
    if (nameEl && t.platform_name && !nameEl.querySelector('.gradient-text')) {
      nameEl.textContent = t.platform_name;
    }
    if (taglineEl && t.platform_tagline) {
      taglineEl.textContent = t.platform_tagline;
    }
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

  // Public section lockdown policy (platform catalog/UI state).
  // Only the sections below may render as active; everything else — including
  // any section the backend/API may return with a different status — is forced
  // to an honest non-active "Coming Soon" state with no destination URL.
  // Students is a documented exception: the Student Services & Printing
  // backend and UI are live and tenant-scoped, so it renders active.
  // Media / Reels is active as well: the public reels feed ships with this
  // release and opens the shipped /media-reels.html player.
  // Support is active: the support center ships support.html backed by the
  // customer request API and the platform-admin operator workflow.
  // Education is active as well: the tenant-scoped Education module ships with
  // this release (students, teachers, centers, programs, courses, classes,
  // enrollments, attendance, schedule, grading, bookings, ratings) and its 26
  // education.* permissions are registered. Discoverability here grants no access — every
  // Education route still enforces requirePermission per route.
  // Online Games is active: the 46-game roster ships under /online-games/ and
  // the catalog, details and player pages live at /online-games/index.html.
  // The section is public and read-only; it grants no platform permission and
  // the game frames stay cross-origin behind the configured GAMES_ORIGIN.
  const SECTION_LOCK_POLICY = {
    active: {
      'marketplace': '/marketplace/',
      'business-services': '/business.html',
      'student-services': '/student.html',
      'media-reels': '/media-reels.html',
      'support': '/support.html',
      'education': '/education/index.html',
      'online-games': '/online-games/index.html'
    },
    lockedIds: ['game-hosting']
  };

  // Fallback catalog shown when the API returns no sections at all.
  const DEFAULT_SECTIONS = [
    { id: 'marketplace', title: 'Marketplace', description: 'Visitor-facing marketplace for products and services.', status: 'active', url: '/marketplace/', icon: 'fa-store' },
    { id: 'business-services', title: 'Business Management Services', description: 'Existing company access and new company onboarding.', status: 'active', url: '/business.html', icon: 'fa-building' },
    { id: 'student-services', title: 'Student Services & Printing', description: 'Print shop orders, cost calculator, and student monthly passes.', status: 'active', url: '/student.html', icon: 'fa-graduation-cap' },
    { id: 'game-hosting', title: 'Game Hosting', description: 'Host and manage game sessions and catalogs.', status: 'coming-soon', url: null, icon: 'fa-gamepad' },
    { id: 'online-games', title: 'Online Games', description: 'Free open-source HTML5 games playable instantly in the browser.', status: 'active', url: '/online-games/index.html', icon: 'fa-dice' },
    { id: 'media-reels', title: 'Media / Reels', description: 'Media content and reels sharing.', status: 'active', url: '/media-reels.html', icon: 'fa-film' },
    { id: 'support', title: 'Support', description: 'Customer support center — requests, replies and status tracking.', status: 'active', url: '/support.html', icon: 'fa-life-ring' },
    { id: 'education', title: 'Education', description: 'Tenant-scoped Education management: students, teachers, centers, programs, courses, classes, enrollments, attendance, schedule and grading.', status: 'active', url: '/education/index.html', icon: 'fa-school' }
  ];

  function applySectionPolicy(list) {
    const base = Array.isArray(list) ? list.slice() : [];
    const seen = {};
    base.forEach(function (s) { if (s && s.id) seen[s.id] = true; });
    // Guarantee every locked section is visible as an honest Coming Soon,
    // even when the API omits it entirely.
    SECTION_LOCK_POLICY.lockedIds.forEach(function (id) {
      if (!seen[id]) {
        const def = DEFAULT_SECTIONS.find(function (d) { return d.id === id; });
        if (def) base.push(Object.assign({}, def));
      }
    });
    // Guarantee every active section is visible too, so an active id can
    // never disappear when an older stored catalog omits its entry.
    Object.keys(SECTION_LOCK_POLICY.active).forEach(function (id) {
      if (!seen[id]) {
        const def = DEFAULT_SECTIONS.find(function (d) { return d.id === id; });
        if (def) base.push(Object.assign({}, def));
      }
    });
    return base.map(function (s) {
      if (!s || !s.id) return s;
      const out = Object.assign({}, s);
      const allowedUrl = SECTION_LOCK_POLICY.active[out.id];
      if (allowedUrl) {
        out.status = 'active';
        out.url = allowedUrl;
      } else {
        out.status = 'coming-soon';
        out.url = null;
      }
      return out;
    });
  }

  function renderStats(stats) {
    const root = document.getElementById('stats');
    if (!root || !Array.isArray(stats)) return;
    root.innerHTML = '';
    const lang = getLang();
    const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
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
    const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
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
    const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
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
    const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
    if (status === 'active') return t.status_active;
    if (status === 'coming-soon') return t.status_coming_soon;
    if (status === 'under-construction') return t.status_under_construction;
    return status;
  }

  function sectionTitle(id) {
    const lang = getLang();
    const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
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
    const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
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
    try { handlePlatformGoogleSigninResult(); } catch (_) {}
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
      let rawSections = (sections && sections.sections) || [];
      if (!rawSections.length) rawSections = DEFAULT_SECTIONS;
      lastSections = applySectionPolicy(rawSections);

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

  // ------------------------------------------------------------------
  // Compact auth entry (side drawer). The server is authoritative for
  // identity and role: this module only stores the tokens the backend issued
  // and asks GET /api/v1/platform/me who the session belongs to. Showing or
  // hiding any UI here never grants anything; every protected surface and API
  // re-checks server-side. No credentials are hardcoded anywhere in this file.
  // ------------------------------------------------------------------
  const AUTH_API = '/api/v1/auth';
  const PLATFORM_API = '/api/v1/platform';
  const TOKEN_KEY = 'access_token';
  const REFRESH_KEY = 'refresh_token';
  // Same session-username key the ERP app (index.html) reads on boot to
  // restore a session. Reusing it — never a parallel mechanism — is what lets
  // a drawer login hand off to the app entry without a second login screen.
  const SESSION_USER_KEY = 'cairo_session_user';
  const POST_LOGIN_PAGE = 'platform-master';
  const POST_LOGIN_KEY = '__omniPostLoginPage';

  function authText(key) {
    const lang = getLang();
    const table = TRANSLATIONS[lang] || TRANSLATIONS.en;
    return table[key] !== undefined ? table[key] : (TRANSLATIONS.en[key] || key);
  }

  function authTokens() {
    try {
      return {
        access: localStorage.getItem(TOKEN_KEY) || '',
        refresh: localStorage.getItem(REFRESH_KEY) || ''
      };
    } catch (_) {
      return { access: '', refresh: '' };
    }
  }

  function storeAuthTokens(access, refresh) {
    try {
      if (access) localStorage.setItem(TOKEN_KEY, access);
      if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
    } catch (_) {}
  }

  function clearAuthTokens() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
    } catch (_) {}
  }

  // ------------------------------------------------------------------
  // Platform Master Google sign-in entry (server-side OIDC at
  // /auth/google/master). The browser only starts the round-trip: state,
  // nonce, PKCE and ID-token verification all live server-side, and the
  // server decides who is authenticated. This code never sees a Google
  // credential.
  // ------------------------------------------------------------------
  function startGoogleSignIn() {
    var page = 'platform.html';
    try {
      var seg = (window.location.pathname || '').split('/').pop();
      if (seg) page = seg;
    } catch (_) {}
    window.location.assign('/auth/google/master?returnTo=' + encodeURIComponent(page));
  }

  // ------------------------------------------------------------------
  // Google account LINKING for the signed-in Platform Master. This is NOT
  // a login path: it only runs from an authenticated drawer session, asks
  // for the CURRENT password (server-side step-up via
  // POST /auth/google/master/link-session — same contract as
  // changePassword), and then follows the server-issued single-use ticket
  // into the link-mode OIDC round-trip. The password travels only in the
  // step-up JSON body — never in a URL, never to Google, never persisted.
  //
  // The flow itself lives in the shared platform/google-link.js module
  // (OmniGoogleLink) so the homepage drawer and the Master Control Center
  // entry point run one implementation; these wrappers keep the drawer's
  // wiring and session-gate refresh in this file. If the shared module
  // failed to load, fail closed with a safe message — never a silent no-op
  // that would look like a working link button.
  // ------------------------------------------------------------------
  function openGoogleLinkStepUp() {
    if (window.OmniGoogleLink) return window.OmniGoogleLink.openStepUp();
    authError('تعذّر تحميل واجهة الربط — أعد المحاولة');
  }

  function cancelGoogleLinkStepUp() {
    if (window.OmniGoogleLink) return window.OmniGoogleLink.cancelStepUp();
  }

  function submitGoogleLinkStepUp() {
    if (window.OmniGoogleLink) return window.OmniGoogleLink.submitStepUp();
    authError('تعذّر تحميل واجهة الربط — أعد المحاولة');
  }

  // Runs at init(): consumes the outcome of a Google round-trip.
  //  - ?gerr=<code>  → open the drawer and surface the server's safe message
  //  - ?gsignin=1    → hydrate the session from the httpOnly cookies via the
  //                    existing refresh endpoint, resolve the post-login
  //                    target from the server-authoritative /platform/me
  //                    probe, then hand off to the app entry exactly like a
  //                    password drawer login does.
  function handlePlatformGoogleSigninResult() {
    var query = '';
    try { query = (window.location && window.location.search) || ''; } catch (_) { query = ''; }
    if (!query) return;
    if (query.indexOf('gerr=') !== -1) {
      var raw = '';
      var m = query.match(/[?&]gerr=([^&#]*)/);
      if (m) { try { raw = decodeURIComponent(m[1]); } catch (_) { raw = m[1]; } }
      var messages = {
        state_invalid: 'انتهت جلسة الدخول — أعد المحاولة مرة واحدة فقط، ولا تفتح عدة نوافذ Google في نفس الوقت',
        nonce_invalid: 'جلسة دخول غير صالحة — أعد المحاولة',
        idtoken_invalid: 'تعذّر التحقق من هوية Google',
        not_linked: 'حساب Google غير مرتبط — سجّل الدخول بكلمة المرور ثم اربط Google',
        account_disabled: 'هذا الحساب معطّل',
        provider_error: 'تعذّر الاتصال بـ Google — سجّل الدخول بكلمة المرور',
        not_configured: 'الدخول عبر Google غير مفعّل',
        email_mismatch: 'بريد Google لا يطابق سياسة الربط المعتمدة',
        session_mismatch: 'انتهت جلسة الربط — أعد المحاولة',
        sub_taken: 'حساب Google هذا مرتبط بمستخدم آخر',
        link_policy_unconfigured: 'سياسة ربط Google غير مكوّنة على الخادم',
        link_failed: 'تعذّر إتمام الربط',
        session_invalid: 'الجلسة غير صالحة — أعد المحاولة'
      };
      openAuthDrawer();
      authError(messages[raw] || 'تعذّر تسجيل الدخول عبر Google');
      return;
    }
    if (query.indexOf('glink=1') !== -1) {
      // Completed LINK round-trip (?glink=1): the sub is now bound to THIS
      // account server-side. Surface success, hide the step-up, and clean
      // the URL — the session itself is untouched (linking never mints one).
      try {
        var gl = new URL(window.location.href);
        gl.searchParams.delete('glink');
        window.history.replaceState({}, document.title, gl.pathname + gl.search + gl.hash);
      } catch (_) {}
      openAuthDrawer();
      var stepAfter = document.getElementById('platformAuthLinkStepUp');
      if (stepAfter) stepAfter.setAttribute('hidden', '');
      var passAfter = document.getElementById('platformAuthLinkPass');
      if (passAfter) passAfter.value = '';
      authError('تم ربط حساب Google بهذا الحساب بنجاح');
      return;
    }
    if (query.indexOf('gmfa=1') !== -1) {
      // The server stopped the Google login at the MFA challenge: no session
      // exists yet. Show the drawer's TOTP field; only a successful POST to
      // /auth/google/master/mfa mints the session.
      openAuthDrawer();
      var mfaBox = document.getElementById('platformAuthMfa');
      if (mfaBox) mfaBox.hidden = false;
      authError('أدخل رمز التحقق الثنائي لإكمال الدخول عبر Google');
      return;
    }
    if (query.indexOf('gsignin=1') === -1) return;
    hydrateGoogleSessionAndEnter();
  }

  // Shared handoff for a COMPLETED Google round-trip (?gsignin=1, or right
  // after the MFA challenge succeeds): the server set the httpOnly cookies,
  // so hydrate the SPA session from them exactly like a password drawer
  // login, resolve the destination from the server-authoritative /platform/me
  // probe, and enter the app.
  function hydrateGoogleSessionAndEnter() {
    fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: '{}'
    })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (d) {
        var token = d && d.success && d.data && d.data.accessToken;
        if (!token) throw new Error('refresh failed');
        storeAuthTokens(token, null);
        return fetch(PLATFORM_API + '/me', {
          headers: { Authorization: 'Bearer ' + token },
          credentials: 'same-origin'
        });
      })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (me) {
        var ok = me && me.success && me.data;
        var platformRole = ok ? me.data.platformRole : null;
        if (ok && me.data.username) {
          try { localStorage.setItem(SESSION_USER_KEY, me.data.username); } catch (_) {}
        }
        var target = resolvePostLoginTarget(platformRole);
        if (target.postLoginPage) {
          try { sessionStorage.setItem(POST_LOGIN_KEY, target.postLoginPage); } catch (_) {}
        }
        try {
          var u = new URL(window.location.href);
          u.searchParams.delete('gsignin');
          u.searchParams.delete('gmfa');
          window.history.replaceState({}, document.title, u.pathname + u.search + u.hash);
        } catch (_) {}
        refreshAuthDrawer();
        window.location.href = target.href;
      })
      .catch(function () {
        openAuthDrawer();
        authError('تعذّر استكمال تسجيل الدخول عبر Google');
      });
  }

  // Completes the MFA challenge that stopped a Google login: posts the TOTP
  // code to the server (the signed challenge travels in its httpOnly cookie),
  // and on success hands off through the same session hydration as above.
  function submitGoogleMfaChallenge() {
    var input = document.getElementById('platformAuthMfaToken');
    var code = input ? String(input.value || '').trim() : '';
    if (!code) { authError('أدخل رمز التحقق'); return; }
    fetch('/auth/google/master/mfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token: code })
    })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (d) { return { ok: r.ok, d: d }; });
      })
      .then(function (res) {
        if (!res.ok || !res.d || !res.d.success) {
          authError('رمز غير صحيح — حاول مجددًا');
          return;
        }
        var mfaBox = document.getElementById('platformAuthMfa');
        if (mfaBox) mfaBox.hidden = true;
        if (input) input.value = '';
        var errEl = document.getElementById('platformAuthError');
        if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
        hydrateGoogleSessionAndEnter();
      })
      .catch(function () { authError('تعذّر الاتصال بالخادم'); });
  }

  function resolvePostLoginTarget(platformRole) {
    // Decision only — no navigation here so the rule stays unit-testable.
    // The destination is always the in-app entry; a confirmed platform role
    // additionally carries a one-shot INTERNAL page request that index.html
    // consumes behind its own canAccessPage gate. No caller input, URL
    // parameter, or stored value can change either half, so open redirect to
    // an external origin is impossible by construction.
    if (platformRole) return { href: 'index.html', postLoginPage: POST_LOGIN_PAGE };
    return { href: 'index.html', postLoginPage: null };
  }

  function authError(msg) {
    const el = document.getElementById('platformAuthError');
    if (!el) return;
    if (!msg) {
      el.textContent = '';
      el.setAttribute('hidden', '');
      return;
    }
    el.textContent = msg;
    el.removeAttribute('hidden');
  }

  function setAuthLoading(loading) {
    const btn = document.getElementById('platformAuthSubmit');
    if (!btn) return;
    btn.disabled = !!loading;
    btn.textContent = loading ? '⏳ …' : authText('auth_submit');
  }

  function refreshAuthDrawer() {
    const hasSession = !!authTokens().access;
    const form = document.getElementById('platformAuthForm');
    const logoutBtn = document.getElementById('platformAuthLogout');
    const loginBtn = document.getElementById('platformLoginBtn');
    const linkSection = document.getElementById('platformAuthGoogleLinkSection');
    const linkStepUp = document.getElementById('platformAuthLinkStepUp');
    const linkPass = document.getElementById('platformAuthLinkPass');
    if (form) form.style.display = hasSession ? 'none' : '';
    if (logoutBtn) {
      if (hasSession) logoutBtn.removeAttribute('hidden');
      else logoutBtn.setAttribute('hidden', '');
    }
    // Google LINKING is a session-only operation (server: link-session 401s
    // without an authenticated platform session). Never shown as a login path.
    if (linkSection) {
      if (hasSession) linkSection.removeAttribute('hidden');
      else linkSection.setAttribute('hidden', '');
    }
    if (!hasSession && linkStepUp) linkStepUp.setAttribute('hidden', '');
    if (!hasSession && linkPass) linkPass.value = '';
    if (loginBtn) loginBtn.textContent = authText(hasSession ? 'nav_logout' : 'nav_login');
  }

  function openAuthDrawer() {
    const overlay = document.getElementById('platformAuthOverlay');
    const drawer = document.getElementById('platformAuthDrawer');
    if (!overlay || !drawer) return;
    authError(null);
    refreshAuthDrawer();
    overlay.removeAttribute('hidden');
    drawer.removeAttribute('hidden');
    const first = document.getElementById('platformAuthUser');
    if (first && typeof first.focus === 'function') first.focus();
  }

  function closeAuthDrawer() {
    const overlay = document.getElementById('platformAuthOverlay');
    const drawer = document.getElementById('platformAuthDrawer');
    if (overlay) overlay.setAttribute('hidden', '');
    if (drawer) drawer.setAttribute('hidden', '');
    const btn = document.getElementById('platformLoginBtn');
    if (btn && typeof btn.focus === 'function') btn.focus();
  }

  async function submitAuthDrawer(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const userEl = document.getElementById('platformAuthUser');
    const passEl = document.getElementById('platformAuthPass');
    const username = userEl ? userEl.value.trim() : '';
    const password = passEl ? passEl.value : '';
    if (!username || !password) {
      authError(authText('auth_error_invalid'));
      return;
    }
    authError(null);
    setAuthLoading(true);
    try {
      const res = await fetch(AUTH_API + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.success || !data.data || !data.data.user) {
        authError(res.status === 403 ? authText('auth_error_denied') : authText('auth_error_invalid'));
        return;
      }
      storeAuthTokens(data.data.accessToken, data.data.refreshToken);
      try {
        if (data.data.user && data.data.user.username) {
          localStorage.setItem(SESSION_USER_KEY, data.data.user.username);
        }
      } catch (_) {}
      // Server-authoritative role probe: a username that merely matches a
      // master account grants nothing — only a 200 here with a platformRole
      // counts, and the Master surface re-verifies it independently.
      let platformRole = null;
      try {
        const meRes = await fetch(PLATFORM_API + '/me', {
          headers: { Authorization: 'Bearer ' + (data.data.accessToken || '') }
        });
        const meData = await meRes.json().catch(() => null);
        if (meRes.ok && meData && meData.success && meData.data && meData.data.platformRole) {
          platformRole = meData.data.platformRole;
        }
      } catch (_) {
        platformRole = null;
      }
      const target = resolvePostLoginTarget(platformRole);
      if (target.postLoginPage) {
        try { sessionStorage.setItem(POST_LOGIN_KEY, target.postLoginPage); } catch (_) {}
      }
      refreshAuthDrawer();
      // Platform Master: STAY in the homepage drawer so the session-gated
      // Google LINK section and its step-up are reachable right here —
      // opening /index.html manually must never be a prerequisite for
      // linking. The one-shot key recorded above still lands the Master on
      // the Master Control Center through the existing «فتح البرنامج»
      // entry, behind index.html's own canAccessPage gate. Everyone else
      // keeps the exact hand-off to the app entry, and the server
      // re-verifies the role on every protected surface regardless of
      // what is shown here.
      if (platformRole) {
        authError('تم تسجيل الدخول — يمكنك ربط حساب Google الآن أو فتح البرنامج من القائمة');
        return;
      }
      window.location.href = target.href;
    } catch (_) {
      authError(authText('auth_error_network'));
    } finally {
      setAuthLoading(false);
    }
  }

  async function logoutPlatform() {
    const tokens = authTokens();
    try {
      await fetch(AUTH_API + '/logout', {
        method: 'POST',
        headers: tokens.access ? { Authorization: 'Bearer ' + tokens.access } : {}
      });
    } catch (_) {}
    clearAuthTokens();
    try { localStorage.removeItem(SESSION_USER_KEY); } catch (_) {}
    refreshAuthDrawer();
    closeAuthDrawer();
  }

  function initAuthDrawer() {
    const btn = document.getElementById('platformLoginBtn');
    if (btn) btn.addEventListener('click', openAuthDrawer);
    const closeBtn = document.getElementById('platformAuthClose');
    if (closeBtn) closeBtn.addEventListener('click', closeAuthDrawer);
    const overlay = document.getElementById('platformAuthOverlay');
    if (overlay) overlay.addEventListener('click', closeAuthDrawer);
    document.addEventListener('keydown', function (e) {
      if (e && e.key === 'Escape') {
        const drawer = document.getElementById('platformAuthDrawer');
        if (drawer && !drawer.hasAttribute('hidden')) closeAuthDrawer();
      }
    });
    const form = document.getElementById('platformAuthForm');
    if (form) form.addEventListener('submit', submitAuthDrawer);
    const toggle = document.getElementById('platformAuthShowPass');
    if (toggle) toggle.addEventListener('click', function () {
      const pass = document.getElementById('platformAuthPass');
      if (!pass) return;
      const show = pass.type !== 'text';
      pass.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
    });
    const logoutBtn = document.getElementById('platformAuthLogout');
    if (logoutBtn) logoutBtn.addEventListener('click', logoutPlatform);
    const googleBtn = document.getElementById('platformAuthGoogle');
    if (googleBtn) googleBtn.addEventListener('click', startGoogleSignIn);
    const googleLinkBtn = document.getElementById('platformAuthGoogleLink');
    if (googleLinkBtn) googleLinkBtn.addEventListener('click', openGoogleLinkStepUp);
    const googleLinkSubmit = document.getElementById('platformAuthLinkSubmit');
    if (googleLinkSubmit) googleLinkSubmit.addEventListener('click', submitGoogleLinkStepUp);
    const googleLinkCancel = document.getElementById('platformAuthLinkCancel');
    if (googleLinkCancel) googleLinkCancel.addEventListener('click', cancelGoogleLinkStepUp);
    const googleLinkPass = document.getElementById('platformAuthLinkPass');
    if (googleLinkPass) googleLinkPass.addEventListener('keydown', function (e) {
      if (e && e.key === 'Enter') { e.preventDefault(); submitGoogleLinkStepUp(); }
    });
    const googleMfaBtn = document.getElementById('platformAuthMfaSubmit');
    if (googleMfaBtn) googleMfaBtn.addEventListener('click', submitGoogleMfaChallenge);
    const googleMfaInput = document.getElementById('platformAuthMfaToken');
    if (googleMfaInput) googleMfaInput.addEventListener('keydown', function (e) {
      if (e && e.key === 'Enter') { e.preventDefault(); submitGoogleMfaChallenge(); }
    });
    refreshAuthDrawer();
  }

  function bindEvents() {
    initAuthDrawer();
    document.addEventListener('omnilangchange', function () {
      applyLang(getLang());
      if (typeof refreshAuthDrawer === 'function') refreshAuthDrawer();
      rerenderDynamic();
    });
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

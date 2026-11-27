/* ================= Unified Landing Page JS — OmniStore =================
   Real auth integration with /api/v1/auth (login, logout, me).
   Real Arabic/English language switching. No simulated authentication.
   Registration is NOT available through this page (no /api/v1/auth/register
   endpoint exists); the modal shows an honest unavailability message.
   third-party sign-in is NOT represented as working. ================= */

(function () {
  'use strict';

  // ---------- Constants ----------
  const AUTH_API = '/api/v1/auth';
  const LANG_KEY = 'omnistore_landing_lang';
  const SUPPORTED_LANGS = ['ar', 'en'];

  // ---------- Translations ----------
  // All user-facing strings for the landing page, in Arabic and English.
  const T = {
    ar: {
      lang: 'ar',
      dir: 'rtl',
      platform_name: 'OmniStore — منصة الخدمات الموحدة',
      brand_tag: 'الخدمات الموحدة',
      nav_home: 'الرئيسية',
      nav_market: 'السوق',
      nav_business: 'حلول الأعمال',
      nav_students: 'خدمات الطلاب',
      nav_education: 'التعليم',
      nav_online_games: 'ألعاب أونلاين',
      nav_support: 'الدعم الفني',
      nav_app: 'التطبيق',
      nav_login: 'تسجيل الدخول',
      nav_logout: 'تسجيل الخروج',
      lang_arabic: 'العربية',
      lang_english: 'English',
      platform_name: 'OmniStore — منصة الخدمات الموحدة',
      cta: 'التطبيق',
      nav_students_short: 'الطلاب',
      nav_education_short: 'التعليم',
      nav_business_short: 'الأعمال',
      nav_online_games_short: 'ألعاب أونلاين',
      nav_game_short: 'الألعاب',
      nav_soon: 'قريباً',
      nav_terms: 'شروط الخدمة',
      nav_privacy: 'سياسة الخصوصية',
      nav_market_short: 'الماركت',
      nav_app_short: 'التطبيق',
      hero_badge: 'منظومة موحدة',
      hero_pill: 'حلول رقمية وتجارية متكاملة',
      hero_title_accent: 'منصة واحدة',
      hero_title_rest: 'للخدمات الرقمية والتجارية والترفيهية',
      hero_tagline: 'OmniStore ERP — Multi-Tenant Enterprise Resource Planning',
      hero_desc: 'بيئة عمل متقدمة تجمع بين الأسواق السحابية، وخدمات الاستضافة التخصصية، وحلول الأعمال الرقمية في بنية موحدة صممت للأداء والسرعة.',
      trust_1_title: 'تعدد المستأجرين',
      trust_1_sub: 'عزل كامل لكل شركة',
      trust_2_title: 'مزامنة لحظية',
      trust_2_sub: 'تتحدث البيانات فورياً',
      trust_3_title: 'صلاحيات دقيقة',
      trust_3_sub: 'وصول حسب الدور',
      cta_explore: 'استكشاف الخدمات',
      cta_business: 'خدمات الأعمال',
      cta_register: 'إنشاء حساب',
      cta_market: 'استكشاف السوق',
      cta_title: 'جاهز لبدء رحلتك مع OmniStore؟',
      cta_sub: 'افتح السوق أو استعرض حلول الأعمال خلال ثوانٍ.',
      stats_title: 'أرقام المنصة',
      stat_visitors: 'الزوار الآن',
      stat_users: 'المستخدمون المسجلون',
      stat_businesses: 'الشركات النشطة',
      features_title: 'لماذا OmniStore؟',
      feat_multitenant: 'عزل الشركات',
      feat_multitenant_sub: 'بيئة مستقلة بالكامل لكل شركة مع بيانات ومعالجات معزولة.',
      feat_realtime: 'مزامنة لحظية',
      feat_realtime_sub: 'تحديث البيانات فوراً عبر جميع الشاشات والأجهزة.',
      feat_permissions: 'صلاحيات دقيقة',
      feat_permissions_sub: 'وصول يعتمد على الدور والصلاحية لكل مستخدم.',
      feat_rtl: 'عربي أولاً',
      feat_rtl_sub: 'واجهة كاملة لاتجاه RTL مهيأة للغة العربية وللأسواق الإقليمية.',
      feat_market: 'سوق موحد',
      feat_market_sub: 'سوق إلكتروني متكامل مع عربة تسوق وتتبع الطلبات.',
      feat_students: 'خدمات الطلاب',
      feat_students_sub: 'طباعة الكشوفات، حجز المقاعد، وإدارة المدفوعات الدراسية.',
      services_title: 'خدمات المنصة',
      svc_market_title: 'السوق',
      svc_market_desc: 'متجر إلكتروني مع كتالوج، عربة تسوق، وتتبع الطلبات.',
      svc_business_title: 'حلول الأعمال',
      svc_business_desc: 'إدارة مبيعات، مشتريات، مخزون، خزنة، وتقارير مالية.',
      svc_students_title: 'خدمات الطلاب',
      svc_students_desc: 'طباعة الكشوفات، حجز المقاعد، وإدارة المدفوعات الدراسية.',
      svc_education_title: 'التعليم',
      svc_education_desc: 'منصة تعليمية وإدارة مؤسسات تعليمية.',
      svc_games_title: 'ألعاب أونلاين',
      svc_games_desc: 'استضافة ألعاب وخدمات ترفيهية رقمية.',
      svc_support_title: 'الدعم الفني',
      svc_support_desc: 'طلبات الدعم، متابعة الحالات، وقاعدة معرفة.',
      svc_games_host_title: 'استضافة الألعاب',
      svc_games_host_desc: 'خوادم ألعاب مخصصة وإدارة طلبات الاستضافة.',
      badge_live: 'مباشر',
      badge_soon: 'قريباً',
      btn_enter: 'الدخول',
      btn_soon: 'قريباً',
      footer_rights: 'جميع الحقوق محفوظة',
      auth_title: 'تسجيل الدخول',
      auth_sub: 'أدخل بيانات حسابك للوصول إلى لوحاتك.',
      auth_user: 'اسم المستخدم أو البريد الإلكتروني',
      auth_pass: 'كلمة المرور',
      auth_submit: 'دخول',
      auth_logout: 'تسجيل الخروج',
      auth_register: 'إنشاء حساب جديد',
      auth_error_invalid: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
      auth_error_denied: 'لا يملك حسابك صلاحية الوصول إلى هذه الشركة.',
      auth_error_network: 'تعذر الاتصال بالخادم. حاول مجدداً.',
      auth_error_mfa: 'هذا الحساب يتطلب التحقق الثنائي (MFA). أكمل الخطوة على الخادم أولاً.',
      reg_title: 'إنشاء حساب جديد',
      reg_sub: 'إنشاء الحساب غير متاح عبر هذه الصفحة.',
      reg_fullname: 'الاسم الثلاثي',
      reg_phone: 'رقم التليفون',
      reg_email: 'البريد الإلكتروني',
      reg_address: 'العنوان',
      reg_job: 'العمل / الوظيفة',
      reg_save: 'حفظ البيانات',
      reg_have_account: 'لديك حساب؟',
      reg_login: 'تسجيل الدخول',
      reg_unavailable_title: 'التسجيل غير متاح هنا',
      reg_unavailable_msg: 'إنشاء حساب جديد لا يتم عبر هذه الصفحة. تواصل مع مدير النظام في مؤسستك لإنشاء حساب.',
      reg_to_login: 'العودة إلى تسجيل الدخول',
      lang_switch_label: 'اختر اللغة'
    },
    en: {
      lang: 'en',
      dir: 'ltr',
      platform_name: 'OmniStore — Unified Services Platform',
      brand_tag: 'Unified Services',
      nav_home: 'Home',
      nav_market: 'Market',
      nav_business: 'Business Solutions',
      nav_students: 'Student Services',
      nav_education: 'Education',
      nav_online_games: 'Online Games',
      nav_support: 'Support',
      nav_app: 'Open Application',
      nav_login: 'Sign in',
      nav_logout: 'Sign out',
      lang_arabic: 'العربية',
      lang_english: 'English',
      platform_name: 'OmniStore — Unified Services Platform',
      cta: 'Open Application',
      nav_students_short: 'Students',
      nav_education_short: 'Education',
      nav_business_short: 'Business',
      nav_online_games_short: 'Online Games',
      nav_game_short: 'Games',
      nav_soon: 'Coming Soon',
      nav_terms: 'Terms of Service',
      nav_privacy: 'Privacy Policy',
      nav_market_short: 'Market',
      nav_app_short: 'Application',
      hero_badge: 'Unified System',
      hero_pill: 'Integrated digital and business solutions',
      hero_title_accent: 'One platform',
      hero_title_rest: 'for digital, business and entertainment services',
      hero_tagline: 'OmniStore ERP — Multi-Tenant Enterprise Resource Planning',
      hero_desc: 'A modern workspace combining cloud marketplaces, specialized hosting, and digital business services in one unified, performance-first stack.',
      trust_1_title: 'Multi-tenant',
      trust_1_sub: 'Full isolation per company',
      trust_2_title: 'Real-time sync',
      trust_2_sub: 'Data updates immediately',
      trust_3_title: 'Fine-grained Permissions',
      trust_3_sub: 'Access by role',
      cta_explore: 'Explore Services',
      cta_business: 'Business Services',
      cta_register: 'Create Account',
      cta_market: 'Explore Market',
      cta_title: 'Ready to start your journey with OmniStore?',
      cta_sub: 'Open the market or browse business services in seconds.',
      stats_title: 'Platform Stats',
      stat_visitors: 'Visitors Now',
      stat_users: 'Registered Users',
      stat_businesses: 'Active Businesses',
      features_title: 'Why OmniStore?',
      feat_multitenant: 'Company Isolation',
      feat_multitenant_sub: 'Fully isolated environment per company with separate data and processing.',
      feat_realtime: 'Real-time Sync',
      feat_realtime_sub: 'Data updates immediately across all screens and devices.',
      feat_permissions: 'Fine-grained Permissions',
      feat_permissions_sub: 'Access based on role and permission for each user.',
      feat_rtl: 'Arabic First',
      feat_rtl_sub: 'Full RTL interface designed for Arabic and regional markets.',
      feat_market: 'Unified Market',
      feat_market_sub: 'Integrated e-commerce with cart and order tracking.',
      feat_students: 'Student Services',
      feat_students_sub: 'Transcript printing, seat reservation, and tuition payment management.',
      services_title: 'Platform Services',
      svc_market_title: 'Market',
      svc_market_desc: 'E-commerce store with catalog, shopping cart, and order tracking.',
      svc_business_title: 'Business Solutions',
      svc_business_desc: 'Sales, purchases, inventory, cash box, and financial reporting management.',
      svc_students_title: 'Student Services',
      svc_students_desc: 'Transcript printing, seat reservation, and tuition payment management.',
      svc_education_title: 'Education',
      svc_education_desc: 'Educational platform and institution management.',
      svc_games_title: 'Online Games',
      svc_games_desc: 'Game hosting and digital entertainment services.',
      svc_support_title: 'Support',
      svc_support_desc: 'Support requests, case tracking, and knowledge base.',
      svc_games_host_title: 'Game Hosting',
      svc_games_host_desc: 'Dedicated game servers and hosting request management.',
      badge_live: 'Live',
      badge_soon: 'Soon',
      btn_enter: 'Enter',
      btn_soon: 'Soon',
      footer_rights: 'All rights reserved',
      auth_title: 'Sign in',
      auth_sub: 'Enter your credentials to reach your dashboards.',
      auth_user: 'Username or email',
      auth_pass: 'Password',
      auth_submit: 'Sign in',
      auth_logout: 'Sign out',
      auth_register: 'Create New Account',
      auth_error_invalid: 'Invalid username or password.',
      auth_error_denied: 'Your account cannot access this company.',
      auth_error_network: 'Cannot connect to the server. Please try again.',
      auth_error_mfa: 'This account requires multi-factor authentication (MFA). Complete the step on the server first.',
      reg_title: 'Create New Account',
      reg_sub: 'Account creation is not available through this page.',
      reg_fullname: 'Full Name',
      reg_phone: 'Phone Number',
      reg_email: 'Email Address',
      reg_address: 'Address',
      reg_job: 'Job / Role',
      reg_save: 'Save Data',
      reg_have_account: 'Already have an account?',
      reg_login: 'Sign in',
      reg_unavailable_title: 'Registration Not Available Here',
      reg_unavailable_msg: 'New account creation is not available on this landing page. Contact your organization\'s system administrator to create an account.',
      reg_to_login: 'Back to Sign In',
      lang_switch_label: 'Choose language'
    }
  };

  // ---------- Elements ----------
  var htmlEl = document.documentElement;
  var langSwitch = document.getElementById('lang-switch');

  var loginBtn = document.getElementById('landingLoginBtn');
  var overlay = document.getElementById('landingAuthOverlay');
  var drawer = document.getElementById('landingAuthDrawer');
  var drawerClose = document.getElementById('landingAuthClose');
  var drawerSubmit = document.getElementById('landingAuthSubmit');
  var drawerError = document.getElementById('landingAuthError');
  var drawerRegister = document.getElementById('landingAuthRegister');
  var drawerLogout = document.getElementById('landingAuthLogout');
  var drawerForm = document.getElementById('landingAuthForm');

  var regOverlay = document.getElementById('landingRegOverlay');
  var regClose = document.getElementById('landingRegClose');
  var regForm = document.getElementById('landingRegForm');
  var regSubmit = document.getElementById('landingRegSubmit');
  var regMsg = document.getElementById('landingRegMsg');
  var regToLogin = document.getElementById('landingRegToLogin');

  var showPass = document.getElementById('landingAuthShowPass');
  var passInput = document.getElementById('landingAuthPass');

  var langArBtn = null;
  var langEnBtn = null;

  // ---------- i18n ----------
  function getLang() {
    try {
      var saved = localStorage.getItem(LANG_KEY);
      if (SUPPORTED_LANGS.indexOf(saved) !== -1) return saved;
    } catch (_) {}
    return 'ar';
  }

  function setLang(lang) {
    if (SUPPORTED_LANGS.indexOf(lang) === -1) return;
    var t = T[lang] || T.en;
    try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
    htmlEl.setAttribute('lang', t.lang);
    htmlEl.setAttribute('dir', t.dir);
    applyText(t);
    updateLangButtons(lang);
  }

  function applyText(t) {
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      var key = node.getAttribute('data-i18n');
      if (t[key] === undefined) return;
      // Never overwrite a container that holds meaningful child elements
      // (icons, badges, buttons, required-field markers, nested links).
      if (node.children.length > 0) return;
      node.textContent = t[key];
    });
    var titleEl = document.querySelector('title');
    if (titleEl && t.platform_name) titleEl.textContent = t.platform_name;
    var descEl = document.querySelector('meta[name="description"]');
    // meta description stays static (AR default) — not translated per design.
  }

  function updateLangButtons(lang) {
    if (langArBtn) {
      langArBtn.setAttribute('aria-pressed', lang === 'ar' ? 'true' : 'false');
    }
    if (langEnBtn) {
      langEnBtn.setAttribute('aria-pressed', lang === 'en' ? 'true' : 'false');
    }
  }

  function buildLangSwitch() {
    if (!langSwitch) return;
    langSwitch.innerHTML = '';
    var wrapper = document.createElement('div');
    wrapper.className = 'lang-switch';
    wrapper.setAttribute('role', 'radiogroup');
    wrapper.setAttribute('aria-label', T.ar.lang_switch_label);

    langArBtn = document.createElement('button');
    langArBtn.type = 'button';
    langArBtn.className = 'lang-btn';
    langArBtn.setAttribute('data-omni-set-lang', 'ar');
    langArBtn.setAttribute('aria-pressed', 'true');
    langArBtn.textContent = T.ar.lang_arabic;
    langArBtn.addEventListener('click', function () { setLang('ar'); });

    langEnBtn = document.createElement('button');
    langEnBtn.type = 'button';
    langEnBtn.className = 'lang-btn';
    langEnBtn.setAttribute('data-omni-set-lang', 'en');
    langEnBtn.setAttribute('aria-pressed', 'false');
    langEnBtn.textContent = T.en.lang_english;
    langEnBtn.addEventListener('click', function () { setLang('en'); });

    wrapper.appendChild(langArBtn);
    wrapper.appendChild(langEnBtn);
    langSwitch.appendChild(wrapper);
  }

  // ---------- Auth helpers ----------
  function setError(el, msg) {
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function hideDrawer() {
    if (overlay) overlay.hidden = true;
    if (drawer) drawer.hidden = true;
    setError(drawerError, '');
    if (drawerForm) drawerForm.reset();
    if (drawerSubmit) { drawerSubmit.disabled = false; drawerSubmit.textContent = T.ar.auth_submit; }
  }

  function showDrawer() {
    if (overlay) overlay.hidden = false;
    if (drawer) drawer.hidden = false;
    var first = document.getElementById('landingAuthUser');
    if (first && typeof first.focus === 'function') first.focus();
  }

  function hideReg() {
    if (regOverlay) regOverlay.hidden = true;
    setError(regMsg, '');
    if (regForm) regForm.reset();
    if (regSubmit) regSubmit.disabled = false;
  }

  function showReg() {
    if (regOverlay) regOverlay.hidden = false;
    var first = document.getElementById('regFullName');
    if (first && typeof first.focus === 'function') first.focus();
  }

  function authSetLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = !!loading;
    btn.textContent = loading ? '⏳ …' : (htmlEl.getAttribute('lang') === 'en' ? T.en.auth_submit : T.ar.auth_submit);
  }

  function refreshAuthUI() {
    // No client-side session emulation: the backend sets httpOnly cookies.
    // The drawer always shows the login form; logout button stays hidden
    // until a real server session exists (verified by /api/v1/auth/me).
    if (drawerLogout) drawerLogout.hidden = true;
    if (loginBtn) loginBtn.hidden = false;
  }

  async function checkSession() {
    try {
      var res = await fetch(AUTH_API + '/me', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin'
      });
      if (res.ok) {
        var data = await res.json().catch(function () { return null; });
        if (data && data.success && data.data && data.data.username) {
          // Real server session exists: hide login button, show logout.
          if (loginBtn) loginBtn.hidden = true;
          if (drawerLogout) drawerLogout.hidden = false;
          if (drawer) drawer.hidden = true;
          if (overlay) overlay.hidden = true;
        }
      }
    } catch (_) {
      // No session or network error: stay in signed-out state.
    }
  }

  // ---------- Auth drawer: login ----------
  if (loginBtn) loginBtn.addEventListener('click', function () { showDrawer(); });
  if (drawerClose) drawerClose.addEventListener('click', hideDrawer);
  if (overlay) overlay.addEventListener('click', hideDrawer);

  function handleLoginSubmit(e) {
    e.preventDefault();
    setError(drawerError, '');
    authSetLoading(drawerSubmit, true);
    var userEl = document.getElementById('landingAuthUser');
    var passEl = document.getElementById('landingAuthPass');
    var username = userEl ? userEl.value.trim() : '';
    var password = passEl ? passEl.value : '';
    if (!username || !password) {
      setError(drawerError, htmlEl.getAttribute('lang') === 'en' ? T.en.auth_error_invalid : T.ar.auth_error_invalid);
      authSetLoading(drawerSubmit, false);
      return;
    }
    fetch(AUTH_API + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username: username, password: password })
    })
      .then(function (res) { return res.json().catch(function () { return null; }).then(function (data) { return { ok: res.ok, status: res.status, data: data }; }); })
      .then(function (result) {
        if (!result.ok || !result.data || !result.data.success || !result.data.data || !result.data.data.user) {
          var msg = result.status === 403 ? (htmlEl.getAttribute('lang') === 'en' ? T.en.auth_error_denied : T.ar.auth_error_denied) : (htmlEl.getAttribute('lang') === 'en' ? T.en.auth_error_invalid : T.ar.auth_error_invalid);
          if (result.data && result.data.mfaRequired) {
            msg = htmlEl.getAttribute('lang') === 'en' ? T.en.auth_error_mfa : T.ar.auth_error_mfa;
          }
          setError(drawerError, msg);
          authSetLoading(drawerSubmit, false);
          return;
        }
        // Successful login: tokens are httpOnly cookies set by the server.
        // Refresh the UI to reflect the session.
        refreshAuthUI();
        checkSession().then(function () {
          hideDrawer();
          authSetLoading(drawerSubmit, false);
          // Phase 3A — server-authoritative post-login routing based on role.
          fetch(AUTH_API + '/me', {
            method: 'GET',
            headers: { Accept: 'application/json' },
            credentials: 'same-origin'
          })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (data) {
              var role = null;
              if (data && data.data) {
                role = data.data.effectiveRole || data.data.user && data.data.user.role;
              }
              if (role === 'Owner') { window.location.href = '/tenant-owner.html'; return; }
              if (role === 'Admin') { window.location.href = '/tenant-admin.html'; return; }
              // Other roles stay on the landing page (existing behavior).
            }).catch(function () { /* stay on landing page */ });
        });
      })
      .catch(function () {
        setError(drawerError, htmlEl.getAttribute('lang') === 'en' ? T.en.auth_error_network : T.ar.auth_error_network);
        authSetLoading(drawerSubmit, false);
      });
  }

  if (drawerSubmit) drawerSubmit.addEventListener('click', handleLoginSubmit);
  if (drawerForm) drawerForm.addEventListener('submit', handleLoginSubmit);

  if (drawerLogout) drawerLogout.addEventListener('click', function () {
    fetch(AUTH_API + '/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    }).catch(function () { /* ignore network errors on logout */ });
    refreshAuthUI();
    hideDrawer();
  });

  if (drawerRegister) drawerRegister.addEventListener('click', function () {
    hideDrawer();
    showReg();
  });

  // ---------- Show/hide password ----------
  if (showPass && passInput) {
    showPass.addEventListener('click', function () {
      var isHidden = passInput.type === 'password';
      passInput.type = isHidden ? 'text' : 'password';
      showPass.textContent = isHidden ? '🙈' : '👁';
    });
  }

  // ---------- Registration modal — NOT available via this page ----------
  // There is no /api/v1/auth/register endpoint on the platform auth API.
  // Account creation happens through the market tenant onboarding
  // (POST /api/v1/market/auth/register) or by a system administrator.
  // The modal shows an honest unavailability message; the Save button is
  // disabled and never stores or sends anything.
  if (regClose) regClose.addEventListener('click', hideReg);
  if (regOverlay) regOverlay.addEventListener('click', function (e) {
    if (e.target === regOverlay) hideReg();
  });

  if (regToLogin) regToLogin.addEventListener('click', function () {
    hideReg();
    showDrawer();
  });

  if (regForm) regForm.addEventListener('submit', function (e) {
    e.preventDefault();
    setError(regMsg, '');
    var t = htmlEl.getAttribute('lang') === 'en' ? T.en : T.ar;
    regMsg.textContent = t.reg_unavailable_msg;
    regMsg.hidden = false;
    regMsg.className = 'reg-msg err';
    regSubmit.disabled = true;
  });

  // ---------- Escape key closes dialogs ----------
  document.addEventListener('keydown', function (e) {
    if (e && e.key === 'Escape') {
      if (drawer && !drawer.hidden) hideDrawer();
      if (regOverlay && !regOverlay.hidden) hideReg();
    }
  });

  // ---------- Init ----------
  buildLangSwitch();
  setLang(getLang());
  refreshAuthUI();
  checkSession();

})();

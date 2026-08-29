(function () {
  let _locale = 'en';
  try { _locale = localStorage.getItem('mk_locale') || 'en'; } catch (_) {}

  function locale() { return _locale; }
  function t(key) {
    const d = window.MK_LOCALES[_locale] || window.MK_LOCALES.en;
    return d[key] != null ? d[key] : (window.MK_LOCALES.en[key] || key);
  }
  function setLocale(l) {
    _locale = l;
    try { localStorage.setItem('mk_locale', l); } catch (_) {}
    document.documentElement.lang = l;
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    applyI18n();
  }
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((e) => {
      const k = e.getAttribute('data-i18n');
      if (k) e.textContent = t(k);
    });
    const btn = document.getElementById('mk-lang-btn');
    if (btn) btn.textContent = _locale === 'ar' ? 'English' : 'العربية';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function money(n, cur) {
    const currency = cur || (window.MK_CONFIG && window.MK_CONFIG.currency) || 'USD';
    try {
      return new Intl.NumberFormat(_locale === 'ar' ? 'ar-EG' : 'en', { style: 'currency', currency }).format(Number(n) || 0);
    } catch (_) {
      return currency + ' ' + (Number(n) || 0);
    }
  }

  let MK_CONFIG = null;
  let lastOrder = null;

  function updateCartBadge() {
    const c = document.getElementById('mk-cart-count');
    if (c) c.textContent = window.MK_CART.count();
  }
  window.addEventListener('mk-cart-changed', updateCartBadge);

  function banner(type, msg) {
    return '<div class="mk-banner ' + type + '">' + esc(msg) + '</div>';
  }

  const app = document.getElementById('mk-app');

  function setApp(html) {
    app.innerHTML = html;
  }

  // ---------- Pages ----------

  async function pageHome() {
    setApp('<div class="mk-loading">' + esc(t('loading')) + '</div>');
    const [cats, prods] = await Promise.all([
      window.MK_API.categories().catch(() => ({ categories: [] })),
      window.MK_API.products({ limit: 8 }).catch(() => ({ products: [] }))
    ]);
    let html = '<h1 class="mk-page-title">' + esc(t('home_title')) + '</h1>';
    html += '<p class="mk-muted">' + esc(t('home_sub')) + '</p>';
    html += '<p><a class="mk-btn" href="#/catalog">' + esc(t('shop_now')) + '</a></p>';
    if (cats.categories && cats.categories.length) {
      html += '<h2>' + esc(t('categories')) + '</h2><div class="mk-grid">';
      cats.categories.forEach((c) => {
        html += '<a class="mk-card" href="#/catalog?category=' + esc(c.id) + '"><div class="mk-card-body"><div class="mk-card-name">' + esc(c.id) + '</div><div class="mk-card-stock">' + esc(c.count) + '</div></div></a>';
      });
      html += '</div>';
    }
    html += '<h2>' + esc(t('featured')) + '</h2><div class="mk-grid" id="mk-featured"></div>';
    setApp(html);
    const grid = document.getElementById('mk-featured');
    (prods.products || []).forEach((p) => grid.appendChild(productCard(p)));
  }

  function productCard(p) {
    const a = document.createElement('a');
    a.className = 'mk-card';
    a.href = '#/product/' + encodeURIComponent(p.id);
    const out = (p.stockQty || 0) <= 0;
    a.innerHTML =
      '<div class="mk-card-img">📦</div>' +
      '<div class="mk-card-body">' +
        '<div class="mk-card-name">' + esc(p.name) + '</div>' +
        '<div class="mk-card-price">' + esc(money(p.price, p.currency)) + '</div>' +
        '<div class="mk-card-stock ' + (out ? 'out' : '') + '">' + (out ? esc(t('out_of_stock')) : esc(t('in_stock'))) + '</div>' +
      '</div>';
    return a;
  }

  async function pageCatalog() {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const cat = params.get('category') || '';
    const q = params.get('q') || '';
    const sort = params.get('sort') || 'name';
    setApp('<div class="mk-loading">' + esc(t('loading')) + '</div>');
    const [cats, prods] = await Promise.all([
      window.MK_API.categories().catch(() => ({ categories: [] })),
      window.MK_API.products({ categoryId: cat, search: q, sortBy: sort === 'price_asc' ? 'price' : sort === 'price_desc' ? 'price' : 'name', sortOrder: sort === 'price_desc' ? 'desc' : 'asc', limit: 100 }).catch(() => ({ products: [] }))
    ]);
    let html = '<h1 class="mk-page-title">' + esc(t('catalog_title')) + '</h1>';
    html += '<div class="mk-toolbar">' +
      '<input class="mk-input" id="mk-search" placeholder="' + esc(t('search_placeholder')) + '" value="' + esc(q) + '">' +
      '<select class="mk-select" id="mk-sort" style="max-width:220px">' +
        '<option value="name">' + esc(t('sort_name')) + '</option>' +
        '<option value="price_asc" ' + (sort === 'price_asc' ? 'selected' : '') + '>' + esc(t('sort_price_asc')) + '</option>' +
        '<option value="price_desc" ' + (sort === 'price_desc' ? 'selected' : '') + '>' + esc(t('sort_price_desc')) + '</option>' +
      '</select>' +
      '<select class="mk-select" id="mk-cat" style="max-width:200px">' +
        '<option value="">' + esc(t('all_categories')) + '</option>' +
        (cats.categories || []).map((c) => '<option value="' + esc(c.id) + '" ' + (c.id === cat ? 'selected' : '') + '>' + esc(c.id) + '</option>').join('') +
      '</select>' +
    '</div>';
    html += '<div class="mk-grid" id="mk-list"></div>';
    setApp(html);

    const list = document.getElementById('mk-list');
    (prods.products || []).forEach((p) => list.appendChild(productCard(p)));

    document.getElementById('mk-search').addEventListener('input', debounce(() => {
      const v = document.getElementById('mk-search').value;
      location.hash = '#/catalog?q=' + encodeURIComponent(v) + '&sort=' + sort + (cat ? '&category=' + encodeURIComponent(cat) : '');
    }, 400));
    document.getElementById('mk-sort').addEventListener('change', (e) => {
      location.hash = '#/catalog?q=' + encodeURIComponent(q) + '&sort=' + e.target.value + (cat ? '&category=' + encodeURIComponent(cat) : '');
    });
    document.getElementById('mk-cat').addEventListener('change', (e) => {
      location.hash = '#/catalog?q=' + encodeURIComponent(q) + '&sort=' + sort + (e.target.value ? '&category=' + encodeURIComponent(e.target.value) : '');
    });
  }

  async function pageProduct(id) {
    setApp('<div class="mk-loading">' + esc(t('loading')) + '</div>');
    const p = await window.MK_API.product(id).catch(() => null);
    if (!p) { setApp('<h1 class="mk-page-title">' + esc(t('product_not_found')) + '</h1><p><a href="#/catalog">' + esc(t('back_to_catalog')) + '</a></p>'); return; }
    const out = (p.stockQty || 0) <= 0;
    let html = '<a href="#/catalog">← ' + esc(t('back_to_catalog')) + '</a>';
    html += '<div class="mk-row" style="margin-top:16px">';
    html += '<div class="mk-col"><div class="mk-card-img" style="height:260px">📦</div></div>';
    html += '<div class="mk-col">';
    html += '<h1 class="mk-page-title">' + esc(p.name) + '</h1>';
    html += '<div class="mk-card-price" style="font-size:22px">' + esc(money(p.price, p.currency)) + '</div>';
    html += '<div class="mk-card-stock ' + (out ? 'out' : '') + '">' + (out ? esc(t('out_of_stock')) : esc(t('in_stock') + ': ' + p.stockQty)) + '</div>';
    if (p.description) html += '<p>' + esc(p.description) + '</p>';
    if (!out) {
      html += '<div class="mk-field" style="max-width:200px"><label>' + esc(t('qty')) + '</label><input class="mk-input mk-qty" id="mk-qty" type="number" min="1" value="1"></div>';
      html += '<button class="mk-btn" id="mk-add">' + esc(t('add_to_cart')) + '</button>';
    }
    html += '</div></div>';
    setApp(html);
    const add = document.getElementById('mk-add');
    if (add) add.addEventListener('click', () => {
      const qty = parseInt(document.getElementById('mk-qty').value, 10) || 1;
      window.MK_CART.add(p.id, qty);
      location.hash = '#/cart';
    });
  }

  async function pageCart() {
    await window.MK_CART.reconcile();
    const items = window.MK_CART.items();
    if (!items.length) { setApp('<h1 class="mk-page-title">' + esc(t('cart_title')) + '</h1><div class="mk-empty">' + esc(t('cart_empty')) + '</div>'); return; }
    setApp('<div class="mk-loading">' + esc(t('loading')) + '</div>');
    const avail = await window.MK_API.availability(items.map((i) => i.productId)).catch(() => []);
    const byId = {};
    avail.forEach((a) => { byId[a.id] = a; });
    const prods = await window.MK_API.products({ limit: 100 }).catch(() => ({ products: [] }));
    const pById = {};
    (prods.products || []).forEach((p) => { pById[p.id] = p; });

    let html = '<h1 class="mk-page-title">' + esc(t('cart_title')) + '</h1>';
    html += '<div id="mk-cart-items"></div>';
    html += '<div class="mk-summary" style="max-width:360px;margin-top:16px"><div class="mk-summary-row"><span>' + esc(t('subtotal')) + '</span><span id="mk-sub">-</span></div>';
    html += '<div class="mk-summary-row total"><span>' + esc(t('total')) + '</span><span id="mk-tot">-</span></div>';
    html += '<button class="mk-btn block" id="mk-gocheckout" style="margin-top:12px">' + esc(t('checkout')) + '</button></div>';
    setApp(html);

    const wrap = document.getElementById('mk-cart-items');
    let subtotal = 0;
    items.forEach((i) => {
      const p = pById[i.productId];
      const a = byId[i.productId];
      if (!p) return;
      const price = p.price;
      subtotal += price * i.qty;
      const row = document.createElement('div');
      row.className = 'mk-cart-item';
      const stock = a ? a.stockQty : 0;
      const noStock = !a || !a.available;
      row.innerHTML =
        '<div class="mk-ci-name"><div>' + esc(p.name) + '</div><div class="mk-card-stock ' + (noStock ? 'out' : '') + '">' + (noStock ? esc(t('out_of_stock')) : esc(t('in_stock') + ': ' + stock)) + '</div></div>' +
        '<input class="mk-input mk-qty" type="number" min="1" max="' + (stock || 1) + '" value="' + i.qty + '" ' + (noStock ? 'disabled' : '') + '>' +
        '<div>' + esc(money(price * i.qty, p.currency)) + '</div>' +
        '<button class="mk-btn danger" data-rm="' + esc(p.id) + '">' + esc(t('remove')) + '</button>';
      wrap.appendChild(row);
      const qtyInput = row.querySelector('.mk-qty');
      if (qtyInput && !noStock) qtyInput.addEventListener('change', (e) => { window.MK_CART.setQty(p.id, parseInt(e.target.value, 10) || 1); render(); });
      row.querySelector('[data-rm]').addEventListener('click', () => { window.MK_CART.remove(p.id); render(); });
    });
    document.getElementById('mk-sub').textContent = money(subtotal);
    document.getElementById('mk-tot').textContent = money(subtotal);
    document.getElementById('mk-gocheckout').addEventListener('click', () => { location.hash = '#/checkout'; });
  }

  async function pageCheckout() {
    const items = window.MK_CART.items();
    if (!items.length) { location.hash = '#/cart'; return; }
    const cfg = await window.MK_API.config().catch(() => null);
    window.MK_CONFIG = cfg;
    setApp('<div class="mk-loading">' + esc(t('loading')) + '</div>');
    const prods = await window.MK_API.products({ limit: 100 }).catch(() => ({ products: [] }));
    const pById = {};
    (prods.products || []).forEach((p) => { pById[p.id] = p; });

    let lines = [];
    let subtotal = 0;
    items.forEach((i) => {
      const p = pById[i.productId];
      if (!p) return;
      lines.push({ productId: p.id, name: p.name, qty: i.qty, unitPrice: p.price, lineTotal: p.price * i.qty });
      subtotal += p.price * i.qty;
    });

    const authed = window.MK_API.isAuthed();
    let html = '<h1 class="mk-page-title">' + esc(t('checkout_title')) + '</h1>';
    if (!authed) {
      html += banner('success', '<a href="#/account">' + esc(t('or_login')) + '</a>');
    }
    html += '<div class="mk-row"><div class="mk-col">';
    html += '<div class="mk-field"><label>' + esc(t('name')) + '</label><input class="mk-input" id="ck-name"></div>';
    html += '<div class="mk-field"><label>' + esc(t('email')) + '</label><input class="mk-input" id="ck-email" type="email"></div>';
    html += '<div class="mk-field"><label>' + esc(t('phone')) + '</label><input class="mk-input" id="ck-phone"></div>';
    html += '<div class="mk-field"><label>' + esc(t('shipping_address')) + '</label><input class="mk-input" id="ck-addr"></div>';
    html += '</div><div class="mk-col">';
    if (cfg && cfg.shippingZones && cfg.shippingZones.length) {
      html += '<div class="mk-field"><label>' + esc(t('shipping_zone')) + '</label><select class="mk-select" id="ck-zone">' +
        cfg.shippingZones.map((z) => '<option value="' + esc(z.id) + '">' + esc(z.name) + ' — ' + esc(money(z.fee, cfg.currency)) + '</option>').join('') +
        '</select></div>';
    }
    if (cfg && cfg.paymentMethods && cfg.paymentMethods.length) {
      html += '<div class="mk-field"><label>' + esc(t('payment_method')) + '</label><select class="mk-select" id="ck-pay">' +
        cfg.paymentMethods.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>').join('') +
        '</select></div>';
    }
    html += '<div class="mk-field"><label>' + esc(t('coupon')) + '</label><input class="mk-input" id="ck-coupon"></div>';
    html += '<div class="mk-summary"><div class="mk-summary-row"><span>' + esc(t('subtotal')) + '</span><span>' + esc(money(subtotal, cfg && cfg.currency)) + '</span></div>';
    html += '<div class="mk-summary-row"><span>' + esc(t('shipping_fee')) + '</span><span id="ck-ship">' + esc(money(0, cfg && cfg.currency)) + '</span></div>';
    html += '<div class="mk-summary-row total"><span>' + esc(t('total')) + '</span><span id="ck-total">' + esc(money(subtotal, cfg && cfg.currency)) + '</span></div></div>';
    html += '<button class="mk-btn block" id="ck-place" style="margin-top:12px">' + esc(t('place_order')) + '</button>';
    html += '<div id="ck-msg"></div>';
    html += '</div></div>';
    setApp(html);

    const zoneSel = document.getElementById('ck-zone');
    const updateTotals = () => {
      const zone = (cfg && cfg.shippingZones || []).find((z) => z.id === (zoneSel && zoneSel.value));
      const fee = zone ? zone.fee : 0;
      document.getElementById('ck-ship').textContent = money(fee, cfg && cfg.currency);
      document.getElementById('ck-total').textContent = money(subtotal + fee, cfg && cfg.currency);
    };
    if (zoneSel) zoneSel.addEventListener('change', updateTotals);
    updateTotals();

    document.getElementById('ck-place').addEventListener('click', async () => {
      const msg = document.getElementById('ck-msg');
      msg.innerHTML = '';
      const name = document.getElementById('ck-name').value.trim();
      const email = document.getElementById('ck-email').value.trim();
      const payload = {
        items: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
        shippingZoneId: zoneSel ? zoneSel.value : undefined,
        paymentMethodId: (document.getElementById('ck-pay') || {}).value,
        couponCode: document.getElementById('ck-coupon').value.trim() || undefined,
        customerInfo: { name, email, phone: document.getElementById('ck-phone').value.trim() },
        shippingAddress: document.getElementById('ck-addr').value.trim() || null
      };
      if (!name || !email) { msg.innerHTML = banner('error', t('required_field')); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.innerHTML = banner('error', t('invalid_email')); return; }
      const btn = document.getElementById('ck-place');
      btn.disabled = true; btn.textContent = t('please_wait');
      try {
        const res = await window.MK_API.checkout(payload);
        window.MK_CART.clear();
        lastOrder = res.order;
        location.hash = '#/confirmation';
      } catch (e) {
        msg.innerHTML = banner('error', e.message || t('error_generic'));
        btn.disabled = false; btn.textContent = t('place_order');
      }
    });
  }

  function pageConfirmation() {
    if (!lastOrder) { location.hash = '#/catalog'; return; }
    const o = lastOrder;
    let html = banner('success', esc(t('order_confirmed')));
    html += '<div class="mk-order-card">';
    html += '<div><strong>' + esc(t('order_code')) + ':</strong> ' + esc(o.orderCode) + '</div>';
    html += '<div><strong>' + esc(t('track_token')) + ':</strong> <code>' + esc(o.trackingToken) + '</code></div>';
    html += '<div><strong>' + esc(t('total')) + ':</strong> ' + esc(money(o.total)) + '</div>';
    html += '<div><strong>' + esc(t('status')) + ':</strong> ' + esc(o.status) + '</div>';
    html += '<p><a class="mk-btn" href="#/track/' + esc(o.trackingToken) + '">' + esc(t('track_btn')) + '</a> <a class="mk-btn secondary" href="#/catalog">' + esc(t('continue_shopping')) + '</a></p>';
    html += '</div>';
    setApp(html);
  }

  function pageTrack(token) {
    let html = '<h1 class="mk-page-title">' + esc(t('track_title')) + '</h1>';
    html += '<div class="mk-field" style="max-width:420px"><label>' + esc(t('track_token')) + '</label><input class="mk-input" id="tk-token" value="' + esc(token || '') + '"></div>';
    html += '<button class="mk-btn" id="tk-btn">' + esc(t('track_btn')) + '</button>';
    html += '<div id="tk-msg"></div><div id="tk-result"></div>';
    setApp(html);
    const run = async () => {
      const tk = document.getElementById('tk-token').value.trim();
      const msg = document.getElementById('tk-msg');
      const res = document.getElementById('tk-result');
      msg.innerHTML = ''; res.innerHTML = '';
      if (!tk) { msg.innerHTML = banner('error', t('required_field')); return; }
      const o = await window.MK_API.track(tk).catch(() => null);
      if (!o) { msg.innerHTML = banner('error', t('track_not_found')); return; }
      res.innerHTML = '<div class="mk-order-card">' +
        '<div><strong>' + esc(t('order_code')) + ':</strong> ' + esc(o.orderCode) + '</div>' +
        '<div><strong>' + esc(t('status')) + ':</strong> ' + esc(o.status) + '</div>' +
        '<div><strong>' + esc(t('payment_status')) + ':</strong> ' + esc(o.paymentStatus) + '</div>' +
        (o.items || []).map((i) => '<div>' + esc(i.name) + ' × ' + i.qty + '</div>').join('') +
        '</div>';
    };
    document.getElementById('tk-btn').addEventListener('click', run);
    if (token) run();
  }

  async function pageAccount() {
    if (!window.MK_API.isAuthed()) {
      let html = '<h1 class="mk-page-title">' + esc(t('account_title')) + '</h1>';
      html += '<div class="mk-row"><div class="mk-col"><h2>' + esc(t('login_title')) + '</h2><div id="ac-login-msg"></div>';
      html += '<div class="mk-field"><label>' + esc(t('email')) + '</label><input class="mk-input" id="lg-email"></div>';
      html += '<div class="mk-field"><label>' + esc(t('password')) + '</label><input class="mk-input" id="lg-pass" type="password"></div>';
      html += '<button class="mk-btn" id="lg-btn">' + esc(t('login')) + '</button></div>';
      html += '<div class="mk-col"><h2>' + esc(t('register_title')) + '</h2><div id="ac-reg-msg"></div>';
      html += '<div class="mk-field"><label>' + esc(t('name')) + '</label><input class="mk-input" id="rg-name"></div>';
      html += '<div class="mk-field"><label>' + esc(t('email')) + '</label><input class="mk-input" id="rg-email" type="email"></div>';
      html += '<div class="mk-field"><label>' + esc(t('phone')) + '</label><input class="mk-input" id="rg-phone"></div>';
      html += '<div class="mk-field"><label>' + esc(t('password_req')) + '</label><input class="mk-input" id="rg-pass" type="password"></div>';
      html += '<button class="mk-btn" id="rg-btn">' + esc(t('register')) + '</button></div></div>';
      setApp(html);
      document.getElementById('lg-btn').addEventListener('click', async () => {
        const msg = document.getElementById('ac-login-msg');
        try {
          const r = await window.MK_API.login({ email: document.getElementById('lg-email').value, password: document.getElementById('lg-pass').value });
          window.MK_API.setToken(r.token);
          render();
        } catch (e) { msg.innerHTML = banner('error', e.message || t('error_generic')); }
      });
      document.getElementById('rg-btn').addEventListener('click', async () => {
        const msg = document.getElementById('ac-reg-msg');
        try {
          const r = await window.MK_API.register({ email: document.getElementById('rg-email').value, name: document.getElementById('rg-name').value, phone: document.getElementById('rg-phone').value, password: document.getElementById('rg-pass').value });
          window.MK_API.setToken(r.token);
          render();
        } catch (e) { msg.innerHTML = banner('error', e.message || t('error_generic')); }
      });
      return;
    }

    const me = await window.MK_API.me().catch(() => null);
    const orders = await window.MK_API.myOrders().catch(() => ({ orders: [] }));
    let html = '<h1 class="mk-page-title">' + esc(t('account_title')) + '</h1>';
    html += '<p><button class="mk-btn danger" id="ac-logout">' + esc(t('logout')) + '</button></p>';
    if (me && me.customer) {
      html += '<h2>' + esc(t('profile')) + '</h2><div id="ac-prof-msg"></div>';
      html += '<div class="mk-field" style="max-width:360px"><label>' + esc(t('name')) + '</label><input class="mk-input" id="pf-name" value="' + esc(me.customer.name) + '"></div>';
      html += '<div class="mk-field" style="max-width:360px"><label>' + esc(t('phone')) + '</label><input class="mk-input" id="pf-phone" value="' + esc(me.customer.phone) + '"></div>';
      html += '<button class="mk-btn" id="pf-save">' + esc(t('update_profile')) + '</button> ';
      html += '<button class="mk-btn secondary" id="pf-chg">' + esc(t('change_password')) + '</button>';
      html += '<div id="ac-pw-msg"></div>';
    }
    html += '<h2>' + esc(t('my_orders')) + '</h2>';
    if (!orders.orders || !orders.orders.length) {
      html += '<div class="mk-empty">' + esc(t('no_orders')) + '</div>';
    } else {
      orders.orders.forEach((o) => {
        html += '<div class="mk-order-card">';
        html += '<div><strong>' + esc(t('order_code')) + ':</strong> ' + esc(o.orderCode) + ' <span class="mk-badge">' + esc(o.status) + '</span></div>';
        html += '<div>' + esc(t('total')) + ': ' + esc(money(o.total)) + '</div>';
        html += '<div>' + esc(t('payment_status')) + ': ' + esc(o.paymentStatus) + '</div>';
        html += '</div>';
      });
    }
    setApp(html);
    document.getElementById('ac-logout').addEventListener('click', async () => {
      await window.MK_API.logout().catch(() => {});
      window.MK_API.setToken(null);
      render();
    });
    const pfSave = document.getElementById('pf-save');
    if (pfSave) pfSave.addEventListener('click', async () => {
      const msg = document.getElementById('ac-prof-msg');
      try {
        await window.MK_API.updateProfile({ name: document.getElementById('pf-name').value, phone: document.getElementById('pf-phone').value });
        msg.innerHTML = banner('success', t('save'));
      } catch (e) { msg.innerHTML = banner('error', e.message || t('error_generic')); }
    });
    const pfChg = document.getElementById('pf-chg');
    if (pfChg) pfChg.addEventListener('click', async () => {
      const msg = document.getElementById('ac-pw-msg');
      const cur = prompt(t('current_password'));
      const neu = prompt(t('new_password'));
      if (!cur || !neu) return;
      try {
        const r = await window.MK_API.changePassword({ currentPassword: cur, newPassword: neu });
        window.MK_API.setToken(r.token);
        msg.innerHTML = banner('success', t('save'));
      } catch (e) { msg.innerHTML = banner('error', e.message || t('error_generic')); }
    });
  }

  // ---------- Router ----------

  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(null, a), ms); };
  }

  async function render() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, param] = h.split('/');
    updateCartBadge();
    applyI18n();
    try {
      if (path === 'catalog') return pageCatalog();
      if (path === 'product') return pageProduct(param);
      if (path === 'cart') return pageCart();
      if (path === 'checkout') return pageCheckout();
      if (path === 'confirmation') return pageConfirmation();
      if (path === 'track') return pageTrack(param);
      if (path === 'account') return pageAccount();
      return pageHome();
    } catch (e) {
      setApp(banner('error', e.message || t('error_generic')));
    }
  }

  function init() {
    document.documentElement.lang = _locale;
    document.documentElement.dir = _locale === 'ar' ? 'rtl' : 'ltr';
    const langBtn = document.getElementById('mk-lang-btn');
    if (langBtn) langBtn.addEventListener('click', () => setLocale(_locale === 'ar' ? 'en' : 'ar'));
    window.addEventListener('hashchange', render);
    if (!location.hash) location.hash = '#/home';
    else render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

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
  function renderIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
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
    const count = window.MK_CART.count();
    const desktop = document.getElementById('mk-cart-count');
    const mobile = document.getElementById('mk-mobile-cart-count');
    const bottom = document.getElementById('mk-bottom-cart-count');
    if (desktop) desktop.textContent = count;
    if (mobile) mobile.textContent = count;
    if (bottom) bottom.textContent = count;
  }
  window.addEventListener('mk-cart-changed', updateCartBadge);

  function banner(type, msg) {
    return '<div class="mk-banner ' + type + '">' + esc(msg) + '</div>';
  }

  function fieldError(inputId, message) {
    const input = document.getElementById(inputId);
    if (!input) return '';
    input.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
    const errEl = document.createElement('div');
    errEl.className = 'mk-field-error';
    errEl.id = inputId + '-error';
    errEl.textContent = message;
    errEl.setAttribute('role', 'alert');
    input.setAttribute('aria-describedby', errEl.id);
    const field = input.closest('.mk-field');
    if (field) {
      let existing = field.querySelector('.' + errEl.className);
      if (existing) existing.remove();
      field.appendChild(errEl);
    }
    return '';
  }

  function clearFieldError(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.classList.remove('is-invalid');
    input.removeAttribute('aria-invalid');
    const errId = inputId + '-error';
    const errEl = document.getElementById(errId);
    if (errEl) errEl.remove();
    input.removeAttribute('aria-describedby');
  }

  function clearAllFieldErrors(prefix) {
    document.querySelectorAll('.mk-input.is-invalid, .mk-select.is-invalid').forEach((el) => {
      if (!prefix || el.id.startsWith(prefix)) {
        el.classList.remove('is-invalid');
        el.removeAttribute('aria-invalid');
        const errId = el.id + '-error';
        const errEl = document.getElementById(errId);
        if (errEl) errEl.remove();
        el.removeAttribute('aria-describedby');
      }
    });
  }

  function storeAuthDestination() {
    try { sessionStorage.setItem('mk_auth_dest', location.hash || '#/game-hosting'); } catch (_) {}
  }

  function takeAuthDestination() {
    try { const dest = sessionStorage.getItem('mk_auth_dest'); sessionStorage.removeItem('mk_auth_dest'); return dest; } catch (_) { return ''; }
  }

  function confirmDialog(message) {
    return new Promise((resolve) => {
      const dialog = document.getElementById('mk-confirm-dialog');
      const titleEl = document.getElementById('mk-confirm-title');
      const msgEl = document.getElementById('mk-confirm-msg');
      const cancelBtn = document.getElementById('mk-confirm-cancel');
      const okBtn = document.getElementById('mk-confirm-ok');
      if (!dialog || !msgEl || !cancelBtn || !okBtn) {
        resolve(window.confirm(message));
        return;
      }
      if (titleEl) titleEl.textContent = '';
      msgEl.textContent = message;
      dialog.showModal();
      const cleanup = () => {
        cancelBtn.removeEventListener('click', onCancel);
        okBtn.removeEventListener('click', onOk);
        dialog.close();
      };
      const onCancel = () => { cleanup(); resolve(false); };
      const onOk = () => { cleanup(); resolve(true); };
      cancelBtn.addEventListener('click', onCancel);
      okBtn.addEventListener('click', onOk);
    });
  }

  function emptyState(icon, title, sub, actions) {
    let html = '<div class="mk-empty">';
    if (icon) html += '<div class="mk-empty-icon"><i data-lucide="' + esc(icon) + '"></i></div>';
    html += '<p class="mk-empty-title">' + esc(title) + '</p>';
    if (sub) html += '<p class="mk-empty-sub">' + esc(sub) + '</p>';
    if (actions) html += '<div class="mk-empty-actions">' + actions + '</div>';
    html += '</div>';
    return html;
  }

  function breadcrumb(items) {
    if (!items || !items.length) return '';
    let html = '<nav aria-label="Breadcrumb" class="mk-breadcrumb"><ol>';
    items.forEach((item, i) => {
      const isLast = i === items.length - 1;
      if (i > 0) html += '<li class="mk-breadcrumb-sep" aria-hidden="true">/</li>';
      html += '<li>';
      if (isLast || !item.href) {
        html += '<span class="mk-breadcrumb-current" aria-current="page">' + esc(item.label) + '</span>';
      } else {
        html += '<a href="' + esc(item.href) + '">' + esc(item.label) + '</a>';
      }
      html += '</li>';
    });
    html += '</ol></nav>';
    return html;
  }

  function skeletonCard() {
    return '<div class="mk-card"><div class="mk-skeleton mk-skeleton-card"></div><div class="mk-card-body"><div class="mk-skeleton mk-skeleton-title"></div><div class="mk-skeleton mk-skeleton-text"></div><div class="mk-skeleton mk-skeleton-text mk-skeleton-text--sm"></div></div></div>';
  }

  function skeletonGrid(count) {
    const n = Math.max(1, count || 6);
    let html = '<div class="mk-grid">';
    for (let i = 0; i < n; i++) html += skeletonCard();
    html += '</div>';
    return html;
  }

  function skeletonCartItems(count) {
    const n = Math.max(1, count || 3);
    let html = '<div class="mk-cart-items">';
    for (let i = 0; i < n; i++) {
      html += '<div class="mk-cart-item"><div class="mk-skeleton" style="flex:1;height:18px"></div><div class="mk-skeleton" style="width:64px;height:36px"></div><div class="mk-skeleton" style="width:80px;height:36px"></div><div class="mk-skeleton" style="width:64px;height:36px"></div></div>';
    }
    html += '</div>';
    return html;
  }

  function skeletonCheckoutForm() {
    let html = '<h1 class="mk-page-title">' + esc(t('checkout_title')) + '</h1>';
    html += '<div class="mk-row"><div class="mk-col">';
    html += '<div class="mk-skeleton" style="height:18px;width:60px;margin-bottom:8px"></div>';
    html += '<div class="mk-skeleton" style="height:40px;margin-bottom:14px"></div>';
    html += '<div class="mk-skeleton" style="height:18px;width:60px;margin-bottom:8px"></div>';
    html += '<div class="mk-skeleton" style="height:40px;margin-bottom:14px"></div>';
    html += '<div class="mk-skeleton" style="height:18px;width:60px;margin-bottom:8px"></div>';
    html += '<div class="mk-skeleton" style="height:40px;margin-bottom:14px"></div>';
    html += '<div class="mk-skeleton" style="height:18px;width:100px;margin-bottom:8px"></div>';
    html += '<div class="mk-skeleton" style="height:40px;margin-bottom:14px"></div>';
    html += '</div><div class="mk-col">';
    html += '<div class="mk-skeleton" style="height:180px;margin-bottom:16px"></div>';
    html += '<div class="mk-skeleton" style="height:48px;width:100%"></div>';
    html += '</div></div>';
    return html;
  }

  function skeletonGameCard() {
    return '<div class="mk-card"><div class="mk-card-body"><div class="mk-skeleton" style="height:18px;width:70%;margin-bottom:8px"></div><div class="mk-skeleton" style="height:14px;width:50%;margin-bottom:6px"></div><div class="mk-skeleton" style="height:14px;width:40%;margin-bottom:6px"></div><div class="mk-skeleton" style="height:36px;width:100%;margin-top:8px"></div></div></div>';
  }

  function skeletonGameGrid(count) {
    const n = Math.max(1, count || 4);
    let html = '<div class="mk-grid">';
    for (let i = 0; i < n; i++) html += skeletonGameCard();
    html += '</div>';
    return html;
  }

  const app = document.getElementById('mk-app');

  function setApp(html) {
    app.innerHTML = html;
    renderIcons();
  }

  // ---------- Pages ----------

  async function pageHome() {
    setApp('<div class="mk-loading">' + esc(t('loading')) + '</div>');
    const [cats, prods] = await Promise.all([
      window.MK_API.categories().catch(() => ({ categories: [] })),
      window.MK_API.products({ limit: 8 }).catch(() => ({ products: [] }))
    ]);

    let html = '<section class="mk-hero">' +
      '<div class="mk-hero-content">' +
        '<h1 class="mk-hero-title">' + esc(t('hero_title')) + '</h1>' +
        '<p class="mk-hero-sub">' + esc(t('hero_sub')) + '</p>' +
        '<div class="mk-hero-actions">' +
          '<a class="mk-btn" href="#/catalog">' + esc(t('hero_cta')) + '</a>' +
          '<a class="mk-btn secondary" href="#/track">' + esc(t('hero_cta_track')) + '</a>' +
        '</div>' +
      '</div>' +
      '<div class="mk-hero-visual" aria-hidden="true"><img src="market/img/hero/storefront.svg" alt="" loading="eager" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><div class="mk-hero-fallback" style="display:none"><i data-lucide="shopping-bag"></i></div></div>' +
    '</section>';

    if (cats.categories && cats.categories.length) {
      html += '<h2>' + esc(t('categories')) + '</h2><div class="mk-grid">';
      cats.categories.forEach((c) => {
        html += '<a class="mk-card mk-category-card" href="#/catalog?category=' + esc(c.id) + '"><div class="mk-category-icon"><img src="market/img/placeholders/category.svg" alt="' + esc(t('category_icon_alt')) + '" loading="lazy" onerror="this.style.display=\'none\'"></div><div class="mk-card-body"><div class="mk-card-name">' + esc(c.id) + '</div><div class="mk-card-stock">' + esc(c.count) + '</div></div></a>';
      });
      html += '</div>';
    } else {
      html += '<h2>' + esc(t('categories')) + '</h2>' + emptyState('folder-open', t('no_categories'), null, '<a class="mk-btn" href="#/catalog">' + esc(t('empty_browse_catalog')) + '</a>');
    }

    html += '<h2>' + esc(t('featured')) + '</h2>';
    if ((prods.products || []).length) {
      html += '<div class="mk-grid" id="mk-featured"></div>';
    } else {
      html += emptyState('package', t('no_products'), null, '<a class="mk-btn" href="#/catalog">' + esc(t('empty_browse_catalog')) + '</a>');
    }
    setApp(html);

    const grid = document.getElementById('mk-featured');
    if (grid) (prods.products || []).forEach((p) => grid.appendChild(productCard(p)));
  }

  function productCard(p) {
    const a = document.createElement('a');
    a.className = 'mk-card';
    a.href = '#/product/' + encodeURIComponent(p.id);
    const out = (p.stockQty || 0) <= 0;
    const fallbackSrc = 'market/img/placeholders/product.svg';
    const imgHtml = '<img src="' + (p.imageUrl || fallbackSrc) + '" alt="' + esc(t('product_image_alt')) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' + '<div class="mk-card-fallback" style="display:none"><i data-lucide="package"></i></div>';
    a.innerHTML =
      '<div class="mk-card-img">' + imgHtml + '</div>' +
      '<div class="mk-card-body">' +
        '<div class="mk-card-name">' + esc(p.name) + '</div>' +
        '<div class="mk-card-price">' + esc(money(p.price, p.currency)) + '</div>' +
        '<div class="mk-card-stock ' + (out ? 'out' : '') + '">' + (out ? esc(t('out_of_stock')) : esc(t('in_stock'))) + '</div>' +
        (out ? '' : '<div class="mk-card-actions"><input class="mk-input mk-qty mk-qty--sm" type="number" min="1" value="1" data-qty>' + '<button class="mk-btn block mk-add-to-cart" data-id="' + esc(p.id) + '">' + esc(t('add_to_cart')) + '</button></div>') +
      '</div>';
    return a;
  }

  async function pageCatalog() {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const cat = params.get('category') || '';
    const q = params.get('q') || '';
    const sort = params.get('sort') || 'name';
    setApp('<div class="mk-loading">' + esc(t('loading')) + '</div><div class="mk-grid">' + skeletonGrid(6) + '</div>');
    const [cats, prods] = await Promise.all([
      window.MK_API.categories().catch(() => ({ categories: [] })),
      window.MK_API.products({ categoryId: cat, search: q, sortBy: sort === 'price_asc' ? 'price' : sort === 'price_desc' ? 'price' : 'name', sortOrder: sort === 'price_desc' ? 'desc' : 'asc', limit: 100 }).catch(() => ({ products: [] }))
    ]);
    const allProducts = (prods.products || []).slice();
    let html = '<h1 class="mk-page-title">' + esc(t('catalog_title')) + '</h1>';
    html += '<div class="mk-toolbar">' +
      '<div class="mk-autocomplete" id="mk-search-wrap">' +
        '<input class="mk-input" id="mk-search" placeholder="' + esc(t('search_placeholder')) + '" value="' + esc(q) + '" autocomplete="off" aria-autocomplete="list" aria-controls="mk-search-menu" role="combobox" aria-expanded="false">' +
        '<div class="mk-autocomplete-menu" id="mk-search-menu" role="listbox"></div>' +
      '</div>' +
      '<select class="mk-select mk-select--sm" id="mk-sort">' +
        '<option value="name">' + esc(t('sort_name')) + '</option>' +
        '<option value="price_asc" ' + (sort === 'price_asc' ? 'selected' : '') + '>' + esc(t('sort_price_asc')) + '</option>' +
        '<option value="price_desc" ' + (sort === 'price_desc' ? 'selected' : '') + '>' + esc(t('sort_price_desc')) + '</option>' +
      '</select>' +
      '<select class="mk-select mk-select--cat" id="mk-cat">' +
        '<option value="">' + esc(t('all_categories')) + '</option>' +
        (cats.categories || []).map((c) => '<option value="' + esc(c.id) + '" ' + (c.id === cat ? 'selected' : '') + '>' + esc(c.id) + '</option>').join('') +
      '</select>' +
    '</div>';
    html += '<div class="mk-grid" id="mk-list"></div>';
    setApp(html);

    const list = document.getElementById('mk-list');
    (prods.products || []).forEach((p) => {
      const card = productCard(p);
      list.appendChild(card);
      const btn = card.querySelector('.mk-add-to-cart');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const qty = parseInt(card.querySelector('.mk-qty')?.value || '1', 10) || 1;
          window.MK_CART.add(p.id, qty);
        });
      }
    });

    const searchInput = document.getElementById('mk-search');
    const menu = document.getElementById('mk-search-menu');
    const wrap = document.getElementById('mk-search-wrap');
    let activeIndex = -1;
    let suggestions = [];

    const updateSuggestions = (value) => {
      const v = (value || '').trim().toLowerCase();
      if (v.length < 2) { menu.classList.remove('is-open'); suggestions = []; activeIndex = -1; searchInput.setAttribute('aria-expanded', 'false'); return; }
      suggestions = allProducts.filter((p) => (p.name || '').toLowerCase().includes(v)).slice(0, 6);
      activeIndex = -1;
      if (!suggestions.length) { menu.innerHTML = ''; menu.classList.remove('is-open'); searchInput.setAttribute('aria-expanded', 'false'); return; }
      menu.innerHTML = suggestions.map((p, i) => '<div class="mk-autocomplete-item" role="option" data-index="' + i + '" data-id="' + esc(p.id) + '" aria-selected="false"><div class="mk-autocomplete-name">' + esc(p.name) + '</div><div class="mk-autocomplete-meta">' + esc(t('nav_catalog')) + '</div></div>').join('');
      menu.classList.add('is-open');
      searchInput.setAttribute('aria-expanded', 'true');
      menu.querySelectorAll('.mk-autocomplete-item').forEach((el) => el.addEventListener('click', () => { selectSuggestion(el.getAttribute('data-id')); }));
    };

    const selectSuggestion = (id) => {
      menu.classList.remove('is-open');
      searchInput.setAttribute('aria-expanded', 'false');
      suggestions = [];
      activeIndex = -1;
      if (id) location.hash = '#/product/' + encodeURIComponent(id);
    };

    const setActive = (i) => {
      const items = menu.querySelectorAll('.mk-autocomplete-item');
      items.forEach((el, idx) => { el.classList.toggle('is-active', idx === i); el.setAttribute('aria-selected', idx === i ? 'true' : 'false'); });
      activeIndex = i;
      if (i >= 0 && items[i]) items[i].scrollIntoView({ block: 'nearest' });
    };

    if (searchInput) {
      searchInput.addEventListener('input', () => updateSuggestions(searchInput.value));
      searchInput.addEventListener('keydown', (e) => {
        const items = menu.querySelectorAll('.mk-autocomplete-item');
        if (!menu.classList.contains('is-open') || !items.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex < items.length - 1 ? activeIndex + 1 : 0); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex > 0 ? activeIndex - 1 : items.length - 1); }
        else if (e.key === 'Enter') { e.preventDefault(); if (activeIndex >= 0 && items[activeIndex]) selectSuggestion(items[activeIndex].getAttribute('data-id')); else { menu.classList.remove('is-open'); searchInput.setAttribute('aria-expanded', 'false'); } }
        else if (e.key === 'Escape') { menu.classList.remove('is-open'); searchInput.setAttribute('aria-expanded', 'false'); suggestions = []; activeIndex = -1; }
      });
    }

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

    document.addEventListener('click', (e) => {
      if (wrap && !wrap.contains(e.target)) { menu.classList.remove('is-open'); searchInput.setAttribute('aria-expanded', 'false'); suggestions = []; activeIndex = -1; }
    });
  }

  async function pageProduct(id) {
    setApp('<div class="mk-loading">' + esc(t('loading')) + '</div>');
    const p = await window.MK_API.product(id).catch(() => null);
    if (!p) { setApp('<h1 class="mk-page-title">' + esc(t('product_not_found')) + '</h1><p><a href="#/catalog">' + esc(t('back_to_catalog')) + '</a></p>'); return; }
    const out = (p.stockQty || 0) <= 0;
    const fallbackSrc = 'market/img/placeholders/product.svg';
    const imgHtml = '<img src="' + (p.imageUrl || fallbackSrc) + '" alt="' + esc(t('product_image_alt')) + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' + '<div class="mk-card-fallback" style="display:none"><i data-lucide="package"></i></div>';
    let html = breadcrumb([{label: t('nav_home'), href: '#/home'}, {label: t('nav_catalog'), href: '#/catalog'}, {label: p.name}]);
    html += '<div class="mk-row mk-mt-16">';
    html += '<div class="mk-col"><div class="mk-product-image">' + imgHtml + '</div></div>';
    html += '<div class="mk-col">';
    html += '<h1 class="mk-page-title">' + esc(p.name) + '</h1>';
    html += '<div class="mk-card-price mk-price--lg">' + esc(money(p.price, p.currency)) + '</div>';
    html += '<div class="mk-card-stock ' + (out ? 'out' : '') + '">' + (out ? esc(t('out_of_stock')) : esc(t('in_stock') + ': ' + p.stockQty)) + '</div>';
    if (p.description) html += '<p>' + esc(p.description) + '</p>';
    if (!out) {
      html += '<div class="mk-field"><label for="mk-qty">' + esc(t('qty')) + '</label><input class="mk-input mk-qty mk-qty--sm" id="mk-qty" type="number" min="1" value="1"></div>';
      html += '<button class="mk-btn" id="mk-add">' + esc(t('add_to_cart')) + '</button>';
    }
    html += '</div></div>';
    html += '<h2 style="margin-top:24px">' + esc(t('related_products')) + '</h2><div class="mk-grid" id="mk-related"></div>';
    setApp(html);
    const add = document.getElementById('mk-add');
    if (add) add.addEventListener('click', () => {
      const qty = parseInt(document.getElementById('mk-qty').value, 10) || 1;
      window.MK_CART.add(p.id, qty);
      location.hash = '#/cart';
    });

    const relGrid = document.getElementById('mk-related');
    let related = [];
    try { const r = await window.MK_API.products({ categoryId: p.categoryId, limit: 5 }); related = (r && r.products || []).filter((x) => x.id !== p.id); } catch (_) {}
    if (!relGrid) return;
    if (!related.length) {
      relGrid.innerHTML = '<div class="mk-empty" style="padding:24px"><div class="mk-empty-title">' + esc(t('no_related_products')) + '</div></div>';
      return;
    }
    related.forEach((rp) => relGrid.appendChild(productCard(rp)));
  }

  async function pageCart() {
    await window.MK_CART.reconcile();
    const items = window.MK_CART.items();
    if (!items.length) { setApp('<h1 class="mk-page-title">' + esc(t('cart_title')) + '</h1>' + emptyState('shopping-cart', t('cart_empty'), null, '<a class="mk-btn" href="#/catalog">' + esc(t('empty_browse_catalog')) + '</a>')); return; }
    setApp('<h1 class="mk-page-title">' + esc(t('cart_title')) + '</h1><div id="mk-cart-items">' + skeletonCartItems(items.length) + '</div><div class="mk-summary mk-summary--checkout"><div class="mk-summary-row"><span>' + esc(t('subtotal')) + '</span><span id="mk-sub">-</span></div><div class="mk-summary-row total"><span>' + esc(t('total')) + '</span><span id="mk-tot">-</span></div><button class="mk-btn block" id="mk-gocheckout" disabled>' + esc(t('checkout')) + '</button></div>');
    const avail = await window.MK_API.availability(items.map((i) => i.productId)).catch(() => []);
    const byId = {};
    avail.forEach((a) => { byId[a.id] = a; });
    const prods = await window.MK_API.products({ limit: 100 }).catch(() => ({ products: [] }));
    const pById = {};
    (prods.products || []).forEach((p) => { pById[p.id] = p; });

    let html = '<h1 class="mk-page-title">' + esc(t('cart_title')) + '</h1>';
    html += '<div id="mk-cart-items"></div>';
    html += '<div class="mk-summary mk-summary--checkout"><div class="mk-summary-row"><span>' + esc(t('subtotal')) + '</span><span id="mk-sub">-</span></div>';
    html += '<div class="mk-summary-row total"><span>' + esc(t('total')) + '</span><span id="mk-tot">-</span></div>';
    html += '<button class="mk-btn block" id="mk-gocheckout">' + esc(t('checkout')) + '</button></div>';
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
        '<div class="mk-ci-name"><div class="mk-ci-name-text" title="' + esc(p.name) + '">' + esc(p.name) + '</div><div class="mk-card-stock ' + (noStock ? 'out' : '') + '">' + (noStock ? esc(t('out_of_stock')) : esc(t('in_stock') + ': ' + stock)) + '</div></div>' +
        '<div class="mk-cart-item-actions">' +
          '<input class="mk-input mk-qty" type="number" min="1" max="' + (stock || 1) + '" value="' + i.qty + '" ' + (noStock ? 'disabled' : '') + '>' +
          '<div class="mk-cart-item-price">' + esc(money(price * i.qty, p.currency)) + '</div>' +
          '<button class="mk-btn danger mk-btn--icon" data-rm="' + esc(p.id) + '" aria-label="' + esc(t('remove')) + '"><i data-lucide="trash-2" style="width:16px;height:16px"></i></button>' +
        '</div>';
      wrap.appendChild(row);
      const qtyInput = row.querySelector('.mk-qty');
      if (qtyInput && !noStock) qtyInput.addEventListener('change', (e) => { window.MK_CART.setQty(p.id, parseInt(e.target.value, 10) || 1); render(); });
      row.querySelector('[data-rm]').addEventListener('click', () => { window.MK_CART.remove(p.id); render(); });
    });
    document.getElementById('mk-sub').textContent = money(subtotal);
    document.getElementById('mk-tot').textContent = money(subtotal);
    const checkoutBtn = document.getElementById('mk-gocheckout');
    if (checkoutBtn) { checkoutBtn.disabled = false; }
    if (checkoutBtn) checkoutBtn.addEventListener('click', () => { location.hash = '#/checkout'; });
  }

  async function pageCheckout() {
    const items = window.MK_CART.items();
    if (!items.length) { location.hash = '#/cart'; return; }
    const cfg = await window.MK_API.config().catch(() => null);
    window.MK_CONFIG = cfg;
    setApp(skeletonCheckoutForm());
    const prods = await window.MK_API.products({ limit: 100 }).catch(() => ({ products: [] }));
    const pById = {};
    (prods.products || []).forEach((p) => { pById[p.id] = p; });

    let lines = [];
    let subtotal = 0;
    let fee = 0;
    items.forEach((i) => {
      const p = pById[i.productId];
      if (!p) return;
      lines.push({ productId: p.id, name: p.name, qty: i.qty, unitPrice: p.price, lineTotal: p.price * i.qty });
      subtotal += p.price * i.qty;
    });

    const authed = window.MK_API.isAuthed();
    let html = '<h1 class="mk-page-title">' + esc(t('checkout_title')) + '</h1>';
    if (!authed) {
      storeAuthDestination();
      location.hash = '#/account';
      return;
    }
    html += '<div class="mk-row"><div class="mk-col">';
    html += '<div class="mk-field"><label for="ck-name">' + esc(t('name')) + '</label><input class="mk-input" id="ck-name" required></div>';
    html += '<div class="mk-field"><label for="ck-email">' + esc(t('email')) + '</label><input class="mk-input" id="ck-email" type="email" required></div>';
    html += '<div class="mk-field"><label for="ck-phone">' + esc(t('phone')) + '</label><input class="mk-input" id="ck-phone"></div>';
    html += '<div class="mk-field"><label for="ck-addr">' + esc(t('shipping_address')) + '</label><input class="mk-input" id="ck-addr"></div>';
    html += '</div><div class="mk-col">';
    if (cfg && cfg.shippingZones && cfg.shippingZones.length) {
      html += '<div class="mk-field"><label for="ck-zone">' + esc(t('shipping_zone')) + '</label><select class="mk-select" id="ck-zone">' +
        cfg.shippingZones.map((z) => '<option value="' + esc(z.id) + '">' + esc(z.name) + ' — ' + esc(money(z.fee, cfg.currency)) + '</option>').join('') +
        '</select></div>';
    }
    if (cfg && cfg.paymentMethods && cfg.paymentMethods.length) {
      html += '<div class="mk-field"><label for="ck-pay">' + esc(t('payment_method')) + '</label><select class="mk-select" id="ck-pay">' +
        cfg.paymentMethods.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>').join('') +
        '</select></div>';
    }
    html += '<div class="mk-field"><label for="ck-coupon">' + esc(t('coupon')) + '</label><input class="mk-input" id="ck-coupon"></div>';
    html += '<div class="mk-summary"><div class="mk-summary-row"><span>' + esc(t('subtotal')) + '</span><span>' + esc(money(subtotal, cfg && cfg.currency)) + '</span></div>';
    html += '<div class="mk-summary-row"><span>' + esc(t('shipping_fee')) + '</span><span id="ck-ship">' + esc(money(0, cfg && cfg.currency)) + '</span></div>';
    html += '<div class="mk-summary-row total"><span>' + esc(t('total')) + '</span><span id="ck-total">' + esc(money(subtotal + fee, cfg && cfg.currency)) + '</span></div></div>';
    html += '<button class="mk-btn block" id="ck-place">' + esc(t('place_order')) + '</button>';
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

    ['ck-name', 'ck-email', 'ck-phone', 'ck-addr'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => clearFieldError(id));
    });

    const zoneInput = document.getElementById('ck-zone');
    const payInput = document.getElementById('ck-pay');
    if (zoneInput) zoneInput.addEventListener('change', () => clearFieldError('ck-zone'));
    if (payInput) payInput.addEventListener('change', () => clearFieldError('ck-pay'));

    document.getElementById('ck-place').addEventListener('click', async () => {
      clearAllFieldErrors('ck-');
      const msg = document.getElementById('ck-msg');
      msg.innerHTML = '';
      const name = document.getElementById('ck-name').value.trim();
      const email = document.getElementById('ck-email').value.trim();
      const phone = document.getElementById('ck-phone').value.trim();
      const addr = document.getElementById('ck-addr').value.trim();
      const zone = zoneInput ? zoneInput.value : '';
      const pay = payInput ? payInput.value : '';
      let valid = true;
      if (!name) { fieldError('ck-name', t('required_field')); valid = false; }
      if (!email) { fieldError('ck-email', t('required_field')); valid = false; }
      else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { fieldError('ck-email', t('invalid_email')); valid = false; }
      if (phone && !/^[0-9\s\-+()]{7,20}$/.test(phone)) { fieldError('ck-phone', t('invalid_phone')); valid = false; }
      if (!addr) { fieldError('ck-addr', t('required_field')); valid = false; }
      if (zoneInput && !zone) { fieldError('ck-zone', t('shipping_zone_required')); valid = false; }
      if (payInput && !pay) { fieldError('ck-pay', t('payment_method_required')); valid = false; }
      if (!valid) return;
      const payload = {
        items: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
        shippingZoneId: zoneSel ? zoneSel.value : undefined,
        paymentMethodId: (document.getElementById('ck-pay') || {}).value,
        couponCode: document.getElementById('ck-coupon').value.trim() || undefined,
        customerInfo: { name, email, phone: phone || undefined },
        shippingAddress: addr
      };
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
    html += '<div class="mk-field"><label for="tk-token">' + esc(t('track_token')) + '</label><input class="mk-input" id="tk-token" value="' + esc(token || '') + '"></div>';
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
      html += '<div class="mk-field"><label for="lg-email">' + esc(t('email')) + '</label><input class="mk-input" id="lg-email" required></div>';
      html += '<div class="mk-field"><label for="lg-pass">' + esc(t('password')) + '</label><input class="mk-input" id="lg-pass" type="password" required></div>';
      html += '<button class="mk-btn" id="lg-btn">' + esc(t('login')) + '</button></div>';
      html += '<div class="mk-col"><h2>' + esc(t('register_title')) + '</h2><div id="ac-reg-msg"></div>';
      html += '<div class="mk-field"><label for="rg-name">' + esc(t('name')) + '</label><input class="mk-input" id="rg-name" required></div>';
      html += '<div class="mk-field"><label for="rg-email">' + esc(t('email')) + '</label><input class="mk-input" id="rg-email" type="email" required></div>';
      html += '<div class="mk-field"><label for="rg-phone">' + esc(t('phone')) + '</label><input class="mk-input" id="rg-phone"></div>';
      html += '<div class="mk-field"><label for="rg-pass">' + esc(t('password_req')) + '</label><input class="mk-input" id="rg-pass" type="password" required></div>';
      html += '<button class="mk-btn" id="rg-btn">' + esc(t('register')) + '</button></div></div>';
      setApp(html);
      ['lg-email', 'lg-pass'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => clearFieldError(id));
      });
      document.getElementById('lg-btn').addEventListener('click', async () => {
        clearAllFieldErrors('lg-');
        const msg = document.getElementById('ac-login-msg');
        msg.innerHTML = '';
        const email = document.getElementById('lg-email').value.trim();
        const pass = document.getElementById('lg-pass').value;
        let valid = true;
        if (!email) { fieldError('lg-email', t('required_field')); valid = false; }
        if (!pass) { fieldError('lg-pass', t('required_field')); valid = false; }
        if (!valid) return;
        try {
          const r = await window.MK_API.login({ email, password: pass });
          window.MK_API.setToken(r.token);
          const dest = takeAuthDestination();
          if (dest) { location.hash = dest; } else { render(); }
        } catch (e) { msg.innerHTML = banner('error', e.message || t('error_generic')); }
      });
      ['rg-name', 'rg-email', 'rg-pass'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => clearFieldError(id));
      });
      document.getElementById('rg-btn').addEventListener('click', async () => {
        clearAllFieldErrors('rg-');
        const msg = document.getElementById('ac-reg-msg');
        msg.innerHTML = '';
        const name = document.getElementById('rg-name').value.trim();
        const email = document.getElementById('rg-email').value.trim();
        const pass = document.getElementById('rg-pass').value;
        let valid = true;
        if (!name) { fieldError('rg-name', t('required_field')); valid = false; }
        if (!email) { fieldError('rg-email', t('required_field')); valid = false; }
        if (!pass) { fieldError('rg-pass', t('required_field')); valid = false; }
        if (!valid) return;
        try {
          const r = await window.MK_API.register({ email, name, phone: document.getElementById('rg-phone').value.trim(), password: pass });
          window.MK_API.setToken(r.token);
          const dest = takeAuthDestination();
          if (dest) { location.hash = dest; } else { render(); }
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
      html += '<div class="mk-field"><label for="pf-name">' + esc(t('name')) + '</label><input class="mk-input" id="pf-name" value="' + esc(me.customer.name) + '"></div>';
      html += '<div class="mk-field"><label for="pf-phone">' + esc(t('phone')) + '</label><input class="mk-input" id="pf-phone" value="' + esc(me.customer.phone) + '"></div>';
      html += '<button class="mk-btn" id="pf-save">' + esc(t('update_profile')) + '</button> ';
      html += '<button class="mk-btn secondary" id="pf-chg">' + esc(t('change_password')) + '</button>';
      html += '<div id="ac-pw-form" style="display:none;margin-top:12px">';
      html += '<div class="mk-field"><label for="pf-cur">' + esc(t('current_password')) + '</label><input class="mk-input" id="pf-cur" type="password"></div>';
      html += '<div class="mk-field"><label for="pf-new">' + esc(t('new_password')) + '</label><input class="mk-input" id="pf-new" type="password"></div>';
      html += '<button class="mk-btn" id="pf-save-pw">' + esc(t('save')) + '</button> ';
      html += '<button class="mk-btn secondary" id="pf-cancel-pw">' + esc(t('cancel')) + '</button>';
      html += '</div>';
      html += '<div id="ac-pw-msg"></div>';
    }
    html += '<h2>' + esc(t('my_orders')) + '</h2>';
    if (!orders.orders || !orders.orders.length) {
      html += emptyState('package', t('no_orders'), null, '<a class="mk-btn" href="#/catalog">' + esc(t('empty_browse_catalog')) + '</a>');
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
    if (pfChg) {
      pfChg.addEventListener('click', () => {
        const pwForm = document.getElementById('ac-pw-form');
        if (pwForm) pwForm.style.display = pwForm.style.display === 'none' ? '' : 'none';
      });
    }
    const pfCancelPw = document.getElementById('pf-cancel-pw');
    if (pfCancelPw) {
      pfCancelPw.addEventListener('click', () => {
        const pwForm = document.getElementById('ac-pw-form');
        const msg = document.getElementById('ac-pw-msg');
        if (pwForm) pwForm.style.display = 'none';
        if (msg) msg.innerHTML = '';
        const cur = document.getElementById('pf-cur');
        const neu = document.getElementById('pf-new');
        if (cur) cur.value = '';
        if (neu) neu.value = '';
      });
    }
    const pfSavePw = document.getElementById('pf-save-pw');
    if (pfSavePw) {
      pfSavePw.addEventListener('click', async () => {
        const msg = document.getElementById('ac-pw-msg');
        msg.innerHTML = '';
        const cur = document.getElementById('pf-cur').value;
        const neu = document.getElementById('pf-new').value;
        if (!cur || !neu) { msg.innerHTML = banner('error', t('required_field')); return; }
        pfSavePw.disabled = true;
        try {
          const r = await window.MK_API.changePassword({ currentPassword: cur, newPassword: neu });
          window.MK_API.setToken(r.token);
          msg.innerHTML = banner('success', t('save'));
          const pwForm = document.getElementById('ac-pw-form');
          if (pwForm) pwForm.style.display = 'none';
          const curInput = document.getElementById('pf-cur');
          const neuInput = document.getElementById('pf-new');
          if (curInput) curInput.value = '';
          if (neuInput) neuInput.value = '';
        } catch (e) { msg.innerHTML = banner('error', e.message || t('error_generic')); }
        pfSavePw.disabled = false;
      });
    }
  }

  // ---------- Game Hosting ----------

  function ghBanner(type, msg) {
    return '<div class="mk-banner ' + type + '">' + esc(msg) + '</div>';
  }

  function ghLocalizedError(err) {
    const msg = err && err.message ? err.message : '';
    if (msg.indexOf('No active entitlement') !== -1) return t('gh_entitlement_required');
    return msg;
  }

  function ghStatusLabel(s) {
    const map = {
      pending: t('gh_status_pending'),
      provisioning: t('gh_status_provisioning'),
      running: t('gh_status_running'),
      stopped: t('gh_status_stopped'),
      terminated: t('gh_status_terminated'),
      error: t('gh_status_error'),
      blocked: t('gh_status_blocked')
    };
    const label = (map[s] || t('gh_unknown_status')) + ' (' + esc(s) + ')';
    const cls = s === 'running' ? 'success' : s === 'error' || s === 'terminated' ? 'error' : s === 'pending' || s === 'provisioning' ? 'warning' : s === 'blocked' ? 'danger' : 'neutral';
    return '<span class="mk-badge ' + cls + '">' + esc(label) + '</span>';
  }

  async function pageGameHosting() {
    setApp('<div class="mk-loading">' + esc(t('loading')) + '</div><h1 class="mk-page-title">' + esc(t('gh_hero_title')) + '</h1><p class="mk-page-sub">' + esc(t('gh_hero_sub')) + '</p><h2>' + esc(t('gh_plans')) + '</h2><div id="mk-gh-plans">' + skeletonGameGrid(4) + '</div>');
    let provider = null;
    try { provider = await window.MK_API.ghProviderStatus().catch(() => null); } catch (_) {}
    let plans = [];
    try { const r = await window.MK_API.ghPlans(); plans = (r && r.plans) || []; } catch (_) {}

    let html = '<h1 class="mk-page-title">' + esc(t('gh_hero_title')) + '</h1>';
    html += '<p class="mk-page-sub">' + esc(t('gh_hero_sub')) + '</p>';
    if (provider && provider.status === 'BLOCKED') {
      html += ghBanner('error', esc(t('gh_provider_blocked')));
    }
    html += '<h2>' + esc(t('gh_plans')) + '</h2>';
    if (!plans.length) {
      html += emptyState('gamepad', t('gh_no_plans'), null, '<a class="mk-btn" href="#/operator">' + esc(t('op_back_to_dashboard')) + '</a>');
    } else {
      html += '<div class="mk-grid" id="mk-gh-plans">';
      plans.forEach((p) => {
        html += '<div class="mk-card">' +
          '<div class="mk-card-body">' +
            '<div class="mk-card-name">' + esc(p.name) + '</div>' +
            '<div class="mk-card-price">' + esc(money(p.pricePerMonth)) + ' <small>/ ' + esc(t('gh_billing_period')) + '</small></div>' +
            '<div class="mk-card-stock">' + esc(t('gh_game_title')) + ': ' + esc(p.gameTitle) + '</div>' +
            '<div class="mk-card-stock">' + esc(t('gh_max_players')) + ': ' + esc(p.maxPlayers) + '</div>' +
            (p.region ? '<div class="mk-card-stock">' + esc(t('gh_region')) + ': ' + esc(p.region) + '</div>' : '') +
            '<a class="mk-btn" href="#/game-hosting/provision?planId=' + encodeURIComponent(p.id) + '">' + esc(t('gh_provision')) + '</a>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    }
    setApp(html);
  }

  async function pageGameHostingProvision() {
    if (!window.MK_API.isAuthed()) {
      storeAuthDestination();
      location.hash = '#/account';
      return;
    }
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const planId = params.get('planId') || '';
    if (!planId) { location.hash = '#/game-hosting'; return; }

    setApp('<div class="mk-loading">' + esc(t('loading')) + '</div>');
    let plan = null;
    try { plan = await window.MK_API.ghPlan(planId).catch(() => null); } catch (_) {}
    if (!plan) { setApp('<h1 class="mk-page-title">' + esc(t('product_not_found')) + '</h1><p><a href="#/game-hosting">' + esc(t('gh_back_to_plans')) + '</a></p>'); return; }

    let html = breadcrumb([{label: t('gh_title'), href: '#/game-hosting'}, {label: plan.name}]);
    html += '<h1 class="mk-page-title">' + esc(t('gh_provision_title')) + '</h1>';
    html += '<div class="mk-order-card">';
    html += '<div class="mk-summary-title">' + esc(t('gh_provision_summary_title')) + '</div>';
    html += '<div class="mk-summary-row"><span>' + esc(t('gh_plan_name')) + '</span><span>' + esc(plan.name) + '</span></div>';
    html += '<div class="mk-summary-row"><span>' + esc(t('gh_game_title')) + '</span><span>' + esc(plan.gameTitle) + '</span></div>';
    html += '<div class="mk-summary-row"><span>' + esc(t('gh_price_month')) + '</span><span>' + esc(money(plan.pricePerMonth)) + '</span></div>';
    html += '</div>';
    html += '<h2>' + esc(t('gh_provision_title')) + '</h2>';
    html += '<div class="mk-row"><div class="mk-col">';
    html += '<div class="mk-field"><label for="gh-srv-name">' + esc(t('gh_provision_server_name')) + '</label><input class="mk-input" id="gh-srv-name" required></div>';
    html += '<div class="mk-field"><label for="gh-srv-region">' + esc(t('gh_provision_region')) + '</label><input class="mk-input" id="gh-srv-region" value="' + esc(plan.region || '') + '"></div>';
    html += '<button class="mk-btn" id="gh-do-provision">' + esc(t('gh_provision_submit')) + '</button>';
    html += '<div id="gh-provision-msg"></div>';
    html += '</div></div>';
    html += '<p><a href="#/game-hosting">' + esc(t('gh_provision_back')) + '</a></p>';
    setApp(html);

    const btn = document.getElementById('gh-do-provision');
    if (btn) {
      const serverNameInput = document.getElementById('gh-srv-name');
      if (serverNameInput) serverNameInput.addEventListener('input', () => clearFieldError('gh-srv-name'));
      btn.addEventListener('click', async () => {
        clearAllFieldErrors('gh-');
        const msg = document.getElementById('gh-provision-msg');
        msg.innerHTML = '';
        const serverName = document.getElementById('gh-srv-name').value.trim();
        const region = document.getElementById('gh-srv-region').value.trim();
        if (!serverName) { fieldError('gh-srv-name', t('gh_required_field')); return; }
        btn.disabled = true; btn.textContent = t('please_wait');
        try {
          const res = await window.MK_API.ghCreateProvisioningRequest({ planId: plan.id, serverName, region });
          const prov = (res && res.provider) || null;
          let out = ghBanner('success', esc(t('gh_create_success')));
          if (prov && prov.status === 'BLOCKED') {
            out += ghBanner('error', esc(t('gh_provisioning_requested')));
          }
          msg.innerHTML = out;
          btn.disabled = false; btn.textContent = t('gh_provision_submit');
        } catch (e) {
          msg.innerHTML = ghBanner('error', esc(ghLocalizedError(e) || t('gh_create_failed')));
          btn.disabled = false; btn.textContent = t('gh_provision_submit');
        }
      });
    }
  }

  async function pageGameHostingMyServers() {
    if (!window.MK_API.isAuthed()) {
      storeAuthDestination();
      setApp('<h1 class="mk-page-title">' + esc(t('gh_my_servers')) + '</h1>' + ghBanner('error', esc(t('gh_auth_required')) + ' <a href="#/account">' + esc(t('or_login')) + '</a>') + '<p><button class="mk-btn secondary" id="mk-gh-retry">' + esc(t('gh_retry')) + '</button></p>'));
      const retryBtn = document.getElementById('mk-gh-retry');
      if (retryBtn) retryBtn.addEventListener('click', () => { location.hash = '#/account'; });
      return;
    }
    setApp('<h1 class="mk-page-title">' + esc(t('gh_my_servers')) + '</h1><p><a class="mk-btn secondary" href="#/game-hosting">' + esc(t('gh_back_to_plans')) + '</a></p><div id="mk-gh-servers">' + skeletonGameGrid(3) + '</div>');
    let servers = [];
    try { const r = await window.MK_API.ghServers(); servers = (r && r.servers) || []; } catch (_) {}

    let html = '<h1 class="mk-page-title">' + esc(t('gh_my_servers')) + '</h1>';
    html += '<p><a class="mk-btn secondary" href="#/game-hosting">' + esc(t('gh_back_to_plans')) + '</a></p>';
    if (!servers.length) {
      html += '<div class="mk-empty"><div class="mk-empty-title">' + esc(t('gh_empty_servers_title')) + '</div><div class="mk-empty-sub">' + esc(t('gh_empty_servers_sub')) + '</div><a class="mk-btn" href="#/game-hosting">' + esc(t('gh_empty_servers_cta')) + '</a></div>';
    } else {
      html += '<div class="mk-grid">';
      servers.forEach((s) => {
        html += '<div class="mk-card">' +
          '<div class="mk-card-body">' +
            '<div class="mk-card-name">' + esc(s.serverName) + '</div>' +
            '<div class="mk-card-stock">' + esc(t('gh_status')) + ': ' + ghStatusLabel(s.status) + '</div>' +
            (s.region ? '<div class="mk-card-stock">' + esc(t('gh_region')) + ': ' + esc(s.region) + '</div>' : '') +
            '<a class="mk-btn" href="#/game-hosting/servers/' + encodeURIComponent(s.id) + '">' + esc(t('gh_server_details')) + '</a>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    }
    setApp(html);
  }

  async function pageGameHostingServer(id) {
    if (!window.MK_API.isAuthed()) {
      storeAuthDestination();
      location.hash = '#/account';
      return;
    }
    setApp('<div class="mk-loading">' + esc(t('loading')) + '</div>');
    let server = null;
    try { server = await window.MK_API.ghServer(id).catch(() => null); } catch (_) {}
    if (!server) { setApp('<h1 class="mk-page-title">' + esc(t('gh_server_details')) + '</h1><div class="mk-empty">' + esc(t('gh_server_not_found')) + '</div><p><a href="#/game-hosting/my-servers">' + esc(t('gh_back_to_servers')) + '</a></p>'); return; }

    let html = breadcrumb([{label: t('gh_title'), href: '#/game-hosting'}, {label: t('gh_my_servers'), href: '#/game-hosting/my-servers'}, {label: server.serverName}]);
    html += '<h1 class="mk-page-title">' + esc(server.serverName) + '</h1>';
    html += '<div class="mk-row"><div class="mk-col">';
    html += '<div class="mk-order-card">';
    html += '<div class="mk-summary-title">' + esc(t('gh_details_section_identity')) + '</div>';
    html += '<div class="mk-summary-row"><span>' + esc(t('gh_plan_name')) + '</span><span>' + esc(server.planId) + '</span></div>';
    html += '<div class="mk-summary-row"><span>' + esc(t('gh_region')) + '</span><span>' + esc(server.region || '-') + '</span></div>';
    html += '<div class="mk-summary-row"><span>' + esc(t('gh_details_label_owner')) + '</span><span>' + esc(server.ownerId || '-') + '</span></div>';
    html += '<div class="mk-summary-row"><span>' + esc(t('gh_details_label_updated')) + '</span><span>' + esc(server.updatedAt ? new Date(server.updatedAt).toLocaleString() : '-') + '</span></div>';
    html += '</div>';
    html += '<div class="mk-order-card" style="margin-top:12px">';
    html += '<div class="mk-summary-title">' + esc(t('gh_details_section_status')) + '</div>';
    html += '<div class="mk-summary-row"><span>' + esc(t('gh_status')) + '</span><span>' + ghStatusLabel(server.status) + '</span></div>';
    html += '</div>';
    html += '<div class="mk-summary" style="margin-top:12px"><div class="mk-summary-row"><span>' + esc(t('gh_details_section_lifecycle')) + '</span><span id="gh-lifecycle-btns"></span></div></div>';
    html += '<div id="gh-server-msg" style="margin-top:12px"></div>';
    html += '</div><div class="mk-col">';
    html += '<div class="mk-order-card">';
    html += '<div class="mk-field" style="max-width:360px"><label for="gh-edit-name">' + esc(t('gh_server_name')) + '</label><input class="mk-input" id="gh-edit-name" value="' + esc(server.serverName) + '"></div>';
    html += '<div class="mk-field" style="max-width:360px"><label for="gh-edit-region">' + esc(t('gh_region')) + '</label><input class="mk-input" id="gh-edit-region" value="' + esc(server.region || '') + '"></div>';
    html += '<button class="mk-btn" id="gh-save">' + esc(t('save')) + '</button>';
    html += '<button class="mk-btn danger" id="gh-del">' + esc(t('remove')) + '</button>';
    html += '<div id="gh-edit-msg"></div>';
    html += '<div class="mk-summary-title" style="margin-top:16px">' + esc(t('gh_details_section_danger')) + '</div>';
    html += '<p style="color:var(--mk-muted)">' + esc(t('gh_delete_confirm')) + '</p>';
    html += '</div>';
    html += '</div></div>';
    setApp(html);

    const actions = document.getElementById('gh-lifecycle-btns');
    const currentStatus = server.status;
    if (currentStatus === 'running') {
      actions.innerHTML = '<button class="mk-btn" id="gh-btn-stop">' + esc(t('gh_lifecycle_stop')) + '</button> ' +
        '<button class="mk-btn danger" id="gh-btn-term">' + esc(t('gh_lifecycle_terminate')) + '</button>';
    } else if (currentStatus === 'stopped') {
      actions.innerHTML = '<button class="mk-btn" id="gh-btn-start">' + esc(t('gh_lifecycle_start')) + '</button> ' +
        '<button class="mk-btn danger" id="gh-btn-term">' + esc(t('gh_lifecycle_terminate')) + '</button>';
    } else if (currentStatus === 'pending' || currentStatus === 'provisioning' || currentStatus === 'error') {
      actions.innerHTML = '<button class="mk-btn danger" id="gh-btn-term">' + esc(t('gh_lifecycle_terminate')) + '</button>';
    }

    const bind = (elId, fn) => { const el = document.getElementById(elId); if (el) el.addEventListener('click', fn); };
    const msgEl = document.getElementById('gh-server-msg');

    bind('gh-btn-stop', async () => {
      msgEl.innerHTML = '';
      try { await window.MK_API.ghStopServer(id); render(); }
      catch (e) { msgEl.innerHTML = ghBanner('error', esc(e.message || t('gh_action_failed'))); }
    });
    bind('gh-btn-start', async () => {
      msgEl.innerHTML = '';
      try { await window.MK_API.ghStartServer(id); render(); }
      catch (e) { msgEl.innerHTML = ghBanner('error', esc(e.message || t('gh_action_failed'))); }
    });
    bind('gh-btn-term', async () => {
      if (!await confirmDialog(t('gh_delete_confirm'))) return;
      msgEl.innerHTML = '';
      try { await window.MK_API.ghTerminateServer(id); render(); }
      catch (e) { msgEl.innerHTML = ghBanner('error', esc(e.message || t('gh_action_failed'))); }
    });

    document.getElementById('gh-save').addEventListener('click', async () => {
      const msg = document.getElementById('gh-edit-msg');
      msg.innerHTML = '';
      const name = document.getElementById('gh-edit-name').value.trim();
      const region = document.getElementById('gh-edit-region').value.trim();
      if (!name) { msg.innerHTML = ghBanner('error', t('gh_required_field')); return; }
      try {
        await window.MK_API.ghUpdateServer(id, { serverName: name, region });
        msg.innerHTML = ghBanner('success', t('gh_update_success'));
      } catch (e) {
        msg.innerHTML = ghBanner('error', esc(e.message || t('gh_update_failed')));
      }
    });
    document.getElementById('gh-del').addEventListener('click', async () => {
      if (!await confirmDialog(t('gh_delete_confirm'))) return;
      const msg = document.getElementById('gh-edit-msg');
      msg.innerHTML = '';
      try {
        await window.MK_API.ghDeleteServer(id);
        location.hash = '#/game-hosting/my-servers';
      } catch (e) {
        msg.innerHTML = ghBanner('error', esc(e.message || t('gh_delete_failed')));
      }
    });
  }

  async function pageGameHostingRequests() {
    if (!window.MK_API.isAuthed()) {
      storeAuthDestination();
      setApp('<h1 class="mk-page-title">' + esc(t('gh_requests_title')) + '</h1>' + ghBanner('error', esc(t('gh_auth_required')) + ' <a href="#/account">' + esc(t('or_login')) + '</a>') + '<p><button class="mk-btn secondary" id="mk-gh-retry">' + esc(t('gh_retry')) + '</button></p>'));
      const retryBtn = document.getElementById('mk-gh-retry');
      if (retryBtn) retryBtn.addEventListener('click', () => { location.hash = '#/account'; });
      return;
    }
    setApp('<h1 class="mk-page-title">' + esc(t('gh_requests_title')) + '</h1><p><a class="mk-btn secondary" href="#/game-hosting">' + esc(t('gh_back_to_plans')) + '</a></p><div id="mk-gh-reqs">' + skeletonGameGrid(3) + '</div>');
    let requests = [];
    try { const r = await window.MK_API.ghProvisioningRequests(); requests = (r && r.requests) || []; } catch (_) {}

    let html = '<h1 class="mk-page-title">' + esc(t('gh_requests_title')) + '</h1>';
    html += '<p><a class="mk-btn secondary" href="#/game-hosting">' + esc(t('gh_back_to_plans')) + '</a></p>';
    if (!requests.length) {
      html += '<div class="mk-empty"><div class="mk-empty-title">' + esc(t('gh_empty_requests_title')) + '</div><div class="mk-empty-sub">' + esc(t('gh_empty_requests_sub')) + '</div><a class="mk-btn" href="#/game-hosting">' + esc(t('gh_empty_requests_cta')) + '</a></div>';
    } else {
      html += '<div class="mk-grid">';
      requests.forEach((req) => {
        html += '<div class="mk-card">' +
          '<div class="mk-card-body">' +
            '<div class="mk-card-name">' + esc(req.planId) + '</div>' +
            '<div class="mk-card-stock">' + esc(t('gh_request_status')) + ': ' + ghStatusLabel(req.status) + '</div>' +
            (req.requestedRegion ? '<div class="mk-card-stock">' + esc(t('gh_request_region')) + ': ' + esc(req.requestedRegion) + '</div>' : '') +
            '<div class="mk-card-stock">' + esc(t('gh_request_created')) + ': ' + esc(req.createdAt ? new Date(req.createdAt).toLocaleString() : '-') + '</div>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    }
    setApp(html);
  }

  // Operator pages (requires operator role)

  function opBanner(type, msg) {
    return '<div class="mk-banner ' + type + '">' + esc(msg) + '</div>';
  }

  async function pageOperatorPlans() {
    if (!window.MK_API.isOperator()) {
      setApp('<h1 class="mk-page-title">' + esc(t('op_plans')) + '</h1>' + opBanner('error', esc(t('gh_auth_required'))));
      return;
    }
    setApp('<h1 class="mk-page-title">' + esc(t('op_plans')) + '</h1><p><a class="mk-btn secondary" href="#/operator">' + esc(t('op_back_to_dashboard')) + '</a></p><button class="mk-btn" id="op-plan-create-btn">' + esc(t('op_plan_create')) + '</button><div id="op-plans">' + skeletonGameGrid(3) + '</div>');
    let plans = [];
    try { const r = await window.MK_API.ghPlans(); plans = (r && r.plans) || []; } catch (_) {}

    let html = '<h1 class="mk-page-title">' + esc(t('op_plans')) + '</h1>';
    html += '<p><a class="mk-btn secondary" href="#/operator">' + esc(t('op_back_to_dashboard')) + '</a></p>';
    html += '<button class="mk-btn" id="op-plan-create-btn">' + esc(t('op_plan_create')) + '</button>';
    html += '<div id="op-plan-form" style="display:none; margin-top:16px;">';
    html += '<div class="mk-order-card">';
    html += '<div class="mk-summary-title" id="op-plan-form-title">' + esc(t('op_plan_form_title')) + '</div>';
    html += '<div class="mk-field"><label for="op-plan-name">' + esc(t('op_plan_form_name')) + '</label><input class="mk-input" id="op-plan-name" required></div>';
    html += '<div class="mk-field"><label for="op-plan-game">' + esc(t('op_plan_form_game')) + '</label><input class="mk-input" id="op-plan-game" required></div>';
    html += '<div class="mk-field"><label for="op-plan-players">' + esc(t('op_plan_form_players')) + '</label><input class="mk-input" id="op-plan-players" type="number"></div>';
    html += '<div class="mk-field"><label for="op-plan-price">' + esc(t('op_plan_form_price')) + '</label><input class="mk-input" id="op-plan-price" type="number" step="0.01"></div>';
    html += '<div class="mk-field"><label for="op-plan-region">' + esc(t('op_plan_form_region')) + '</label><input class="mk-input" id="op-plan-region"></div>';
    html += '<div class="mk-field"><label for="op-plan-status">' + esc(t('op_plan_form_status')) + '</label><select class="mk-select" id="op-plan-status"><option value="draft">' + esc(t('op_plan_status_draft')) + '</option><option value="active">' + esc(t('op_plan_status_active')) + '</option><option value="archived">' + esc(t('op_plan_status_archived')) + '</option></select></div>';
    html += '<button class="mk-btn" id="op-plan-save">' + esc(t('op_plan_save')) + '</button>';
    html += '<button class="mk-btn secondary" id="op-plan-cancel">' + esc(t('op_plan_cancel')) + '</button>';
    html += '<div id="op-plan-msg" style="margin-top:12px"></div>';
    html += '</div></div>';
    html += '<div class="mk-grid" style="margin-top:16px">';
    plans.forEach((p) => {
      html += '<div class="mk-card">' +
        '<div class="mk-card-body">' +
          '<div class="mk-card-name">' + esc(p.name) + '</div>' +
          '<div class="mk-card-stock">' + esc(t('gh_game_title')) + ': ' + esc(p.gameTitle) + '</div>' +
          '<div class="mk-card-stock">' + esc(t('gh_max_players')) + ': ' + esc(p.maxPlayers) + '</div>' +
          '<div class="mk-card-stock">' + esc(t('gh_price_month')) + ': ' + esc(money(p.pricePerMonth)) + '</div>' +
          '<div class="mk-card-stock">' + esc(t('gh_region')) + ': ' + esc(p.region || '-') + '</div>' +
          '<div class="mk-card-stock">' + esc(t('op_plan_status')) + ': ' + esc(p.status || '-') + '</div>' +
          '<div class="mk-card-actions">' +
            '<button class="mk-btn" id="op-plan-edit-' + esc(p.id) + '">' + esc(t('op_plan_edit')) + '</button>' +
            '<button class="mk-btn danger" id="op-plan-archive-' + esc(p.id) + '">' + esc(t('op_plan_archive')) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
    setApp(html);

    let editingPlanId = null;
    const form = document.getElementById('op-plan-form');
    const formTitle = document.getElementById('op-plan-form-title');
    const nameInput = document.getElementById('op-plan-name');
    const gameInput = document.getElementById('op-plan-game');
    const playersInput = document.getElementById('op-plan-players');
    const priceInput = document.getElementById('op-plan-price');
    const regionInput = document.getElementById('op-plan-region');
    const statusInput = document.getElementById('op-plan-status');
    const msgEl = document.getElementById('op-plan-msg');

    const showForm = (show) => { if (form) form.style.display = show ? '' : 'none'; };
    const resetForm = () => {
      editingPlanId = null;
      if (nameInput) nameInput.value = '';
      if (gameInput) gameInput.value = '';
      if (playersInput) playersInput.value = '';
      if (priceInput) priceInput.value = '';
      if (regionInput) regionInput.value = '';
      if (statusInput) statusInput.value = 'draft';
      if (formTitle) formTitle.textContent = t('op_plan_form_title');
    };

    const createBtn = document.getElementById('op-plan-create-btn');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        resetForm();
        if (formTitle) formTitle.textContent = t('op_plan_create');
        showForm(true);
      });
    }

    const cancelBtn = document.getElementById('op-plan-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => { showForm(false); resetForm(); });
    }

    const saveBtn = document.getElementById('op-plan-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        if (msgEl) msgEl.innerHTML = '';
        const name = nameInput ? nameInput.value.trim() : '';
        const gameTitle = gameInput ? gameInput.value.trim() : '';
        const maxPlayers = playersInput ? parseInt(playersInput.value, 10) : null;
        const pricePerMonth = priceInput ? parseFloat(priceInput.value) : null;
        const region = regionInput ? regionInput.value.trim() : '';
        const status = statusInput ? statusInput.value : 'draft';
        if (!name) { if (msgEl) msgEl.innerHTML = opBanner('error', t('required_field')); return; }
        saveBtn.disabled = true;
        try {
          if (editingPlanId) {
            await window.MK_API.ghUpdatePlan(editingPlanId, { name, gameTitle, maxPlayers, pricePerMonth, region, status });
            if (msgEl) msgEl.innerHTML = opBanner('success', t('op_plan_updated'));
          } else {
            await window.MK_API.ghCreatePlan({ name, gameTitle, maxPlayers, pricePerMonth, region, status });
            if (msgEl) msgEl.innerHTML = opBanner('success', t('op_plan_created'));
          }
          resetForm();
          showForm(false);
          render();
        } catch (e) {
          if (msgEl) msgEl.innerHTML = opBanner('error', esc(e.message || 'Failed'));
          saveBtn.disabled = false;
        }
      });
    }

    plans.forEach((p) => {
      const editBtn = document.getElementById('op-plan-edit-' + p.id);
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          editingPlanId = p.id;
          if (formTitle) formTitle.textContent = t('op_plan_edit');
          if (nameInput) nameInput.value = p.name || '';
          if (gameInput) gameInput.value = p.gameTitle || '';
          if (playersInput) playersInput.value = p.maxPlayers || '';
          if (priceInput) priceInput.value = p.pricePerMonth || '';
          if (regionInput) regionInput.value = p.region || '';
          if (statusInput) statusInput.value = p.status || 'draft';
          showForm(true);
        });
      }
      const archiveBtn = document.getElementById('op-plan-archive-' + p.id);
      if (archiveBtn) {
        archiveBtn.addEventListener('click', async () => {
          archiveBtn.disabled = true;
          if (!await confirmDialog(t('op_plan_archive'))) { archiveBtn.disabled = false; return; }
          try {
            await window.MK_API.ghArchivePlan(p.id);
            render();
          } catch (e) {
            archiveBtn.disabled = false;
          }
        });
      }
    });
  }

  async function pageOperatorServers() {
    if (!window.MK_API.isOperator()) {
      setApp('<h1 class="mk-page-title">' + esc(t('op_servers')) + '</h1>' + opBanner('error', esc(t('gh_auth_required'))));
      return;
    }
    setApp('<h1 class="mk-page-title">' + esc(t('op_servers')) + '</h1><p><a class="mk-btn secondary" href="#/operator">' + esc(t('op_back_to_dashboard')) + '</a></p><div class="mk-op-chart-wrap"><div id="op-server-chart" style="width:100%;max-width:420px;height:320px;"></div></div><div id="mk-op-servers">' + skeletonGameGrid(3) + '</div>');
    let servers = [];
    try { const r = await window.MK_API.ghServers(); servers = (r && r.servers) || []; } catch (_) {}

    let html = '<h1 class="mk-page-title">' + esc(t('op_servers')) + '</h1>';
    html += '<p><a class="mk-btn secondary" href="#/operator">' + esc(t('op_back_to_dashboard')) + '</a></p>';
    html += '<div class="mk-op-chart-wrap"><div id="op-server-chart" style="width:100%;max-width:420px;height:320px;"></div></div>';
    if (!servers.length) {
      html += emptyState('server', t('gh_empty_servers_title'), t('gh_empty_servers_sub'), '<a class="mk-btn" href="#/game-hosting">' + esc(t('gh_empty_servers_cta')) + '</a>');
    } else {
      html += '<div class="mk-op-table-wrap"><table class="mk-op-table"><thead><tr><th>' + esc(t('op_server_name')) + '</th><th>' + esc(t('op_server_customer')) + '</th><th>' + esc(t('op_server_plan')) + '</th><th>' + esc(t('op_server_region')) + '</th><th>' + esc(t('op_server_status')) + '</th></tr></thead><tbody>';
      servers.forEach((s) => {
        html += '<tr>' +
          '<td data-label="' + esc(t('op_server_name')) + '">' + esc(s.serverName) + '</td>' +
          '<td data-label="' + esc(t('op_server_customer')) + '">' + esc(s.customerId || '-') + '</td>' +
          '<td data-label="' + esc(t('op_server_plan')) + '">' + esc(s.planId) + '</td>' +
          '<td data-label="' + esc(t('op_server_region')) + '">' + esc(s.region || '-') + '</td>' +
          '<td data-label="' + esc(t('op_server_status')) + '">' + ghStatusLabel(s.status) + '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
    }
    setApp(html);

    if (window.echarts && servers.length) {
      const counts = {};
      servers.forEach((s) => { const k = String(s.status || 'unknown'); counts[k] = (counts[k] || 0) + 1; });
      const chart = echarts.init(document.getElementById('op-server-chart'));
      chart.setOption({
        color: ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#6b7280', '#1d4ed8'],
        tooltip: {
          trigger: 'item',
          backgroundColor: '#fff',
          borderColor: '#e5e7eb',
          borderWidth: 1,
          borderRadius: 8,
          padding: [10, 12],
          textStyle: { color: '#1f2937', fontSize: 13, fontFamily: 'system-ui, -apple-system, "Segoe UI", Tahoma, "Noto Sans Arabic", sans-serif' }
        },
        legend: { bottom: 0, textStyle: { color: '#6b7280', fontSize: 13, fontFamily: 'system-ui, -apple-system, "Segoe UI", Tahoma, "Noto Sans Arabic", sans-serif' } },
        series: [{
          type: 'pie',
          radius: ['40%', '70%'],
          data: Object.keys(counts).map((k) => ({ name: k, value: counts[k] })),
          itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
          label: { color: '#1f2937', fontSize: 13, fontFamily: 'system-ui, -apple-system, "Segoe UI", Tahoma, "Noto Sans Arabic", sans-serif' }
        }]
      });
      const ro = new ResizeObserver(() => chart.resize());
      ro.observe(document.getElementById('op-server-chart'));
    }
  }

  async function pageOperatorQueue() {
    if (!window.MK_API.isOperator()) {
      setApp('<h1 class="mk-page-title">' + esc(t('op_queue')) + '</h1>' + opBanner('error', esc(t('gh_auth_required'))));
      return;
    }
    setApp('<h1 class="mk-page-title">' + esc(t('op_queue')) + '</h1><p><a class="mk-btn secondary" href="#/operator">' + esc(t('op_back_to_dashboard')) + '</a></p><div id="mk-op-queue">' + skeletonGameGrid(3) + '</div>');
    let requests = [];
    try { const r = await window.MK_API.ghProvisioningRequests(); requests = (r && r.requests) || []; } catch (_) {}

    let html = '<h1 class="mk-page-title">' + esc(t('op_queue')) + '</h1>';
    html += '<p><a class="mk-btn secondary" href="#/operator">' + esc(t('op_back_to_dashboard')) + '</a></p>';
    if (!requests.length) {
      html += emptyState('clock', t('gh_empty_requests_title'), t('gh_empty_requests_sub'), '<a class="mk-btn" href="#/game-hosting">' + esc(t('gh_empty_requests_cta')) + '</a>');
    } else {
      html += '<div class="mk-op-table-wrap"><table class="mk-op-table"><thead><tr><th>' + esc(t('op_request_id')) + '</th><th>' + esc(t('op_request_customer')) + '</th><th>' + esc(t('op_request_plan')) + '</th><th>' + esc(t('op_request_region')) + '</th><th>' + esc(t('op_request_status')) + '</th><th>' + esc(t('op_request_actions')) + '</th></tr></thead><tbody>';
      requests.forEach((req) => {
        html += '<tr>' +
          '<td data-label="' + esc(t('op_request_id')) + '">' + esc(req.id) + '</td>' +
          '<td data-label="' + esc(t('op_request_customer')) + '">' + esc(req.customerId || '-') + '</td>' +
          '<td data-label="' + esc(t('op_request_plan')) + '">' + esc(req.planId) + '</td>' +
          '<td data-label="' + esc(t('op_request_region')) + '">' + esc(req.requestedRegion || '-') + '</td>' +
          '<td data-label="' + esc(t('op_request_status')) + '">' + ghStatusLabel(req.status) + '</td>' +
          '<td data-label="' + esc(t('op_request_actions')) + '">' +
            (req.status === 'pending' ? '<button class="mk-btn" id="gh-approve-' + esc(req.id) + '">' + esc(t('op_approve')) + '</button> <button class="mk-btn danger" id="gh-reject-' + esc(req.id) + '">' + esc(t('op_reject')) + '</button>' : '-') +
          '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
    }
    setApp(html);

    requests.forEach((req) => {
      if (req.status !== 'pending') return;
      const approveBtn = document.getElementById('gh-approve-' + req.id);
      const rejectBtn = document.getElementById('gh-reject-' + req.id);
      if (approveBtn) {
        approveBtn.addEventListener('click', async () => {
          approveBtn.disabled = true;
          if (!await confirmDialog(t('op_approve_confirm'))) { approveBtn.disabled = false; return; }
          try { await window.MK_API.ghApproveProvisioningRequest(req.id); render(); }
          catch (e) { approveBtn.disabled = false; }
        });
      }
      if (rejectBtn) {
        rejectBtn.addEventListener('click', async () => {
          rejectBtn.disabled = true;
          if (!await confirmDialog(t('op_reject_confirm'))) { rejectBtn.disabled = false; return; }
          try { await window.MK_API.ghRejectProvisioningRequest(req.id); render(); }
          catch (e) { rejectBtn.disabled = false; }
        });
      }
    });
  }

  async function pageOperatorEntitlements() {
    if (!window.MK_API.isOperator()) {
      setApp('<h1 class="mk-page-title">' + esc(t('op_entitlements')) + '</h1>' + opBanner('error', esc(t('gh_auth_required'))));
      return;
    }
    setApp('<h1 class="mk-page-title">' + esc(t('op_entitlements')) + '</h1><p><a class="mk-btn secondary" href="#/operator">' + esc(t('op_back_to_dashboard')) + '</a></p><button class="mk-btn" id="op-entitlement-create-btn">' + esc(t('op_plan_create')) + '</button><div id="mk-op-entitlements">' + skeletonGameGrid(3) + '</div>');
    let entitlements = [];
    try { const r = await window.MK_API.ghEntitlements(); entitlements = (r && r.entitlements) || []; } catch (_) {}
    let plans = [];
    try { const r = await window.MK_API.ghPlans(); plans = (r && r.plans) || []; } catch (_) {}

    let html = '<h1 class="mk-page-title">' + esc(t('op_entitlements')) + '</h1>';
    html += '<p><a class="mk-btn secondary" href="#/operator">' + esc(t('op_back_to_dashboard')) + '</a></p>';
    html += '<button class="mk-btn" id="op-entitlement-create-btn">' + esc(t('op_plan_create')) + '</button>';
    html += '<div id="op-entitlement-form" style="display:none; margin-top:16px;">';
    html += '<div class="mk-order-card">';
    html += '<div class="mk-summary-title" id="op-entitlement-form-title">' + esc(t('op_entitlement_form_title')) + '</div>';
    html += '<div class="mk-field"><label for="op-entitlement-customer">' + esc(t('op_entitlement_form_customer')) + '</label><input class="mk-input" id="op-entitlement-customer"></div>';
    html += '<div class="mk-field"><label for="op-entitlement-plan">' + esc(t('op_entitlement_form_plan')) + '</label><select class="mk-select" id="op-entitlement-plan">';
    plans.forEach((p) => { html += '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; });
    html += '</select></div>';
    html += '<div class="mk-field"><label for="op-entitlement-status">' + esc(t('op_entitlement_form_status')) + '</label><select class="mk-select" id="op-entitlement-status"><option value="active">' + esc(t('op_entitlement_status_active')) + '</option><option value="expired">' + esc(t('op_entitlement_status_expired')) + '</option><option value="cancelled">' + esc(t('op_entitlement_status_cancelled')) + '</option></select></div>';
    html += '<div class="mk-field"><label for="op-entitlement-starts">' + esc(t('op_entitlement_form_starts')) + '</label><input class="mk-input" id="op-entitlement-starts" type="datetime-local"></div>';
    html += '<div class="mk-field"><label for="op-entitlement-expires">' + esc(t('op_entitlement_form_expires')) + '</label><input class="mk-input" id="op-entitlement-expires" type="datetime-local"></div>';
    html += '<button class="mk-btn" id="op-entitlement-save">' + esc(t('op_entitlement_save')) + '</button>';
    html += '<button class="mk-btn secondary" id="op-entitlement-cancel">' + esc(t('op_entitlement_cancel')) + '</button>';
    html += '<div id="op-entitlement-msg" style="margin-top:12px"></div>';
    html += '</div></div>';
    if (!entitlements.length) {
      html += emptyState('key', t('gh_empty_servers_title'), null, '<a class="mk-btn" href="#/operator">' + esc(t('op_back_to_dashboard')) + '</a>');
    } else {
      html += '<div class="mk-op-table-wrap"><table class="mk-op-table"><thead><tr><th>' + esc(t('op_entitlement_customer')) + '</th><th>' + esc(t('op_entitlement_plan')) + '</th><th>' + esc(t('op_entitlement_status')) + '</th><th>' + esc(t('op_entitlement_starts')) + '</th><th>' + esc(t('op_entitlement_expires')) + '</th><th>' + esc(t('op_entitlement_actions')) + '</th></tr></thead><tbody>';
      entitlements.forEach((e) => {
        html += '<tr>' +
          '<td data-label="' + esc(t('op_entitlement_customer')) + '">' + esc(e.customerId || '-') + '</td>' +
          '<td data-label="' + esc(t('op_entitlement_plan')) + '">' + esc(e.planId) + '</td>' +
          '<td data-label="' + esc(t('op_entitlement_status')) + '">' + esc(e.status || '-') + '</td>' +
          '<td data-label="' + esc(t('op_entitlement_starts')) + '">' + esc(e.startsAt ? new Date(e.startsAt).toLocaleString() : '-') + '</td>' +
          '<td data-label="' + esc(t('op_entitlement_expires')) + '">' + esc(e.expiresAt ? new Date(e.expiresAt).toLocaleString() : '-') + '</td>' +
          '<td data-label="' + esc(t('op_entitlement_actions')) + '">' +
            '<button class="mk-btn" id="op-entitlement-edit-' + esc(e.id) + '">' + esc(t('op_update')) + '</button> ' +
            '<button class="mk-btn danger" id="op-entitlement-revoke-' + esc(e.id) + '">' + esc(t('op_entitlement_revoke')) + '</button>' +
          '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
    }
    setApp(html);

    let editingEntitlementId = null;
    const entForm = document.getElementById('op-entitlement-form');
    const entFormTitle = document.getElementById('op-entitlement-form-title');
    const entCustomerInput = document.getElementById('op-entitlement-customer');
    const entPlanSelect = document.getElementById('op-entitlement-plan');
    const entStatusSelect = document.getElementById('op-entitlement-status');
    const entStartsInput = document.getElementById('op-entitlement-starts');
    const entExpiresInput = document.getElementById('op-entitlement-expires');
    const entMsgEl = document.getElementById('op-entitlement-msg');

    const showEntForm = (show) => { if (entForm) entForm.style.display = show ? '' : 'none'; };
    const resetEntForm = () => {
      editingEntitlementId = null;
      if (entCustomerInput) entCustomerInput.value = '';
      if (entPlanSelect) entPlanSelect.value = plans.length ? plans[0].id : '';
      if (entStatusSelect) entStatusSelect.value = 'active';
      if (entStartsInput) entStartsInput.value = '';
      if (entExpiresInput) entExpiresInput.value = '';
      if (entFormTitle) entFormTitle.textContent = t('op_entitlement_form_title');
    };

    const createEntBtn = document.getElementById('op-entitlement-create-btn');
    if (createEntBtn) {
      createEntBtn.addEventListener('click', () => {
        resetEntForm();
        if (entFormTitle) entFormTitle.textContent = t('op_plan_create');
        showEntForm(true);
      });
    }

    const cancelEntBtn = document.getElementById('op-entitlement-cancel');
    if (cancelEntBtn) {
      cancelEntBtn.addEventListener('click', () => { showEntForm(false); resetEntForm(); });
    }

    const saveEntBtn = document.getElementById('op-entitlement-save');
    if (saveEntBtn) {
      saveEntBtn.addEventListener('click', async () => {
        if (entMsgEl) entMsgEl.innerHTML = '';
        const customerId = entCustomerInput ? entCustomerInput.value.trim() : '';
        const planId = entPlanSelect ? entPlanSelect.value : '';
        const status = entStatusSelect ? entStatusSelect.value : 'active';
        const startsAt = entStartsInput ? entStartsInput.value : '';
        const expiresAt = entExpiresInput ? entExpiresInput.value : '';
        if (!customerId || !planId || !startsAt || !expiresAt) {
          if (entMsgEl) entMsgEl.innerHTML = opBanner('error', t('required_field'));
          return;
        }
        saveEntBtn.disabled = true;
        try {
          if (editingEntitlementId) {
            await window.MK_API.ghUpdateEntitlement(editingEntitlementId, { status, startsAt, expiresAt });
            if (entMsgEl) entMsgEl.innerHTML = opBanner('success', t('op_entitlement_updated'));
          } else {
            await window.MK_API.ghCreateEntitlement({ customerId, planId, status, startsAt, expiresAt });
            if (entMsgEl) entMsgEl.innerHTML = opBanner('success', t('op_entitlement_created'));
          }
          resetEntForm();
          showEntForm(false);
          render();
        } catch (e) {
          if (entMsgEl) entMsgEl.innerHTML = opBanner('error', esc(e.message || 'Failed'));
          saveEntBtn.disabled = false;
        }
      });
    }

    entitlements.forEach((e) => {
      const editEntBtn = document.getElementById('op-entitlement-edit-' + e.id);
      if (editEntBtn) {
        editEntBtn.addEventListener('click', () => {
          editingEntitlementId = e.id;
          if (entFormTitle) entFormTitle.textContent = t('op_plan_edit');
          if (entCustomerInput) entCustomerInput.value = e.customerId || '';
          if (entPlanSelect) entPlanSelect.value = e.planId || '';
          if (entStatusSelect) entStatusSelect.value = e.status || 'active';
          if (entStartsInput) {
            const startsDate = e.startsAt ? new Date(e.startsAt) : null;
            entStartsInput.value = startsDate ? startsDate.toISOString().slice(0, 16) : '';
          }
          if (entExpiresInput) {
            const expiresDate = e.expiresAt ? new Date(e.expiresAt) : null;
            entExpiresInput.value = expiresDate ? expiresDate.toISOString().slice(0, 16) : '';
          }
          showEntForm(true);
        });
      }
      const revokeEntBtn = document.getElementById('op-entitlement-revoke-' + e.id);
      if (revokeEntBtn) {
        revokeEntBtn.addEventListener('click', async () => {
          revokeEntBtn.disabled = true;
          if (!await confirmDialog(t('op_entitlement_revoke_confirm'))) { revokeEntBtn.disabled = false; return; }
          try {
            await window.MK_API.ghDeleteEntitlement(e.id);
            if (entMsgEl) entMsgEl.innerHTML = opBanner('success', t('op_entitlement_revoked'));
            render();
          } catch (err) {
            revokeEntBtn.disabled = false;
          }
        });
      }
    });
  }

  async function pageOperatorAudit() {
    if (!window.MK_API.isOperator()) {
      setApp('<h1 class="mk-page-title">' + esc(t('op_audit')) + '</h1>' + opBanner('error', esc(t('gh_auth_required'))));
      return;
    }
    setApp('<h1 class="mk-page-title">' + esc(t('op_audit')) + '</h1><p><a class="mk-btn secondary" href="#/operator">' + esc(t('op_back_to_dashboard')) + '</a></p><div id="mk-op-audit">' + skeletonGameGrid(3) + '</div>');
    let entries = [];
    try { const r = await window.MK_API.ghAuditLog(); entries = (r && r.entries) || []; } catch (_) {}

    let html = '<h1 class="mk-page-title">' + esc(t('op_audit')) + '</h1>';
    html += '<p><a class="mk-btn secondary" href="#/operator">' + esc(t('op_back_to_dashboard')) + '</a></p>';
    if (!entries.length) {
      html += emptyState('file-text', t('gh_empty_servers_title'), null, '<a class="mk-btn" href="#/operator">' + esc(t('op_back_to_dashboard')) + '</a>');
    } else {
      html += '<div class="mk-grid">';
      entries.forEach((entry) => {
        html += '<div class="mk-card">' +
          '<div class="mk-card-body">' +
            '<div class="mk-card-name">' + esc(entry.action || '-') + '</div>' +
            '<div class="mk-card-stock">' + esc(t('op_audit_actor')) + ': ' + esc(entry.actorId || '-') + '</div>' +
            '<div class="mk-card-stock">' + esc(t('op_audit_entity')) + ': ' + esc(entry.resource || '-') + '</div>' +
            '<div class="mk-card-stock">' + esc(t('op_audit_time')) + ': ' + esc(entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '-') + '</div>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    }
    setApp(html);
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
    updateActiveNav(path);
    try {
      if (path === 'game-hosting') {
        if (param === 'my-servers') return pageGameHostingMyServers();
        if (param === 'servers') return pageGameHostingServer(decodeURIComponent(location.hash.split('/')[3] || ''));
        if (param === 'provision' || (typeof param === 'string' && param.startsWith('provision'))) return pageGameHostingProvision();
        if (param === 'requests') return pageGameHostingRequests();
        return pageGameHosting();
      }
      if (path === 'operator') {
        if (param === 'plans') return pageOperatorPlans();
        if (param === 'servers') return pageOperatorServers();
        if (param === 'queue') return pageOperatorQueue();
        if (param === 'entitlements') return pageOperatorEntitlements();
        if (param === 'audit') return pageOperatorAudit();
        return pageGameHosting();
      }
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

  function updateActiveNav(path) {
    const selectorMap = {
      'home': ['a[href="#/home"]', '#mk-bottom-nav a[href="#/home"]'],
      'catalog': ['a[href="#/catalog"]', '#mk-bottom-nav a[href="#/catalog"]'],
      'cart': ['a[href="#/cart"]', '#mk-bottom-nav a[href="#/cart"]'],
      'track': ['a[href="#/track"]', '#mk-bottom-nav a[href="#/track"]'],
      'account': ['a[href="#/account"]', '#mk-bottom-nav a[href="#/account"]'],
      'game-hosting': ['a[href="#/game-hosting"]', '#mk-bottom-nav a[href="#/game-hosting"]', 'a[href="#/game-hosting/my-servers"]', '#mk-bottom-nav a[href="#/game-hosting/my-servers"]', 'a[href="#/game-hosting/requests"]', '#mk-bottom-nav a[href="#/game-hosting/requests"]'],
      'operator': ['#mk-op-nav a[href="#/operator"]', '#mk-mobile-op-nav a[href="#/operator"]']
    };
    const selectors = selectorMap[path] || [];
    document.querySelectorAll('.mk-nav a, .mk-mobile-nav a, .mk-bottom-nav a').forEach((a) => a.classList.remove('active'));
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((a) => a.classList.add('active'));
    });
  }

  function init() {
    document.documentElement.lang = _locale;
    document.documentElement.dir = _locale === 'ar' ? 'rtl' : 'ltr';
    const langBtn = document.getElementById('mk-lang-btn');
    if (langBtn) langBtn.addEventListener('click', () => setLocale(_locale === 'ar' ? 'en' : 'ar'));
    const menuBtn = document.getElementById('mk-menu-btn');
    const mobileNav = document.getElementById('mk-mobile-nav');
    if (menuBtn && mobileNav) {
      menuBtn.addEventListener('click', () => {
        const open = mobileNav.classList.toggle('is-open');
        menuBtn.setAttribute('aria-expanded', String(open));
      });
      mobileNav.querySelectorAll('a').forEach((a) => {
        a.addEventListener('click', () => {
          mobileNav.classList.remove('is-open');
          menuBtn.setAttribute('aria-expanded', 'false');
        });
      });
    }
    updateAuthUI();
    window.addEventListener('hashchange', () => { updateAuthUI(); render(); });
    if (!location.hash) location.hash = '#/home';
    else render();
  }

  function updateAuthUI() {
    const isOp = window.MK_API.isOperator();
    const isAuthed = window.MK_API.isAuthed();
    const ghReqLink = document.getElementById('mk-gh-requests-link');
    const mobileGhReqLink = document.getElementById('mk-mobile-gh-requests-link');
    const opNavLink = document.getElementById('mk-op-nav-link');
    const mobileOpNavLink = document.getElementById('mk-mobile-op-nav-link');
    const opNav = document.getElementById('mk-op-nav');
    const mobileOpNav = document.getElementById('mk-mobile-op-nav');
    if (ghReqLink) ghReqLink.style.display = isAuthed ? '' : 'none';
    if (mobileGhReqLink) mobileGhReqLink.style.display = isAuthed ? '' : 'none';
    if (opNavLink) opNavLink.style.display = isOp ? '' : 'none';
    if (mobileOpNavLink) mobileOpNavLink.style.display = isOp ? '' : 'none';
    if (opNav) opNav.style.display = isOp ? '' : 'none';
    if (mobileOpNav) mobileOpNav.style.display = isOp ? '' : 'none';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

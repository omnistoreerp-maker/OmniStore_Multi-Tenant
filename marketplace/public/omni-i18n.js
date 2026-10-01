(function () {
  'use strict';

  var STORAGE_KEY = 'omnistore_language';
  var LEGACY_KEY = 'omnistore_platform_lang';
  var VALID = { en: true, ar: true };
  var ATTRS = ['placeholder', 'aria-label', 'title', 'alt', 'data-tooltip', 'aria-description'];
  var DEBOUNCE_MS = 120;

  var lang = readStored();
  var byText = Object.create(null);
  var dictCount = 0;
  var listeners = [];
  var observer = null;
  var started = false;
  var passTimer = null;

  function readStored() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (VALID[v]) return v;
      v = localStorage.getItem(LEGACY_KEY);
      if (VALID[v]) return v;
    } catch (e) {}
    return 'en';
  }

  function writeStored(next) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
      localStorage.setItem(LEGACY_KEY, next);
    } catch (e) {}
  }

  function norm(s) {
    return String(s).replace(/\s+/g, ' ').trim();
  }

  function applyDocLang() {
    var html = document.documentElement;
    if (!html) return;
    html.setAttribute('lang', lang);
    html.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    html.setAttribute('data-omni-lang', lang);
  }

  function getLang() {
    return lang;
  }

  function getDir() {
    return lang === 'ar' ? 'rtl' : 'ltr';
  }

  function setLang(next) {
    if (!VALID[next]) return;
    if (next !== lang) {
      lang = next;
      writeStored(lang);
      applyDocLang();
      runPass();
      notify();
    }
    syncSwitchers();
  }

  function onChange(fn) {
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](lang); } catch (e) {}
    }
    try {
      document.dispatchEvent(new CustomEvent('omnilangchange', { detail: { lang: lang, dir: getDir() } }));
    } catch (e) {}
  }

  function registerDict(src, map) {
    var source = src === 'en' ? 'en' : 'ar';
    if (!map) return;
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      var k = norm(keys[i]);
      if (!k) continue;
      if (!byText[k]) {
        byText[k] = { src: source, val: map[keys[i]] };
        dictCount++;
      }
    }
    schedulePass(0);
  }

  function lookup(orig) {
    return byText[norm(orig)] || null;
  }

  function targetFor(orig) {
    var entry = lookup(orig);
    if (!entry) return null;
    if (lang === entry.src) return orig;
    return entry.val;
  }

  function t(text) {
    var hit = targetFor(text);
    return hit === null ? text : hit;
  }

  function wrapSpaces(orig, val) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(String(orig));
    if (!m || (!m[1] && !m[3])) return val;
    return m[1] + val + m[3];
  }

  function translateTextNode(n) {
    if (!dictCount) return;
    var last = n.__omniA;
    var cur = n.nodeValue;
    if (last !== undefined && cur !== last) {
      n.__omniO = cur;
      n.__omniA = undefined;
    } else if (n.__omniO === undefined) {
      n.__omniO = cur;
    }
    var orig = n.__omniO;
    var hit = targetFor(orig);
    var target = orig;
    if (hit !== null && hit !== orig) target = wrapSpaces(orig, hit);
    if (n.nodeValue !== target) n.nodeValue = target;
    n.__omniA = target;
  }

  function translateAttrs(el) {
    if (!el || el.nodeType !== 1 || !dictCount) return;
    var store = el.__omniAO;
    if (!store) {
      store = el.__omniAO = {};
    }
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var cur = el.getAttribute(a);
      var last = store['#' + a];
      var orig = store[a];
      if (last !== undefined && cur !== last) {
        orig = cur;
        store[a] = orig;
        store['#' + a] = undefined;
      } else if (orig === undefined) {
        orig = cur;
        store[a] = orig;
      }
      var hit = targetFor(orig);
      var target = hit === null ? orig : hit;
      if (cur !== target) el.setAttribute(a, target);
      store['#' + a] = target;
    }
  }

  function translateRoot(root) {
    if (!root || !dictCount) return;
    if (root.nodeType === 3) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== 1) return;
    var tag = root.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') return;
    translateAttrs(root);
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      var p = n.parentElement;
      var skip = false;
      while (p && p !== root) {
        var pt = p.tagName;
        if (pt === 'SCRIPT' || pt === 'STYLE' || pt === 'NOSCRIPT' || pt === 'TEMPLATE') { skip = true; break; }
        p = p.parentElement;
      }
      if (!skip) translateTextNode(n);
    }
    var els = root.querySelectorAll
      ? root.querySelectorAll('[placeholder],[aria-label],[title],[alt],[data-tooltip],[aria-description]')
      : [];
    for (var i = 0; i < els.length; i++) translateAttrs(els[i]);
  }

  function runPass() {
    if (passTimer) {
      clearTimeout(passTimer);
      passTimer = null;
    }
    mountSlots();
    if (document.documentElement) translateRoot(document.documentElement);
    syncSwitchers();
  }

  function schedulePass(delay) {
    if (passTimer) clearTimeout(passTimer);
    passTimer = setTimeout(runPass, delay === undefined ? DEBOUNCE_MS : delay);
  }

  function onMutations(records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'characterData') {
        var n = r.target;
        if (n.__omniA === undefined || n.nodeValue !== n.__omniA) translateTextNode(n);
      } else if (r.type === 'childList') {
        var added = r.addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType === 3) translateTextNode(node);
          else if (node.nodeType === 1) translateRoot(node);
        }
        if (added.length) mountSlots();
      } else if (r.type === 'attributes') {
        var el = r.target;
        var store = el.__omniAO;
        var applied = store ? store['#' + r.attributeName] : undefined;
        if (applied === undefined || el.getAttribute(r.attributeName) !== applied) translateAttrs(el);
      }
    }
  }

  function buildSwitcher(slot) {
    if (slot.getAttribute('data-omni-rendered') === '1') return;
    slot.setAttribute('data-omni-rendered', '1');
    slot.classList.add('omni-lang');
    slot.setAttribute('role', 'group');
    slot.setAttribute('aria-label', 'Language / اللغة');
    slot.textContent = '';

    var en = document.createElement('button');
    en.type = 'button';
    en.className = 'omni-lang-btn';
    en.setAttribute('data-omni-set-lang', 'en');
    en.setAttribute('lang', 'en');
    en.textContent = 'English';

    var ar = document.createElement('button');
    ar.type = 'button';
    ar.className = 'omni-lang-btn';
    ar.setAttribute('data-omni-set-lang', 'ar');
    ar.setAttribute('lang', 'ar');
    ar.setAttribute('dir', 'rtl');
    ar.textContent = 'العربية';

    slot.appendChild(en);
    slot.appendChild(ar);
  }

  function mountSlots() {
    var slots = document.querySelectorAll('[data-omni-lang-slot]');
    for (var i = 0; i < slots.length; i++) buildSwitcher(slots[i]);
    if (slots.length) syncSwitchers();
  }

  function syncSwitchers() {
    var btns = document.querySelectorAll('.omni-lang-btn[data-omni-set-lang]');
    for (var i = 0; i < btns.length; i++) {
      var v = btns[i].getAttribute('data-omni-set-lang');
      btns[i].setAttribute('aria-pressed', v === lang ? 'true' : 'false');
      if (v === lang) btns[i].classList.add('is-active');
      else btns[i].classList.remove('is-active');
    }
  }

  function onDocClick(e) {
    var node = e.target;
    while (node && node !== document && node.nodeType === 1) {
      var v = node.getAttribute ? node.getAttribute('data-omni-set-lang') : null;
      if (v && VALID[v]) {
        e.preventDefault();
        setLang(v);
        return;
      }
      node = node.parentNode;
    }
  }

  function maybeInjectDesignCss() {
    var cur = document.currentScript;
    var src = cur && cur.src ? cur.src : '';
    if (!src) return;
    var css = src.replace(/omni-i18n(?:\.min)?\.js(?:\?.*)?$/, 'omni-design.css');
    if (!css || css === src) return;
    try {
      css = new URL(css, location.href).href;
    } catch (e) {}
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].href === css) return;
    }
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = css;
    link.setAttribute('data-omni-design', '1');
    (document.head || document.documentElement).appendChild(link);
  }

  function start() {
    if (started || !document.documentElement) return;
    started = true;
    applyDocLang();
    try {
      observer = new MutationObserver(onMutations);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ATTRS
      });
    } catch (e) {}
    document.addEventListener('click', onDocClick, false);
    maybeInjectDesignCss();
    runPass();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { runPass(); });
    }
    try {
      writeStored(lang);
    } catch (e) {}
  }

  window.OmniLang = {
    get: getLang,
    set: setLang,
    dir: getDir,
    onChange: onChange,
    registerDict: registerDict,
    translate: t,
    apply: runPass,
    source: 'omnistore_language'
  };

  start();
})();

/* OmniStore Games — sandbox storage shim.
 *
 * Games in the OmniStore catalog run inside a sandboxed iframe WITHOUT the
 * allow-same-origin flag, so the game can never read OmniStore application
 * data (auth tokens, tenant data, admin APIs). In that sandboxed mode,
 * browsers throw a SecurityError on any access to window.localStorage /
 * window.sessionStorage. This shim — loaded as the FIRST script of every
 * game page — detects that case and transparently substitutes an opaque,
 * in-memory storage object so games keep working (high scores simply live
 * for the current page session).
 *
 * When the page is NOT sandboxed (local development), the real storage is
 * left untouched.
 */
(function () {
  'use strict';

  function makeStore() {
    var data = Object.create(null);
    return {
      getItem: function (k) {
        k = String(k);
        return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
      },
      setItem: function (k, v) { data[String(k)] = String(v); },
      removeItem: function (k) { delete data[String(k)]; },
      clear: function () { data = Object.create(null); },
      key: function (i) {
        var ks = Object.keys(data);
        return i >= 0 && i < ks.length ? ks[i] : null;
      }
    };
  }

  function define(name) {
    var store = makeStore();
    var broken = false;
    try {
      /* Any touch of the real storage throws SecurityError in a sandboxed
       * iframe without allow-same-origin. */
      window[name].getItem('__omnistore_probe__');
    } catch (e) {
      broken = true;
    }
    if (broken) {
      try {
        Object.defineProperty(window, name, {
          value: store, writable: false, configurable: true
        });
      } catch (e2) { /* leave environment untouched */ }
    }
  }

  try {
    define('localStorage');
    define('sessionStorage');
  } catch (e) { /* never break the host page */ }
})();

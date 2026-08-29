// Market API client. Talks only to /api/v1/market. The tenant is configured
// here (server-trusted header). A real deployment sets MARKET_TENANT per
// storefront instance; it is never taken from untrusted client input.
window.MK_TENANT = 'default';

window.MK_API = (function () {
  const TENANT = window.MK_TENANT;
  const BASE = '/api/v1/market';

  function token() {
    try { return localStorage.getItem('mk_token') || null; } catch (_) { return null; }
  }

  function setToken(t) {
    try { if (t) localStorage.setItem('mk_token', t); else localStorage.removeItem('mk_token'); } catch (_) {}
  }

  function headers(json) {
    const h = { 'X-Tenant-Id': TENANT };
    const t = token();
    if (t) h['Authorization'] = 'Bearer ' + t;
    if (json !== false) h['Content-Type'] = 'application/json';
    return h;
  }

  async function req(method, path, body) {
    const opts = { method, headers: headers(true) };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(BASE + path, opts);
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const msg = (data && data.message) || 'Request failed';
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data ? data.data : null;
  }

  return {
    setToken,
    getToken: token,
    isAuthed: () => !!token(),
    config: () => req('GET', '/config'),
    products: (q) => req('GET', '/products?' + new URLSearchParams(q || {}).toString()),
    product: (id) => req('GET', '/products/' + encodeURIComponent(id)),
    categories: () => req('GET', '/categories'),
    search: (q) => req('GET', '/search?' + new URLSearchParams({ q }).toString()),
    availability: (ids) => req('GET', '/availability?' + new URLSearchParams({ ids: ids.join(',') }).toString()),
    register: (p) => req('POST', '/auth/register', p),
    login: (p) => req('POST', '/auth/login', p),
    logout: () => req('POST', '/auth/logout'),
    me: () => req('GET', '/auth/me'),
    updateProfile: (p) => req('PUT', '/customers/me', p),
    changePassword: (p) => req('POST', '/customers/me/password', p),
    checkout: (p) => req('POST', '/checkout', p),
    track: (token) => req('GET', '/track/' + encodeURIComponent(token)),
    myOrders: () => req('GET', '/orders')
  };
})();

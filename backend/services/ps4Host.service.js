'use strict';

// ps4Host.service — Phase 2 PlayStation Host service (data + business layer).
//
// Sits ABOVE the Phase 1 gamesCatalog.service. The catalog is the SOLE source
// of game metadata; this service never reads games_catalog.json directly,
// never fetches a download URL, and never talks to the RPI outside of the
// isolated boundary in ./rpiClient.
//
// Responsibilities (Phase 2 only):
//   1. listGames      — delegate to catalog; default filter available games
//   2. resolveGame    — tenant-safe lookup; reject cross-tenant and unavailable
//   3. resolveDownloadUrl — pass the catalog's pre-validated URL through unchanged
//   4. validateInstallRequest — input validation for install payloads
//   5. installGame    — validate → resolve → call rpiClient stub
//
// The service performs ZERO network I/O. The rpiClient is a stub that
// returns an explicit deferred result. The catalog already validated the
// download URL at create-time, so this service does NOT re-validate private
// hosts — doing so would create a second source of truth.
//
// NOT in this phase:
//   - HTTP routes (Phase 3)
//   - server.js mount (Phase 3)
//   - permission gating (Phase 3, in the routes layer)
//   - audit logging (deferred; no existing convention requires it)
//   - real RPI protocol (deferred; see rpiClient.js)

const gamesCatalog = require('./gamesCatalog.service');
const rpiClient = require('./ps4Host/rpiClient');

// Trusted LAN target policy.
//
// The install request includes the PS4's local IP so the RPI can reach it
// over the LAN. PS4 consoles on a private shop network will have RFC1918
// addresses. Loopback / link-local / unspecified / broadcast addresses are
// REJECTED — they cannot be a real PS4 on a real LAN.
//
//   ACCEPTED:  10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
//   REJECTED:  127.0.0.0/8 (loopback), 169.254.0.0/16 (link-local),
//              0.0.0.0 (unspecified), 255.255.255.255 (broadcast),
//              224.0.0.0/4 (multicast), ::1, fe80::/10, fc00::/7
//
// Hostnames are REJECTED: the RPI needs a literal IP to connect to; DNS
// would create an SSRF surface and ambiguity.
const _IPV4 = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

function _isPrivateIPv4(addr) {
  const m = addr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function _isLoopbackOrReservedIPv4(addr) {
  const m = addr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return true;
  const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]), d = Number(m[4]);
  if (a === 127) return true;            // loopback
  if (a === 0) return true;              // unspecified / "this network"
  if (a === 255 && b === 255 && c === 255 && d === 255) return true; // broadcast
  if (a >= 224 && a <= 239) return true; // multicast
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

function _isLoopbackOrReservedIPv6(addr) {
  const lower = addr.toLowerCase();
  if (lower === '::1') return true;
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
  if (/^fe[89ab][0-9a-f]?:/i.test(lower)) return true; // fe80::/10 link-local
  if (/^f[cd]/i.test(lower)) return true; // fc00::/7 ULA — also REJECTED
  if (/^ff/i.test(lower)) return true; // multicast
  return false;
}

function _validateTargetAddress(target) {
  if (typeof target !== 'string' || target.length === 0) {
    return { error: 'target is required' };
  }
  if (target.length > 64) {
    return { error: 'target is too long' };
  }
  // Trim trailing IPv6 zone (e.g. fe80::1%eth0) — we do not support zones.
  const cleaned = target.replace(/%.*$/, '').trim();
  // Hostnames are rejected outright (no DNS, no ambiguity).
  if (/[a-zA-Z]/.test(cleaned) && !cleaned.includes(':')) {
    // Looks like a hostname, not a numeric IP. Reject.
    return { error: 'target must be a numeric IP address, not a hostname' };
  }
  if (cleaned.includes(':')) {
    // IPv6 (possibly bracketed)
    const inner = cleaned.replace(/^\[|\]$/g, '');
    if (!/^[0-9a-fA-F:]+$/.test(inner)) {
      return { error: 'target contains invalid characters' };
    }
    if (_isLoopbackOrReservedIPv6(inner)) {
      return { error: 'target is a loopback, link-local, multicast, or otherwise reserved address' };
    }
    return { value: inner };
  }
  if (!_IPV4.test(cleaned)) {
    return { error: 'target is not a valid IPv4 address' };
  }
  if (_isLoopbackOrReservedIPv4(cleaned)) {
    return { error: 'target is a loopback, link-local, multicast, or otherwise reserved address' };
  }
  if (!_isPrivateIPv4(cleaned)) {
    // Public IPv4 addresses are not what a shop-local PS4 would have. We
    // reject them so a typo / hostile input cannot redirect the install
    // to an arbitrary public address. This is the LAN-trust boundary.
    return { error: 'target must be a private LAN address (RFC1918)' };
  }
  return { value: cleaned };
}

function _validateInstallRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'request body must be a JSON object' };
  }
  if (input.id == null || String(input.id).trim() === '') {
    return { error: 'id (or gameId) is required' };
  }
  if (input.id !== undefined && typeof input.id !== 'string') {
    return { error: 'id (or gameId) must be a string' };
  }
  if (input.titleId !== undefined && typeof input.titleId !== 'string') {
    return { error: 'titleId must be a string' };
  }
  const targetCheck = _validateTargetAddress(input.target);
  if (targetCheck.error) return { error: targetCheck.error };
  return {
    value: {
      id: String(input.id).trim(),
      titleId: input.titleId ? String(input.titleId).trim() : null,
      target: targetCheck.value
    }
  };
}

// -----------------------------------------------------------------------
// Public service API
// -----------------------------------------------------------------------

// listGames — delegate to the catalog. Defaults to is_available=true so
// the install UI only sees games that can be installed. Caller can pass
// is_available=false to list unavailable games for admin views (Phase 3
// may add an admin-only route that uses this).
function listGames({ query, tenantContext } = {}) {
  const effectiveQuery = Object.assign({ is_available: true }, query || {});
  return gamesCatalog.list({ query: effectiveQuery, tenantContext });
}

// resolveGame — tenant-safe lookup. Returns the game object, or null when
// missing, cross-tenant, or unavailable. Callers MUST treat null as
// 'not found' (no separate 404 vs 403 distinction — same as the catalog).
function resolveGame({ id, tenantContext, includeUnavailable } = {}) {
  if (id == null || id === '') return null;
  const game = gamesCatalog.getById({ id, tenantContext });
  if (!game) return null;
  if (!includeUnavailable && game.is_available === false) return null;
  return game;
}

// resolveDownloadUrl — pass-through. The catalog already validated the URL
// at create-time. This service NEVER fetches, proxies, or even parses the
// URL — it returns the stored string unchanged. The RPI (out of process)
// is the only component authorized to connect to it.
function resolveDownloadUrl({ game } = {}) {
  if (!game || typeof game !== 'object') return null;
  return game.local_download_url || null;
}

// installGame — validate the request, resolve the game through the
// catalog (tenant-scoped), reject if unavailable, then call the RPI
// boundary stub. No data is mutated by this service.
//
// Result shapes:
//   { status: 'not_found' }                          — game missing or wrong tenant
//   { status: 'unavailable' }                        — game.is_available === false
//   { status: 'invalid', error: '...' }              — validation failure
//   { status: 'deferred', reason: '...' }            — RPI stub returned deferred
//   { status: 'rpi_failure', reason: '...' }         — RPI stub returned an explicit failure
//   { status: 'accepted', installId: '...' }         — future, when real RPI is wired
function installGame({ data, tenantContext, actor } = {}) {
  const check = _validateInstallRequest(data);
  if (check.error) return { status: 'invalid', error: check.error };
  const req = check.value;

  // Resolve the game through the catalog. Use includeUnavailable=true
  // so we can distinguish "not found / wrong tenant" (null) from
  // "found but unavailable" (returns the record with is_available=false).
  // A cross-tenant id still returns null — the catalog does not leak
  // other tenants' records.
  const game = gamesCatalog.getById({ id: req.id, tenantContext });
  if (!game) return { status: 'not_found' };
  if (game.is_available === false) return { status: 'unavailable' };

  // Build the install payload for the RPI. The local_download_url comes
  // from the catalog's pre-validated record — the install request does
  // NOT carry a URL.
  const installPayload = {
    gameId: game.id,
    titleId: game.title_id,
    ps4Target: req.target,
    localDownloadUrl: game.local_download_url
  };

  // The RPI boundary is a stub today. The result.status is the contract
  // for the future real client. Today's stub ALWAYS returns
  // { status: 'deferred', reason: 'RPI EXECUTION DEFERRED — PROTOCOL NOT IMPLEMENTED' }.
  let rpiResult;
  try {
    rpiResult = rpiClient.installGame(installPayload);
  } catch (err) {
    // A throwing rpiClient is treated as a controlled failure. The
    // catalog is NEVER mutated as a side effect of install.
    return { status: 'rpi_failure', reason: (err && err.message) || 'RPI client threw' };
  }
  if (!rpiResult || typeof rpiResult !== 'object') {
    return { status: 'rpi_failure', reason: 'RPI client returned no result' };
  }
  // Pass the rpi result through. Today this is always 'deferred'.
  return {
    status: rpiResult.status || 'unknown',
    reason: rpiResult.reason,
    installId: rpiResult.installId
  };
}

module.exports = {
  listGames,
  resolveGame,
  resolveDownloadUrl,
  installGame,
  // Exposed for tests and for the Phase 3 controller.
  _validateInstallRequest,
  _validateTargetAddress,
  RPI_URL: rpiClient.RPI_URL
};

'use strict';

// Public Reels API + TikTok connection endpoints.
//
// SECURITY CONTRACT enforced in this controller:
//   - No handler returns an access token, refresh token, client secret, or
//     client key. The connection status endpoint returns the secret-free
//     shape from tiktokConnection.service.getStatus().
//   - The OAuth callback exchanges the code server-side and stores the result;
//     it never echoes tokens back to the browser.
//   - Nothing here is tenant-scoped. There is no companyId input, no tenant
//     lookup, and no credential from a tenant.
//   - AUTHORIZATION: this integration owns ONE global account. Reads are
//     public, but every endpoint that can create, replace, refresh or destroy
//     that account connection is gated by requireAuth + requirePlatformAdmin
//     in the router. Without that gate any anonymous visitor could run the
//     OAuth dance and repoint the public Reels feed at their own account, or
//     simply disconnect OmniStore's account. The callback stays public
//     because TikTok redirects to it cross-site, and is instead protected by
//     the single-use state bound to the admin who started the flow.

const { success, error } = require('../utils/apiResponse');
const config = require('../config/tiktok');
const connection = require('../services/tiktokConnection.service');
const displayApi = require('../services/tiktokDisplayApi.service');
const reelsCache = require('../services/reelsCache.service');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Public read API
// ---------------------------------------------------------------------------

// GET /api/v1/platform-public/reels
// Returns display metadata only. Never tokens.
async function getReels(req, res) {
  try {
    const feed = await reelsCache.ensureFresh();
    success(res, {
      items: feed.items,
      nextCursor: feed.nextCursor,
      hasMore: feed.hasMore,
      syncedAt: feed.syncedAt,
      connected: feed.connected,
      account: feed.account
    }, 'Reels retrieved');
  } catch (err) {
    logger.error('reels.getReels error:', err.message);
    error(res, 'Failed to retrieve reels', 500);
  }
}

// GET /api/v1/platform-public/reels/status
// Diagnostics: cache age, whether an account is connected, and configuration
// readiness. Deliberately excludes stale-error internals beyond a code, and
// excludes every secret.
//
// Platform-admin gated in the router: the shape includes the authorized
// account's stable identifiers, which must not be world-readable.
async function getReelsStatus(req, res) {
  try {
    const cache = reelsCache.getCacheInfo();
    success(res, {
      cache,
      account: connection.getStatus()
    }, 'Reels status retrieved');
  } catch (err) {
    logger.error('reels.getReelsStatus error:', err.message);
    error(res, 'Failed to retrieve reels status', 500);
  }
}

// ---------------------------------------------------------------------------
// TikTok connection (OAuth) endpoints
// ---------------------------------------------------------------------------

// GET /api/v1/platform-public/tiktok/connect
// Starts authorization: mints a CSRF state bound to the calling platform
// admin, then redirects the browser to TikTok's consent page. The user
// approves there; OmniStore never sees their password.
// Platform-admin gated in the router.
function startOAuth(req, res) {
  const publicConfig = config.getPublicConfig();
  if (!publicConfig.configured) {
    return error(res, publicConfig.redirectUriProblem || 'TikTok integration is not configured', 503);
  }
  const owner = (req.platformAdmin && req.platformAdmin.username) || null;
  const state = connection.createState(owner);
  return res.redirect(config.AUTHORIZE_URL + '?' + new URLSearchParams({
    client_key: config.getClientKey(),
    response_type: 'code',
    scope: config.getScopes().join(','),
    redirect_uri: String(process.env.TIKTOK_REDIRECT_URI || '').trim(),
    state
  }).toString());
}

// GET /api/v1/platform-public/tiktok/callback
// TikTok redirects here with ?code=...&state=... (or ?error=...).
// Validates state, exchanges the code server-side, persists tokens, refreshes
// account identity, and returns a secret-free status. The browser receives no
// token material.
//
// Gated by the same platform-admin check as /connect: the auth cookie is
// SameSite=Lax, so TikTok's top-level GET redirect carries it and the gate
// resolves normally. State ownership is then checked as well, so a flow can
// only be completed by the admin who started it.
async function handleCallback(req, res) {
  const query = req.query || {};
  if (query.error) {
    logger.warn('tiktok OAuth: authorization returned an error code');
    return error(res, 'TikTok authorization was not completed', 400);
  }
  const code = String(query.code || '').trim();
  if (!code) return error(res, 'Missing authorization code', 400);

  const owner = (req.platformAdmin && req.platformAdmin.username) || null;
  if (!connection.consumeState(String(query.state || ''), owner)) {
    // Missing, unknown, replayed, expired, or owner-mismatched state: refuse
    // the exchange. This is the CSRF guard.
    logger.warn('tiktok OAuth: rejected callback with invalid state');
    return error(res, 'Invalid or expired authorization state', 400);
  }

  try {
    const exchanged = await displayApi.exchangeCodeForTokens(code);
    if (!exchanged.ok) {
      logger.warn('tiktok OAuth: code exchange failed (' + exchanged.code + ')');
      return error(res, 'Could not complete TikTok authorization', 502);
    }

    connection.saveConnection(exchanged.tokens, null);

    // The authorized account is the source of truth for identity.
    const account = await displayApi.getAuthorizedAccount();
    if (account.ok) connection.updateIdentity(account.account);

    const status = connection.getStatus();
    // No token is included: getStatus() is secret-free by construction.
    // openId is a stable per-user identifier and is not needed here.
    return success(res, {
      connected: status.connected,
      displayName: status.displayName,
      username: status.username,
      profileDeepLink: status.profileDeepLink,
      scope: status.scope
    }, 'TikTok account connected');
  } catch (err) {
    logger.error('tiktok OAuth: callback error:', err.message);
    error(res, 'Could not complete TikTok authorization', 500);
  }
}

// GET /api/v1/platform-public/tiktok/status
function getConnectionStatus(req, res) {
  try {
    return success(res, connection.getStatus(), 'TikTok connection status retrieved');
  } catch (err) {
    logger.error('tiktok.getConnectionStatus error:', err.message);
    error(res, 'Failed to retrieve TikTok connection status', 500);
  }
}

// POST /api/v1/platform-public/tiktok/sync
// Operator-triggered refresh of the cached feed. Read-only with respect to
// TikTok (List Videos is a read call).
async function triggerSync(req, res) {
  try {
    const result = await reelsCache.syncNow();
    if (!result.ok) {
      return error(res, 'Sync failed: ' + (result.code || 'unknown'), 502);
    }
    return success(res, { count: result.count, cache: reelsCache.getCacheInfo() }, 'Reels synced');
  } catch (err) {
    logger.error('tiktok.triggerSync error:', err.message);
    error(res, 'Could not sync reels', 500);
  }
}

// POST /api/v1/platform-public/tiktok/disconnect
// Revokes upstream, then clears the local record. Never returns tokens.
async function disconnect(req, res) {
  try {
    await displayApi.revokeAccess();
    return success(res, { connected: false }, 'TikTok account disconnected');
  } catch (err) {
    logger.error('tiktok.disconnect error:', err.message);
    error(res, 'Could not disconnect TikTok account', 500);
  }
}

module.exports = {
  getReels,
  getReelsStatus,
  startOAuth,
  handleCallback,
  getConnectionStatus,
  triggerSync,
  disconnect
};

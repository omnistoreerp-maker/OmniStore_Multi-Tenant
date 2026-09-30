'use strict';

// TikTok Display API client (server-side only).
//
// Official references:
//   List Videos   https://developers.tiktok.com/doc/tiktok-api-v2-video-list
//   Get User Info https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info
//   Rate limits   https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit
//
// SECURITY CONTRACT: every request is authenticated with a server-held access
// token. No function here returns a token, and no error path interpolates one
// into a message. Normalization maps the upstream video object to the exact
// fields the Reels UI needs and DROPS everything else — including embed_html,
// which is remote third-party HTML that must never reach a client as markup.
//
// NOTE ON MEDIA: the Display API returns metadata only. There is no documented
// field containing a playable media file, so this service never looks for one
// and never claims a video can be played natively. Playback happens on TikTok's
// own player.

const logger = require('../utils/logger');
const config = require('../config/tiktok');
const connection = require('./tiktokConnection.service');

// A small budget guard for the documented 600 req/min sliding window. It is a
// safety net, not a substitute for the sync cache: the reels cache means a
// normal page load performs zero upstream calls.
const _rate = { windowStart: Date.now(), count: 0 };

function _consumeRateBudget() {
  const now = Date.now();
  if (now - _rate.windowStart >= 60000) {
    _rate.windowStart = now;
    _rate.count = 0;
  }
  _rate.count += 1;
  return _rate.count <= config.RATE_LIMIT_PER_MINUTE;
}

async function _postForm(url, form) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    if (value === undefined || value === null || value === '') continue;
    body.append(key, String(value));
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache'
    },
    body: body.toString()
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  return { ok: res.ok, status: res.status, data: data || {} };
}

function _tiktokError(result) {
  const data = result.data || {};
  const err = data.error || {};
  return {
    ok: false,
    // Only non-secret upstream diagnostics are surfaced.
    code: String(err.code || data.error_description || ('http_' + result.status)),
    message: String(err.message || data.error_description || 'TikTok API request failed'),
    status: result.status,
    rateLimited: result.status === 429 || err.code === 'rate_limit_exceeded'
  };
}

// Exchange an authorization code for tokens. INTERNAL ONLY — the caller stores
// the result via tiktokConnection.service and never returns it to a browser.
async function exchangeCodeForTokens(code) {
  if (!config.isFullyConfigured()) {
    return { ok: false, code: 'not_configured', message: config.getPublicConfig().redirectUriProblem || 'TikTok is not configured' };
  }
  const result = await _postForm(config.TOKEN_URL, {
    client_key: config.getClientKey(),
    client_secret: config.getClientSecret(),
    code,
    grant_type: 'authorization_code',
    redirect_uri: String(process.env.TIKTOK_REDIRECT_URI || '').trim()
  });
  if (!result.ok || !result.data || !result.data.access_token) return _tiktokError(result);
  return { ok: true, tokens: result.data };
}

async function refreshAccessToken() {
  const refreshToken = connection.getRefreshToken();
  if (!refreshToken) return { ok: false, code: 'no_refresh_token', message: 'No valid refresh token is stored' };
  const result = await _postForm(config.TOKEN_URL, {
    client_key: config.getClientKey(),
    client_secret: config.getClientSecret(),
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });
  if (!result.ok || !result.data || !result.data.access_token) return _tiktokError(result);
  connection.saveConnection(result.data, null);
  logger.info('tiktokDisplayApi: access token refreshed');
  return { ok: true };
}

async function _getValidAccessToken() {
  const current = connection.getAccessToken();
  if (current) return current;
  const refreshed = await refreshAccessToken();
  if (!refreshed.ok) return null;
  return connection.getAccessToken();
}

// Identity of the authorized account. Used after a successful exchange so the
// connected account — not a configured handle — is the source of truth.
async function getAuthorizedAccount() {
  const token = await _getValidAccessToken();
  if (!token) return { ok: false, code: 'not_connected', message: 'No connected TikTok account' };
  if (!_consumeRateBudget()) return { ok: false, code: 'rate_limited', message: 'Local rate budget exhausted' };

  const fields = ['open_id', 'union_id', 'display_name', 'avatar_url', 'username', 'profile_deep_link', 'bio_description'];
  let res;
  try {
    res = await fetch(config.USER_INFO_URL + '?fields=' + fields.join(','), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    });
  } catch (err) {
    logger.warn('tiktokDisplayApi: user info request failed: ' + (err && err.message));
    return { ok: false, code: 'network_error', message: 'Could not reach TikTok' };
  }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  if (!res.ok || !data || (data.error && data.error.code && data.error.code !== 'ok')) {
    return _tiktokError({ ok: false, status: res.status, data: data || {} });
  }
  const user = (data.data && data.data.user) || {};
  return {
    ok: true,
    account: {
      open_id: user.open_id || '',
      display_name: user.display_name || '',
      username: user.username || '',
      avatar_url: user.avatar_url || '',
      profile_deep_link: user.profile_deep_link || ''
    }
  };
}

// TikTok's cover-image CDN. The Display API documents cover_image_url on hosts
// like p16-sign.tiktokcdn-us.com and rotates the "pNN-sign" subdomain per
// region, so the allowlist is expressed over TikTok's two CDN registrable
// domains. Kept in one place so the CSP allowlist in server.js / nginx.conf and
// this validator can never drift apart.
const COVER_CDN_HOSTS = ['tiktokcdn.com', 'tiktokcdn-us.com'];

// Accept a cover image ONLY if it is an https URL on a TikTok CDN host.
// This is enforced server-side so the browser's img-src allowlist is provably
// sufficient: a malformed or hostile upstream value can never introduce a
// third-party image origin into the page. A rejected cover degrades gracefully
// to the card's CSS placeholder.
function _safeCoverImage(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    return '';
  }
  if (parsed.protocol !== 'https:') return '';
  const host = parsed.hostname.toLowerCase();
  const allowed = COVER_CDN_HOSTS.some((domain) => host === domain || host.endsWith('.' + domain));
  return allowed ? value : '';
}

// Map one upstream video object to the OmniStore Reels item shape. Only
// display metadata survives; embed_html is intentionally dropped.
function normalizeVideo(video) {
  if (!video || typeof video !== 'object') return null;
  const id = String(video.id || '').trim();
  if (!id) return null;

  // embed_link is a tiktok.com embed URL, not a media file. When TikTok omits
  // it we rebuild the documented Embed Player URL from the post id, which
  // avoids depending on remote HTML and is the reason the Reels UI can render
  // a player without injecting arbitrary third-party markup.
  const embedLink = String(video.embed_link || '').trim() ||
    ('https://www.tiktok.com/player/v1/' + encodeURIComponent(id));
  const shareUrl = String(video.share_url || '').trim() ||
    ('https://www.tiktok.com/@i/video/' + encodeURIComponent(id));

  const createTime = Number(video.create_time);
  return {
    id,
    title: String(video.title || ''),
    description: String(video.video_description || ''),
    duration: Number.isFinite(Number(video.duration)) ? Number(video.duration) : 0,
    coverImage: _safeCoverImage(video.cover_image_url),
    shareUrl,
    embedUrl: embedLink,
    // epoch seconds -> ISO string, so the UI never has to guess the unit
    createdAt: Number.isFinite(createTime) && createTime > 0
      ? new Date(createTime * 1000).toISOString()
      : null
  };
}

// POST /v2/video/list/ — the authorized account's PUBLIC videos, newest
// first, cursor paginated. Returns normalized items plus the cursor so the
// caller can persist it for incremental sync.
async function listVideos(options) {
  const opts = options || {};
  if (!connection.isConnected()) {
    return { ok: false, code: 'not_connected', items: [], cursor: null, hasMore: false };
  }
  const token = await _getValidAccessToken();
  if (!token) return { ok: false, code: 'not_connected', items: [], cursor: null, hasMore: false };
  if (!_consumeRateBudget()) {
    return { ok: false, code: 'rate_limited', items: [], cursor: null, hasMore: false };
  }

  const maxCount = Math.min(
    Math.max(1, parseInt(opts.maxCount, 10) || config.VIDEO_LIST_DEFAULT_COUNT),
    config.VIDEO_LIST_MAX_COUNT
  );
  const payload = { max_count: maxCount };
  // cursor is a UTC epoch-millisecond timestamp: pass the last seen create_time
  // back to fetch only videos posted after it.
  if (opts.cursor !== undefined && opts.cursor !== null && String(opts.cursor) !== '') {
    payload.cursor = String(opts.cursor);
  }

  let res;
  try {
    res = await fetch(config.VIDEO_LIST_URL + '?fields=' + config.VIDEO_FIELDS.join(','), {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    logger.warn('tiktokDisplayApi: video list request failed: ' + (err && err.message));
    return { ok: false, code: 'network_error', items: [], cursor: null, hasMore: false, message: 'Could not reach TikTok' };
  }

  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}

  if (!res.ok || !data) {
    return _tiktokError({ ok: false, status: res.status, data: data || {} });
  }
  const err = data.error || {};
  if (err.code && err.code !== 'ok') {
    return _tiktokError({ ok: false, status: res.status, data });
  }

  const videos = (data.data && Array.isArray(data.data.videos)) ? data.data.videos : [];
  const items = [];
  for (const video of videos) {
    const normalized = normalizeVideo(video);
    if (normalized) items.push(normalized);
  }
  return {
    ok: true,
    items,
    cursor: (data.data && data.data.cursor !== undefined) ? data.data.cursor : null,
    hasMore: Boolean(data.data && data.data.has_more)
  };
}

async function revokeAccess() {
  const token = connection.getAccessToken();
  if (token && config.isFullyConfigured()) {
    try {
      await _postForm(config.REVOKE_URL, {
        client_key: config.getClientKey(),
        client_secret: config.getClientSecret(),
        token
      });
    } catch (err) {
      // Revocation is best-effort; the local record is cleared regardless.
      logger.warn('tiktokDisplayApi: revoke request failed: ' + (err && err.message));
    }
  }
  connection.clearConnection();
  return { ok: true };
}

// Test seam: reset the local rate budget between cases.
function _resetRateBudget() {
  _rate.windowStart = Date.now();
  _rate.count = 0;
}

module.exports = {
  exchangeCodeForTokens,
  refreshAccessToken,
  getAuthorizedAccount,
  listVideos,
  revokeAccess,
  normalizeVideo,
  _resetRateBudget
};

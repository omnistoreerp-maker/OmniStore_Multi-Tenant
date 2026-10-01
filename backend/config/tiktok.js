'use strict';

// TikTok Display API configuration.
//
// SECURITY CONTRACT for this module:
//   - Secrets (clientSecret, accessToken, refreshToken) are read from the
//     process environment ONLY. Nothing here is ever serialized into an API
//     response, a log line, or a file under version control.
//   - getPublicConfig() is the ONLY shape allowed to leave the backend. It
//     deliberately omits every secret and returns booleans instead.
//   - Token values are additionally never returned by the token service; the
//     Reels feed and the connection-status endpoint both read booleans.
//
// Official references (TikTok for Developers):
//   Login Kit (web)     https://developers.tiktok.com/doc/login-kit-web
//   Display API         https://developers.tiktok.com/doc/display-api-get-started
//   Access token mgmt   https://developers.tiktok.com/doc/oauth-user-access-token-management
//   List Videos         https://developers.tiktok.com/doc/tiktok-api-v2-video-list
//   Rate limits         https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit

const DEFAULT_API_BASE = 'https://open.tiktokapis.com';
const DEFAULT_AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const DEFAULT_TOKEN_URL = DEFAULT_API_BASE + '/v2/oauth/token/';
const DEFAULT_REVOKE_URL = DEFAULT_API_BASE + '/v2/oauth/revoke/';
const DEFAULT_USER_INFO_URL = DEFAULT_API_BASE + '/v2/user/info/';
const DEFAULT_VIDEO_LIST_URL = DEFAULT_API_BASE + '/v2/video/list/';

// Scopes OmniStore requests. user.info.basic is granted by default with
// Login Kit and is used only for the "which account is connected" diagnostic.
// video.list is the scope that reads the authorized account's PUBLIC videos.
const REQUIRED_SCOPES = ['user.info.basic', 'video.list'];

// TikTok documents expires_in = 86400s (24h) for the access token and
// refresh_expires_in = 31536000s (365d) for the refresh token. Refresh a
// little early so a sync never races an already-expired access token.
const ACCESS_TOKEN_TTL_SECONDS = 86400;
const REFRESH_TOKEN_TTL_SECONDS = 31536000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;

// List Videos: default page size 10, documented maximum 20.
const VIDEO_LIST_MAX_COUNT = 20;
const VIDEO_LIST_DEFAULT_COUNT = 10;

// Documented rate limit: 600 requests per one-minute sliding window for
// /v2/video/list/ and /v2/user/info/. Throttled calls answer HTTP 429 with
// error code rate_limit_exceeded.
const RATE_LIMIT_PER_MINUTE = 600;

// Outbound request timeout. TikTok's own docs warn that endpoints can stall
// behind CDN edge; a hung upstream must never pin a request indefinitely.
// Bounded and short enough that a single slow TikTok edge cannot block the
// sync path. Node 24 supports AbortSignal.timeout() natively.
const REQUEST_TIMEOUT_MS = 10000;

// Fields OmniStore keeps for the Reels UI. Deliberately metadata-only: TikTok
// exposes no playable media file through the Display API, so nothing here is
// an MP4 URL and nothing is proxied or re-hosted by OmniStore.
const VIDEO_FIELDS = [
  'id',
  'create_time',
  'title',
  'video_description',
  'duration',
  'cover_image_url',
  'share_url',
  'embed_link'
];

function _trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// The redirect URI is registered in the TikTok Developer Portal and MUST be a
// static absolute https URL: max 10 registered, <512 chars, no query string,
// no fragment. The backend validates the shape it is given so a malformed
// value fails closed with an actionable message instead of producing an OAuth
// request TikTok will reject opaquely.
function validateRedirectUri(value) {
  const uri = _trim(value);
  if (!uri) return { valid: false, reason: 'TIKTOK_REDIRECT_URI is not configured' };
  if (uri.length >= 512) return { valid: false, reason: 'TIKTOK_REDIRECT_URI must be shorter than 512 characters' };
  if (!/^https:\/\//i.test(uri)) return { valid: false, reason: 'TIKTOK_REDIRECT_URI must be an absolute https URL' };
  if (uri.includes('#')) return { valid: false, reason: 'TIKTOK_REDIRECT_URI must not contain a fragment (#)' };
  if (/[?&]/.test(uri.slice(uri.indexOf('://') + 3))) {
    return { valid: false, reason: 'TIKTOK_REDIRECT_URI must be static and must not contain a query string' };
  }
  return { valid: true, uri };
}

function isEnabled() {
  return Boolean(_trim(process.env.TIKTOK_CLIENT_KEY));
}

function isFullyConfigured() {
  return Boolean(
    _trim(process.env.TIKTOK_CLIENT_KEY) &&
    _trim(process.env.TIKTOK_CLIENT_SECRET) &&
    _trim(process.env.TIKTOK_REDIRECT_URI)
  );
}

function getClientKey() {
  return _trim(process.env.TIKTOK_CLIENT_KEY);
}

function getClientSecret() {
  return _trim(process.env.TIKTOK_CLIENT_SECRET);
}

function getScopes() {
  // A caller may narrow the scope set, but video.list is the whole point of
  // the feature and is never dropped.
  const raw = _trim(process.env.TIKTOK_REELS_SCOPES);
  if (!raw) return REQUIRED_SCOPES.slice();
  const requested = raw.split(',').map(s => s.trim()).filter(Boolean);
  return requested.includes('video.list') ? requested : REQUIRED_SCOPES.slice();
}

// getPublicConfig is the ONLY export that is safe to serialize. It reports
// configuration state as booleans and never reveals a secret, a token, or
// even the registered client key (which is half of the OAuth credential pair).
function getPublicConfig() {
  const redirect = validateRedirectUri(process.env.TIKTOK_REDIRECT_URI);
  return {
    enabled: isEnabled(),
    configured: isFullyConfigured(),
    // The redirect URI is public by nature (it is the URL the browser is sent
    // back to) but it is still omitted here: it is not needed by any client,
    // and keeping the diagnostic payload minimal is the safer default.
    redirectUriValid: redirect.valid,
    redirectUriProblem: redirect.valid ? null : redirect.reason,
    scopes: getScopes()
  };
}

module.exports = {
  API_BASE: DEFAULT_API_BASE,
  AUTHORIZE_URL: process.env.TIKTOK_AUTHORIZE_URL || DEFAULT_AUTHORIZE_URL,
  TOKEN_URL: process.env.TIKTOK_TOKEN_URL || DEFAULT_TOKEN_URL,
  REVOKE_URL: process.env.TIKTOK_REVOKE_URL || DEFAULT_REVOKE_URL,
  USER_INFO_URL: process.env.TIKTOK_USER_INFO_URL || DEFAULT_USER_INFO_URL,
  VIDEO_LIST_URL: process.env.TIKTOK_VIDEO_LIST_URL || DEFAULT_VIDEO_LIST_URL,
  REQUIRED_SCOPES,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  REFRESH_SKEW_MS,
  VIDEO_LIST_MAX_COUNT,
  VIDEO_LIST_DEFAULT_COUNT,
  RATE_LIMIT_PER_MINUTE,
  REQUEST_TIMEOUT_MS,
  VIDEO_FIELDS,
  isEnabled,
  isFullyConfigured,
  getClientKey,
  getClientSecret,
  getScopes,
  getPublicConfig,
  validateRedirectUri
};

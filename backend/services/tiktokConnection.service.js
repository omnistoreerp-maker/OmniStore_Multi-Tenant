'use strict';

// Server-side TikTok OAuth token lifecycle.
//
// SECURITY CONTRACT:
//   - Tokens are read from the environment on boot and written to the
//     token store; they are never returned to a browser, never placed in a
//     response body, and never logged. logger calls in this file reference
//     only non-secret identifiers (open_id, status flags, error codes).
//   - The stored record holds the tokens. The functions that consume it return
//     a token ONLY to the Display API service, which sends it upstream in an
//     Authorization header. Every other caller gets a status shape.
//
// Store layout (backend/data/tiktokConnection.json, gitignored):
//   { connectedAt, openId, displayName, username, avatarUrl, profileDeepLink,
//     scope, accessToken, refreshToken, accessTokenExpiresAt,
//     refreshTokenExpiresAt }
//
// The authorized TikTok account — not a hardcoded handle — is the source of
// truth for identity. getStatus().username is read from the account itself via
// /v2/user/info/ after a successful exchange.

const fs = require('fs');
const crypto = require('crypto');
const fileStore = require('../utils/fileStore');
const logger = require('../utils/logger');
const config = require('../config/tiktok');

const STORE = 'tiktokConnection';

// OAuth state values are short-lived and single-use. They live in module
// memory rather than the token store: a state value is a CSRF nonce, not a
// durable credential, and keeping it out of disk means a restarted process
// invalidates any in-flight authorization rather than leaving a reusable one
// behind. A restart therefore forces the user to press Connect again, which is
// the safe failure direction.
const STATE_TTL_MS = 10 * 60 * 1000;
const _pendingStates = new Map();

function _now() {
  return Date.now();
}

function _emptyRecord() {
  return {
    connectedAt: null,
    openId: '',
    displayName: '',
    username: '',
    avatarUrl: '',
    profileDeepLink: '',
    scope: '',
    accessToken: '',
    refreshToken: '',
    accessTokenExpiresAt: 0,
    refreshTokenExpiresAt: 0
  };
}

function _read() {
  const raw = fileStore.readRaw(STORE);
  if (!raw || typeof raw !== 'object') return _emptyRecord();
  return Object.assign(_emptyRecord(), raw);
}

function _write(record) {
  const ok = fileStore.write(STORE, record);
  // Token-at-rest hardening: tighten the connection file to owner-only
  // permissions where the platform supports it (0600 on POSIX; a no-op
  // beyond the read-only bit on Windows). Best-effort: a chmod failure
  // must never block a token write, so it is swallowed.
  if (ok) {
    try { fs.chmodSync(fileStore._path(STORE), 0o600); } catch (_) {}
  }
  return ok;
}

// Public, secret-free view of the connection. This is the ONLY shape the
// diagnostics endpoint is allowed to return.
function getStatus() {
  const record = _read();
  const now = _now();
  const connected = Boolean(record.accessToken || record.refreshToken);
  let tokenState = 'none';
  if (connected) {
    if (record.accessTokenExpiresAt && record.accessTokenExpiresAt <= now) tokenState = 'expired';
    else if (record.refreshTokenExpiresAt && record.refreshTokenExpiresAt <= now) tokenState = 'refresh_expired';
    else tokenState = 'active';
  }
  return {
    connected,
    // identity, never credentials
    openId: record.openId || null,
    displayName: record.displayName || null,
    username: record.username || null,
    avatarUrl: record.avatarUrl || null,
    profileDeepLink: record.profileDeepLink || null,
    scope: record.scope || null,
    connectedAt: record.connectedAt || null,
    tokenState,
    accessTokenExpiresAt: record.accessTokenExpiresAt || null,
    refreshTokenExpiresAt: record.refreshTokenExpiresAt || null,
    config: config.getPublicConfig()
  };
}

function isConnected() {
  const record = _read();
  return Boolean(record.accessToken || record.refreshToken);
}

function saveConnection(tokens, identity) {
  // TikTok returns expires_in / refresh_expires_in in SECONDS. The stored
  // timestamps are epoch MILLISECONDS so they compare directly against
  // Date.now(). Converting once, here, keeps the units unambiguous.
  const nowMs = _now();
  const previous = _read();
  // TikTok may rotate the refresh token on every exchange. A missing
  // refresh_token in the response means "keep using the current one".
  const refreshToken = tokens.refresh_token || previous.refreshToken || '';
  const record = {
    connectedAt: previous.connectedAt || new Date(nowMs).toISOString(),
    openId: String((identity && identity.open_id) || previous.openId || ''),
    displayName: String((identity && identity.display_name) || previous.displayName || ''),
    username: String((identity && identity.username) || previous.username || ''),
    avatarUrl: String((identity && identity.avatar_url) || previous.avatarUrl || ''),
    profileDeepLink: String((identity && identity.profile_deep_link) || previous.profileDeepLink || ''),
    scope: String(tokens.scope || previous.scope || ''),
    accessToken: String(tokens.access_token || ''),
    refreshToken: String(refreshToken),
    accessTokenExpiresAt: tokens.expires_in
      ? nowMs + Number(tokens.expires_in) * 1000
      : (previous.accessTokenExpiresAt || 0),
    refreshTokenExpiresAt: tokens.refresh_expires_in
      ? nowMs + Number(tokens.refresh_expires_in) * 1000
      : (previous.refreshTokenExpiresAt || 0)
  };
  _write(record);
  logger.info('tiktokConnection: account connected (open_id present: ' + Boolean(record.openId) + ')');
  return getStatus();
}

function clearConnection() {
  _write(_emptyRecord());
  logger.info('tiktokConnection: account disconnected');
  return getStatus();
}

function updateIdentity(identity) {
  const record = _read();
  record.openId = String(identity.open_id || record.openId || '');
  record.displayName = String(identity.display_name || record.displayName || '');
  record.username = String(identity.username || record.username || '');
  record.avatarUrl = String(identity.avatar_url || record.avatarUrl || '');
  record.profileDeepLink = String(identity.profile_deep_link || record.profileDeepLink || '');
  _write(record);
  return getStatus();
}

// INTERNAL ONLY. Returns the access token for an upstream Authorization
// header. Callers must not place the result in any response body.
function getAccessToken() {
  const record = _read();
  if (!record.accessToken) return null;
  if (record.accessTokenExpiresAt && record.accessTokenExpiresAt <= _now() + config.REFRESH_SKEW_MS) {
    return null; // stale; caller must refresh
  }
  return record.accessToken;
}

function getRefreshToken() {
  const record = _read();
  if (!record.refreshToken) return null;
  if (record.refreshTokenExpiresAt && record.refreshTokenExpiresAt <= _now()) return null;
  return record.refreshToken;
}

// ---------------------------------------------------------------------------
// OAuth state (CSRF protection)
// ---------------------------------------------------------------------------

function createState(owner) {
  // Random, unguessable, URL-safe. Never derived from anything predictable.
  const state = crypto.randomBytes(24).toString('hex');
  _pruneStates();
  // Bind the flow to the platform admin who started it. The callback is a
  // cross-site redirect from TikTok, so state alone proves only that the code
  // matches a flow we minted; the owner binding proves the flow belongs to the
  // administrator who initiated it, not to anyone who intercepted the URL.
  _pendingStates.set(state, { createdAt: _now(), owner: owner || null });
  return state;
}

function _pruneStates() {
  const cutoff = _now() - STATE_TTL_MS;
  for (const [key, value] of _pendingStates) {
    if (!value || value.createdAt < cutoff) _pendingStates.delete(key);
  }
}

function consumeState(state, owner) {
  _pruneStates();
  if (!state) return false;
  const entry = _pendingStates.get(state);
  // Single-use: delete before validating the result so a replayed state fails
  // even on the first attempt.
  _pendingStates.delete(state);
  if (!entry) return false;
  // A flow minted for one administrator cannot be completed by another (or by
  // nobody). When an owner was recorded, the redeeming caller must match it.
  if (entry.owner && entry.owner !== (owner || null)) return false;
  return true;
}

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_key: config.getClientKey(),
    response_type: 'code',
    scope: config.getScopes().join(','),
    redirect_uri: String(process.env.TIKTOK_REDIRECT_URI || '').trim(),
    state
  });
  return config.AUTHORIZE_URL + '?' + params.toString();
}

module.exports = {
  getStatus,
  isConnected,
  saveConnection,
  clearConnection,
  updateIdentity,
  // internal use only — see the security contract above
  getAccessToken,
  getRefreshToken,
  createState,
  consumeState,
  buildAuthorizeUrl
};

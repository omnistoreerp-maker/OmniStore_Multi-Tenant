const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const oauthConfig = require('../config/oauth');
const usersService = require('./users.service');
const logger = require('../utils/logger');

// Server-side OpenID Connect for the Regular User Google sign-in path.
// The browser only ever round-trips to Google; the authorization code is
// exchanged HERE and the resulting ID token is verified with the trusted
// google-auth-library (signature, issuer, audience, expiry) plus our own
// nonce check. Nothing about identity is ever taken from the client.
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const REGULAR_SCOPE = 'openid email profile';

function isConfigured() {
  const g = oauthConfig.providers && oauthConfig.providers.google;
  return !!(oauthConfig.enabled && g && g.enabled && g.clientID && g.clientSecret && oauthConfig.providers.google.callbackURL);
}

function _fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function _sha256b64url(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function _sha256hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const BROWSER_BINDING_COOKIE = 'glogin_bs';
const BROWSER_BINDING_PATH = '/';

function _safeReturnTo(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text.startsWith('/') || text.startsWith('//') || /[\\\u0000-\u001f]/.test(text) || text.startsWith(BROWSER_BINDING_PATH)) return '/';
  return text;
}

// Builds the Google authorization URL. The state is a high-entropy opaque
// value; the nonce, PKCE verifier, returnTo and expiry are stored SERVER-SIDE
// in an atomic SQLite transaction alongside a hash of the initiating browser's
// random binding secret. Only the hash is bound into the signed state so the
// browser cookie and server row must both be present at callback.
function createLoginStart({ returnTo = '/', db, browserBinding } = {}) {
  if (!isConfigured()) throw _fail('not_configured', 'Google sign-in is not configured');
  if (!db || typeof db.prepare !== 'function') throw _fail('storage_unavailable', 'Login transaction store unavailable');
  if (typeof browserBinding !== 'string' || !browserBinding) throw _fail('browser_binding_required', 'Browser binding is required');

  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(18).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const safeReturnTo = _safeReturnTo(returnTo);
  const transaction = require('../utils/challengeStore.sqlite');
  transaction.persistOAuthLoginTransaction(db, {
    state,
    browserBindingHash: _sha256hex(browserBinding),
    payload: { mode: 'login', nonce, verifier, returnTo: safeReturnTo },
    ttlMs: require('../utils/oauthState').STATE_TTL_MS
  });

  const params = new URLSearchParams({
    client_id: oauthConfig.providers.google.clientID,
    redirect_uri: oauthConfig.providers.google.callbackURL,
    response_type: 'code',
    scope: REGULAR_SCOPE,
    state,
    nonce,
    code_challenge: _sha256b64url(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account'
  });
  return {
    url: AUTH_ENDPOINT + '?' + params.toString(),
    browserBinding,
    browserBindingCookie: BROWSER_BINDING_COOKIE,
    browserBindingPath: BROWSER_BINDING_PATH
  };
}

function consumeLoginTransaction(db, state, browserBinding) {
  const transaction = require('../utils/challengeStore.sqlite');
  const result = transaction.consumeOAuthLoginTransaction(db, {
    state,
    browserBindingHash: _sha256hex(browserBinding || '')
  });
  if (!result || !result.consumed) {
    throw _fail(result && result.reason === 'browser_binding_mismatch' ? 'browser_binding_mismatch' : 'state_invalid', 'OAuth login transaction is invalid, expired, mismatched or already consumed');
  }
  const payload = result.payload || {};
  if (payload.mode !== 'login' || !payload.nonce || !payload.verifier) {
    throw _fail('state_invalid', 'OAuth login transaction payload is invalid');
  }
  return payload;
}

// Exchanges the authorization code (plus PKCE verifier) directly with
// Google. Errors carry stable codes the controller maps to safe redirects.
async function exchangeCode(code, codeVerifier) {
  if (!isConfigured()) throw _fail('not_configured', 'Google sign-in is not configured');
  const g = oauthConfig.providers.google;
  let res;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: g.clientID,
        client_secret: g.clientSecret,
        redirect_uri: oauthConfig.providers.google.callbackURL,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier ? String(codeVerifier) : ''
      }).toString()
    });
  } catch (_) {
    throw _fail('provider_error', 'Google token endpoint unreachable');
  }
  if (!res || !res.ok) {
    throw _fail('exchange_failed', 'Google code exchange failed');
  }
  let json;
  try {
    json = await res.json();
  } catch (_) {
    throw _fail('exchange_failed', 'Google token response malformed');
  }
  if (!json || typeof json.id_token !== 'string' || !json.id_token) {
    throw _fail('exchange_failed', 'Google returned no ID token');
  }
  return json.id_token;
}

// Trusted verification: google-auth-library checks the RS256 signature
// against Google's JWKS, plus issuer and audience. We then re-check aud,
// iss and exp defensively and match the nonce we issued. The raw token is
// never logged.
async function verifyGoogleIdToken(idToken, expectedNonce) {
  if (!isConfigured()) throw _fail('not_configured', 'Google sign-in is not configured');
  const g = oauthConfig.providers.google;
  let payload;
  try {
    const client = new OAuth2Client(g.clientID);
    const ticket = await client.verifyIdToken({ idToken: String(idToken), audience: g.clientID });
    payload = ticket.getPayload();
  } catch (err) {
    logger.warn('googleAuthCode: ID token verification failed:', err && err.message);
    throw _fail('invalid_idtoken', 'Google ID token verification failed');
  }
  if (!payload || !payload.sub) throw _fail('invalid_idtoken', 'Google ID token has no subject');
  if (!ISSUERS.has(String(payload.iss))) throw _fail('invalid_idtoken', 'Google ID token issuer mismatch');
  if (String(payload.aud || '') !== String(g.clientID)) throw _fail('invalid_idtoken', 'Google ID token audience mismatch');
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) throw _fail('invalid_idtoken', 'Google ID token expired');
  if (expectedNonce !== undefined && expectedNonce !== null && expectedNonce !== '') {
    if (!payload.nonce || String(payload.nonce) !== String(expectedNonce)) {
      throw _fail('nonce_mismatch', 'Google ID token nonce mismatch');
    }
  }
  return {
    sub: String(payload.sub),
    email: payload.email ? String(payload.email) : null,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: payload.name ? String(payload.name) : null
  };
}

// The ONLY login lookup: the Google sub bound to a local user. There is
// deliberately no email-based resolution on this path — email matching can
// never authenticate or link anyone here.
function findUserByGoogleSub(sub) {
  if (!sub) return null;
  const needle = String(sub);
  let page = 1;
  for (;;) {
    const result = usersService.list({ page, limit: 100 });
    const users = (result && result.users) || [];
    const hit = users.find((u) => u && u.oauth && String(u.oauth.google || '') === needle);
    if (hit) return hit;
    if (page >= (result && result.totalPages ? result.totalPages : 1)) return null;
    page += 1;
  }
}

module.exports = {
  isConfigured,
  createLoginStart,
  consumeLoginTransaction,
  exchangeCode,
  verifyGoogleIdToken,
  findUserByGoogleSub,
  BROWSER_BINDING_COOKIE,
  BROWSER_BINDING_PATH,
  hashBrowserBinding: _sha256hex
};
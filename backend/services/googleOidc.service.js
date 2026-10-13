const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const oauthConfig = require('../config/oauth');
const usersService = require('./users.service');
const oauthState = require('../utils/oauthState');
const logger = require('../utils/logger');

// Server-side OpenID Connect for the Platform Master Google sign-in path.
// The browser only ever round-trips to Google; the authorization code is
// exchanged HERE and the resulting ID token is verified with the trusted
// google-auth-library (signature, issuer, audience, expiry) plus our own
// nonce check. Nothing about identity is ever taken from the client.
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const MASTER_SCOPE = 'openid email profile';

function isConfigured() {
  const g = oauthConfig.providers && oauthConfig.providers.google;
  return !!(oauthConfig.enabled && g && g.enabled && g.clientID && g.clientSecret && oauthConfig.master && oauthConfig.master.callbackURL);
}

function _fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function _sha256b64url(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

// Builds the Google authorization URL for a fresh attempt: single-use
// signed state, a nonce bound into that state (echoed in the ID token),
// and PKCE (S256) so a stolen code is useless without the verifier.
function createLoginStart({ mode = 'login', returnTo = '/', username } = {}) {
  if (!isConfigured()) throw _fail('not_configured', 'Google sign-in is not configured');
  const nonce = crypto.randomBytes(18).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const state = oauthState.issue({
    mode: mode === 'link' ? 'link' : 'login',
    returnTo: String(returnTo || '/'),
    nonce,
    cv: verifier,
    ...(username ? { u: String(username) } : {})
  });
  const params = new URLSearchParams({
    client_id: oauthConfig.providers.google.clientID,
    redirect_uri: oauthConfig.master.callbackURL,
    response_type: 'code',
    scope: MASTER_SCOPE,
    state,
    nonce,
    code_challenge: _sha256b64url(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account'
  });
  return { url: AUTH_ENDPOINT + '?' + params.toString() };
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
        redirect_uri: oauthConfig.master.callbackURL,
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
    logger.warn('googleOidc: ID token verification failed:', err && err.message);
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
  exchangeCode,
  verifyGoogleIdToken,
  findUserByGoogleSub
};

'use strict';

// Google identity verification.
//
// Account linking must never trust a `sub` supplied by the browser: an
// attacker could otherwise claim someone else's Google identity. The client
// therefore sends the Google-issued ID token, and this module verifies it with
// Google's tokeninfo endpoint before the subject is used.
//
// Tests replace the HTTP response (global fetch) while exercising this module
// for real, so audience/issuer/expiry/email policy is always the code under
// test.

const DEFAULT_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const TIMEOUT_MS = 5000;

function _tokeninfoUrl(idToken) {
  const base = process.env.GOOGLE_TOKENINFO_URL || DEFAULT_TOKENINFO_URL;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}id_token=${encodeURIComponent(idToken)}`;
}

async function verifyIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    return { error: 'Google idToken is required' };
  }

  // Fail closed and avoid an external call when linking is not configured.
  const expectedAudience = process.env.GOOGLE_CLIENT_ID;
  if (!expectedAudience) {
    return { error: 'Google linking is not configured', statusCode: 503 };
  }

  let response;
  try {
    response = await fetch(_tokeninfoUrl(idToken), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (_) {
    return { error: 'Google token verification unavailable' };
  }

  if (!response.ok) return { error: 'Invalid Google token' };

  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    return { error: 'Invalid Google token' };
  }

  if (!payload || typeof payload !== 'object') {
    return { error: 'Invalid Google token' };
  }

  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.trim() === '') {
    return { error: 'Invalid Google token subject' };
  }

  const issuer = payload.iss;
  if (issuer !== 'accounts.google.com' && issuer !== 'https://accounts.google.com') {
    return { error: 'Invalid Google token issuer' };
  }

  if (payload.aud !== expectedAudience) {
    return { error: 'Invalid Google token audience' };
  }

  // tokeninfo already rejects expired tokens with a non-2xx status; enforce
  // expiry locally as well so a cached/proxied/misbehaving endpoint cannot
  // keep an expired identity valid.
  const expiresAt = Number(payload.exp);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) {
    return { error: 'Google token expired' };
  }

  if (payload.email_verified !== true && payload.email_verified !== 'true') {
    return { error: 'Google email is not verified' };
  }

  return { sub: payload.sub.trim(), email: payload.email || null };
}

module.exports = { verifyIdToken };

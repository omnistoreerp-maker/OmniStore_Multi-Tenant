const passport = require('passport');
const crypto = require('crypto');
const { signAccessToken, signRefreshToken } = require('../utils/jwt');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const oauthConfig = require('../config/oauth');
const config = require('../config');
const tokenStore = require('../utils/tokenStore.sqlite');

const IS_PROD = (process.env.NODE_ENV || 'development') === 'production';

function _setAuthCookies(res, accessToken, refreshToken) {
  const base = { httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/' };
  res.cookie('access_token', accessToken, { ...base, maxAge: 15 * 60 * 1000 });
  res.cookie('refresh_token', refreshToken, { ...base, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

function issueTokens(user, tenantId) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + config.jwtRefreshTtlMs || (issuedAt + 7 * 24 * 60 * 60 * 1000);
  const jti = crypto.randomUUID();

  const tokenIdentity = tenantId ? { ...user, tenantId } : user;

  // Create session family first (required for FK constraint)
  const { familyId } = tokenStore.createSessionFamily(user.id, tenantId);

  tokenStore.issueRefreshToken(jti, {
    jti,
    familyId,
    sub: user.id,
    ver: user.tokenVersion || 0,
    tenantId,
    issuedAt,
    expiresAt
  });

  const accessToken = signAccessToken({ ...tokenIdentity, familyId });
  const refreshToken = signRefreshToken({ ...tokenIdentity, familyId, jti });
  return { accessToken, refreshToken };
}

function initiateGoogle(req, res, next) {
  if (!oauthConfig.providers.google.enabled) {
    return error(res, 'Google OAuth is not configured', 501);
  }
  passport.authenticate('google', {
    scope: oauthConfig.providers.google.scope,
    session: false,
    state: req.query.returnTo || '/'
  })(req, res, next);
}

function callbackGoogle(req, res, next) {
  if (!oauthConfig.providers.google.enabled) {
    return error(res, 'Google OAuth is not configured', 501);
  }
  passport.authenticate('google', { session: false }, (err, user, info) => {
    if (err) {
      logger.error('Google OAuth callback error:', err.message);
      return error(res, 'Google authentication failed', 500);
    }
    if (!user) {
      const message = info?.message || 'Google authentication failed';
      return error(res, message, 401);
    }
    try {
      const { accessToken, refreshToken } = issueTokens(user);
      _setAuthCookies(res, accessToken, refreshToken);
      success(res, { user, accessToken, refreshToken }, 'Google OAuth login successful');
    } catch (tokenErr) {
      logger.error('Google OAuth token signing error:', tokenErr.message);
      return error(res, 'Failed to generate tokens', 500);
    }
  })(req, res, next);
}

function initiateGithub(req, res, next) {
  if (!oauthConfig.providers.github.enabled) {
    return error(res, 'GitHub OAuth is not configured', 501);
  }
  passport.authenticate('github', {
    scope: oauthConfig.providers.github.scope,
    session: false,
    state: req.query.returnTo || '/'
  })(req, res, next);
}

function callbackGithub(req, res, next) {
  if (!oauthConfig.providers.github.enabled) {
    return error(res, 'GitHub OAuth is not configured', 501);
  }
  passport.authenticate('github', { session: false }, (err, user, info) => {
    if (err) {
      logger.error('GitHub OAuth callback error:', err.message);
      return error(res, 'GitHub authentication failed', 500);
    }
    if (!user) {
      const message = info?.message || 'GitHub authentication failed';
      return error(res, message, 401);
    }
    try {
      const { accessToken, refreshToken } = issueTokens(user);
      _setAuthCookies(res, accessToken, refreshToken);
      success(res, { user, accessToken, refreshToken }, 'GitHub OAuth login successful');
    } catch (tokenErr) {
      logger.error('GitHub OAuth token signing error:', tokenErr.message);
      return error(res, 'Failed to generate tokens', 500);
    }
  })(req, res, next);
}

function getProviders(req, res) {
  const providers = [];
  if (oauthConfig.providers.google.enabled) {
    providers.push({ name: 'google', displayName: 'Google' });
  }
  if (oauthConfig.providers.github.enabled) {
    providers.push({ name: 'github', displayName: 'GitHub' });
  }
  success(res, { providers }, 'OAuth providers retrieved');
}

module.exports = {
  initiateGoogle,
  callbackGoogle,
  initiateGithub,
  callbackGithub,
  getProviders
};

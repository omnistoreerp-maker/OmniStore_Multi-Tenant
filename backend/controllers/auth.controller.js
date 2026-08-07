const usersService = require('../services/users.service');
const mfaService = require('../services/mfa.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { revokeToken, isRevoked } = require('../utils/tokenStore');
const { extractToken, parseCookies } = require('../middleware/auth');

const KNOWN_ROLES = ['Owner', 'Admin', 'Manager', 'Cashier', 'Technician', 'WarehouseSales'];
const IS_PROD = (process.env.NODE_ENV || 'development') === 'production';

// Phase 22B: only the account owner, or Owner/Admin users, may view a
// specific user's record through the username-lookup endpoints. This closes
// the unauthenticated enumeration path that returned 200-vs-404 by username.
function _canViewUser(requester, username) {
  if (!requester) return false;
  if (String(username) === String(requester.username)) return true;
  return requester.role === 'Owner' || requester.role === 'Admin';
}

function _setAuthCookies(res, accessToken, refreshToken) {
  const base = { httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/' };
  res.cookie('access_token', accessToken, { ...base, maxAge: 15 * 60 * 1000 });
  res.cookie('refresh_token', refreshToken, { ...base, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

function _clearAuthCookies(res) {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/' });
}

function login(req, res) {
  try {
    const { username, password, mfaToken } = req.body || {};
    if (!username || password === undefined || password === null) return error(res, 'username and password are required', 400);
    const user = usersService.authenticate(username, password);
    if (!user) return error(res, 'Invalid username or password', 401);

    if (user.mfaEnabled) {
      if (!mfaToken) {
        const tempToken = signAccessToken({ ...user, mfaPending: true }, '5m');
        return success(res, {
          mfaRequired: true,
          tempToken,
          userId: user.id,
          message: 'MFA verification required'
        }, 'MFA required');
      }

      const mfaResult = mfaService.verifyLogin(user.id, mfaToken);
      if (mfaResult.error || !mfaResult.verified) {
        return error(res, 'Invalid MFA code', 401);
      }
    }

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    _setAuthCookies(res, accessToken, refreshToken);
    success(res, { user: usersService.sanitizeUser(user), accessToken, refreshToken }, 'Login successful');
  } catch (err) {
    logger.error('auth.login error:', err.message);
    error(res, 'Failed to login', 500);
  }
}

function refresh(req, res) {
  try {
    const token = (req.body && req.body.refreshToken) || parseCookies(req).refresh_token;
    if (!token) return error(res, 'refreshToken is required', 400);
    if (isRevoked(token)) return error(res, 'Refresh token has been revoked', 401);
    const payload = verifyRefreshToken(token);
    if (!payload) return error(res, 'Invalid or expired refresh token', 401);
    const user = usersService.getById(payload.sub);
    if (!user) return error(res, 'User not found', 401);
    const accessToken = signAccessToken(user);
    res.cookie('access_token', accessToken, { httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/', maxAge: 15 * 60 * 1000 });
    success(res, { accessToken }, 'Token refreshed');
  } catch (err) {
    logger.error('auth.refresh error:', err.message);
    error(res, 'Failed to refresh token', 500);
  }
}

function logout(req, res) {
  try {
    const accessToken = extractToken(req);
    const refreshToken = (req.body && req.body.refreshToken) || parseCookies(req).refresh_token;
    if (accessToken) revokeToken(accessToken);
    if (refreshToken) revokeToken(refreshToken);
    _clearAuthCookies(res);
    success(res, null, 'Logout successful');
  } catch (err) {
    logger.error('auth.logout error:', err.message);
    error(res, 'Failed to logout', 500);
  }
}

function me(req, res) {
  try {
    if (req.user) {
      const username = req.query.username;
      if (username && String(username) !== String(req.user.username) && req.user.role !== 'Owner' && req.user.role !== 'Admin') {
        return error(res, 'Insufficient permission', 403);
      }
      const user = username ? usersService.getByUsername(username) : usersService.getById(req.user.id);
      if (!user) return error(res, 'User not found', 404);
      return success(res, { user: usersService.sanitizeUser(user) }, 'Current user retrieved');
    }
    const username = req.query.username;
    if (!username) return error(res, 'username is required', 400);
    // Phase 22B: username lookup requires authentication (closes enumeration).
    return error(res, 'Authentication required', 401);
  } catch (err) {
    logger.error('auth.me error:', err.message);
    error(res, 'Failed to retrieve current user', 500);
  }
}

function roles(req, res) {
  try {
    const st = usersService.stats();
    const fromStore = Object.keys(st.roles).map(r => r.charAt(0).toUpperCase() + r.slice(1));
    const all = [...new Set([...KNOWN_ROLES, ...fromStore])];
    success(res, { roles: all }, 'Roles retrieved');
  } catch (err) {
    logger.error('auth.roles error:', err.message);
    error(res, 'Failed to retrieve roles', 500);
  }
}

function permissions(req, res) {
  try {
    const username = req.query.username;
    if (!username) return error(res, 'username is required', 400);
    if (!req.user) return error(res, 'Authentication required', 401);
    if (!_canViewUser(req.user, username)) {
      return error(res, 'Insufficient permission', 403);
    }
    const user = usersService.getByUsername(username);
    if (!user) return error(res, 'User not found', 404);
    success(res, { username: user.username, role: user.role || '', permissions: Array.isArray(user.permissions) ? user.permissions : [] }, 'Permissions retrieved');
  } catch (err) {
    logger.error('auth.permissions error:', err.message);
    error(res, 'Failed to retrieve permissions', 500);
  }
}

module.exports = { login, refresh, logout, me, roles, permissions };

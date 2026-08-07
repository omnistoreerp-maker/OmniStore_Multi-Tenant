const mfaService = require('../services/mfa.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

async function enable(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return error(res, 'Authentication required', 401);

    const { secret, token } = req.body || {};
    if (!secret || !token) {
      return error(res, 'secret and token are required', 400);
    }

    const result = mfaService.enableMFA(userId, secret, token);
    if (result.error) {
      return error(res, result.error, 400);
    }

    success(res, {
      backupCodes: result.backupCodes,
      message: result.message
    }, 'MFA enabled successfully');
  } catch (err) {
    logger.error('mfa.enable error:', err.message);
    error(res, 'Failed to enable MFA', 500);
  }
}

async function disable(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return error(res, 'Authentication required', 401);

    const { token } = req.body || {};
    if (!token) {
      return error(res, 'token is required', 400);
    }

    const result = mfaService.disableMFA(userId, token);
    if (result.error) {
      return error(res, result.error, 400);
    }

    success(res, { message: result.message }, 'MFA disabled successfully');
  } catch (err) {
    logger.error('mfa.disable error:', err.message);
    error(res, 'Failed to disable MFA', 500);
  }
}

async function verify(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return error(res, 'Authentication required', 401);

    const { token } = req.body || {};
    if (!token) {
      return error(res, 'token is required', 400);
    }

    const result = mfaService.verifyLogin(userId, token);
    if (result.error) {
      return error(res, result.error, 400);
    }

    success(res, {
      verified: result.verified,
      requiresMfa: result.requiresMfa
    }, result.verified ? 'MFA verification successful' : 'MFA verification failed');
  } catch (err) {
    logger.error('mfa.verify error:', err.message);
    error(res, 'Failed to verify MFA', 500);
  }
}

async function getSecret(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return error(res, 'Authentication required', 401);

    const result = mfaService.generateSecret(userId);
    if (result.error) {
      return error(res, result.error, 400);
    }

    const qrResult = await mfaService.generateQRCode(result.otpauthUrl);
    if (qrResult.error) {
      return error(res, qrResult.error, 400);
    }

    success(res, {
      secret: result.secret,
      qrCode: qrResult.qrCode
    }, 'MFA secret generated');
  } catch (err) {
    logger.error('mfa.getSecret error:', err.message);
    error(res, 'Failed to generate MFA secret', 500);
  }
}

async function getStatus(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return error(res, 'Authentication required', 401);

    const result = mfaService.getMfaStatus(userId);
    if (result.error) {
      return error(res, result.error, 400);
    }

    success(res, result, 'MFA status retrieved');
  } catch (err) {
    logger.error('mfa.getStatus error:', err.message);
    error(res, 'Failed to get MFA status', 500);
  }
}

async function generateBackupCodes(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return error(res, 'Authentication required', 401);

    const user = require('../services/users.service').getById(userId);
    if (!user) return error(res, 'User not found', 404);

    if (!user.mfaEnabled) {
      return error(res, 'MFA is not enabled', 400);
    }

    const { token } = req.body || {};
    if (!token) {
      return error(res, 'token is required', 400);
    }

    const verification = mfaService.verifyToken(user.mfaSecret, token);
    if (!verification.verified) {
      return error(res, 'Invalid MFA code', 401);
    }

    const backupCodes = mfaService.generateBackupCodes();
    const hashedBackupCodes = backupCodes.map(code => mfaService.hashBackupCode(code));

    require('../services/users.service').update(userId, {
      mfaBackupCodes: hashedBackupCodes
    });

    success(res, {
      backupCodes,
      message: 'Backup codes regenerated successfully'
    }, 'Backup codes generated');
  } catch (err) {
    logger.error('mfa.generateBackupCodes error:', err.message);
    error(res, 'Failed to generate backup codes', 500);
  }
}

module.exports = {
  enable,
  disable,
  verify,
  getSecret,
  getStatus,
  generateBackupCodes
};

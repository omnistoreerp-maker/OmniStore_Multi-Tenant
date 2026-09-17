const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');
const usersService = require('./users.service');
const logger = require('../utils/logger');

const MFA_ISSUER = process.env.MFA_ISSUER || 'DigiTronics';
const BACKUP_CODES_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;

class MfaService {
  generateSecret(userId) {
    try {
      const user = usersService.getById(userId);
      if (!user) return { error: 'User not found' };

      const secret = speakeasy.generateSecret({
        name: `${MFA_ISSUER}:${user.username || user.email}`,
        issuer: MFA_ISSUER,
        length: 32
      });

      return {
        secret: secret.base32,
        otpauthUrl: secret.otpauth_url
      };
    } catch (err) {
      logger.error('MFA generateSecret error:', err.message);
      return { error: 'Failed to generate MFA secret' };
    }
  }

  async generateQRCode(otpauthUrl) {
    try {
      const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
      return { qrCode: qrCodeDataUrl };
    } catch (err) {
      logger.error('MFA generateQRCode error:', err.message);
      return { error: 'Failed to generate QR code' };
    }
  }

  verifyToken(secret, token) {
    try {
      const verified = speakeasy.totp.verify({
        secret: secret,
        encoding: 'base32',
        token: token,
        window: 1
      });
      return { verified };
    } catch (err) {
      logger.error('MFA verifyToken error:', err.message);
      return { verified: false };
    }
  }

  generateBackupCodes() {
    const codes = [];
    for (let i = 0; i < BACKUP_CODES_COUNT; i++) {
      const code = crypto.randomBytes(BACKUP_CODE_LENGTH).toString('hex').toUpperCase();
      codes.push(code);
    }
    return codes;
  }

  hashBackupCode(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  enableMFA(userId, secret, token) {
    try {
      const verification = this.verifyToken(secret, token);
      if (!verification.verified) {
        return { error: 'Invalid MFA code' };
      }

      const backupCodes = this.generateBackupCodes();
      const hashedBackupCodes = backupCodes.map(code => this.hashBackupCode(code));

      const result = usersService.update(userId, {
        mfaEnabled: true,
        mfaSecret: secret,
        mfaBackupCodes: hashedBackupCodes,
        mfaEnabledAt: new Date().toISOString()
      });

      if (result.error) return { error: result.error };

      return {
        success: true,
        backupCodes,
        message: 'MFA enabled successfully'
      };
    } catch (err) {
      logger.error('MFA enableMFA error:', err.message);
      return { error: 'Failed to enable MFA' };
    }
  }

  disableMFA(userId, token) {
    try {
      const user = usersService.getById(userId);
      if (!user) return { error: 'User not found' };

      if (!user.mfaEnabled) {
        return { error: 'MFA is not enabled' };
      }

      const verification = this.verifyToken(user.mfaSecret, token);
      if (!verification.verified) {
        return { error: 'Invalid MFA code' };
      }

      const result = usersService.update(userId, {
        mfaEnabled: false,
        mfaSecret: null,
        mfaBackupCodes: null,
        mfaEnabledAt: null,
        mfaDisabledAt: new Date().toISOString()
      });

      if (result.error) return { error: result.error };

      return { success: true, message: 'MFA disabled successfully' };
    } catch (err) {
      logger.error('MFA disableMFA error:', err.message);
      return { error: 'Failed to disable MFA' };
    }
  }

  verifyLogin(userId, token) {
    try {
      const user = usersService.getById(userId);
      if (!user) return { error: 'User not found' };

      if (!user.mfaEnabled) {
        return { verified: true, requiresMfa: false };
      }

      const verification = this.verifyToken(user.mfaSecret, token);
      if (verification.verified) {
        return { verified: true, requiresMfa: true };
      }

      if (user.mfaBackupCodes && Array.isArray(user.mfaBackupCodes)) {
        const hashedInput = this.hashBackupCode(token);
        const codeIndex = user.mfaBackupCodes.indexOf(hashedInput);

        if (codeIndex !== -1) {
          const updatedBackupCodes = [...user.mfaBackupCodes];
          updatedBackupCodes.splice(codeIndex, 1);
          usersService.update(userId, { mfaBackupCodes: updatedBackupCodes });
          return { verified: true, requiresMfa: true, usedBackupCode: true };
        }
      }

      return { verified: false, requiresMfa: true };
    } catch (err) {
      logger.error('MFA verifyLogin error:', err.message);
      return { error: 'Failed to verify MFA' };
    }
  }

  getMfaStatus(userId) {
    try {
      const user = usersService.getById(userId);
      if (!user) return { error: 'User not found' };

      return {
        enabled: user.mfaEnabled || false,
        enabledAt: user.mfaEnabledAt || null,
        backupCodesCount: user.mfaBackupCodes ? user.mfaBackupCodes.length : 0
      };
    } catch (err) {
      logger.error('MFA getMfaStatus error:', err.message);
      return { error: 'Failed to get MFA status' };
    }
  }
}

module.exports = new MfaService();

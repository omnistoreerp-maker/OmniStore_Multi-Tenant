const mfaService = require('../services/mfa.service');
const speakeasy = require('speakeasy');

describe('MFA Service', () => {
  describe('generateSecret', () => {
    it('should return error for non-existent user', () => {
      const result = mfaService.generateSecret('non-existent-id');
      expect(result.error).toBeDefined();
    });
  });

  describe('verifyToken', () => {
    it('should verify valid token', () => {
      const secret = speakeasy.generateSecret();
      const token = speakeasy.totp({
        secret: secret.base32,
        encoding: 'base32'
      });
      const result = mfaService.verifyToken(secret.base32, token);
      expect(result.verified).toBe(true);
    });

    it('should reject invalid token', () => {
      const secret = speakeasy.generateSecret();
      const result = mfaService.verifyToken(secret.base32, '000000');
      expect(result.verified).toBe(false);
    });
  });

  describe('generateBackupCodes', () => {
    it('should generate correct number of backup codes', () => {
      const codes = mfaService.generateBackupCodes();
      expect(codes).toHaveLength(10);
    });

    it('should generate unique codes', () => {
      const codes = mfaService.generateBackupCodes();
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(codes.length);
    });

    it('should generate uppercase hex codes', () => {
      const codes = mfaService.generateBackupCodes();
      codes.forEach(code => {
        expect(code).toMatch(/^[A-F0-9]+$/);
        expect(code.length).toBe(16);
      });
    });
  });

  describe('hashBackupCode', () => {
    it('should hash backup code correctly', () => {
      const code = 'TESTCODE123';
      const hash = mfaService.hashBackupCode(code);
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
    });

    it('should produce consistent hashes', () => {
      const code = 'TESTCODE123';
      const hash1 = mfaService.hashBackupCode(code);
      const hash2 = mfaService.hashBackupCode(code);
      expect(hash1).toBe(hash2);
    });
  });

  describe('getMfaStatus', () => {
    it('should return error for non-existent user', () => {
      const result = mfaService.getMfaStatus('non-existent-id');
      expect(result.error).toBeDefined();
    });
  });
});

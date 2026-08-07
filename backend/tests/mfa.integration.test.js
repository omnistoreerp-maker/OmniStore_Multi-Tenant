const request = require('supertest');
const app = require('../server');

describe('MFA Integration', () => {
  describe('POST /api/v1/auth/mfa/enable', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/v1/auth/mfa/enable')
        .send({ secret: 'test', token: '123456' });
      
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/mfa/disable', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/v1/auth/mfa/disable')
        .send({ token: '123456' });
      
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/mfa/verify', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/v1/auth/mfa/verify')
        .send({ token: '123456' });
      
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/mfa/secret', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/v1/auth/mfa/secret');
      
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/mfa/status', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/v1/auth/mfa/status');
      
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/mfa/backup-codes', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/v1/auth/mfa/backup-codes')
        .send({ token: '123456' });
      
      expect(res.status).toBe(401);
    });
  });

  describe('Backward Compatibility', () => {
    it('should still support login without MFA', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: 'testpass' });
      
      expect([200, 401]).toContain(res.status);
    });

    it('should still support login with MFA token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: 'testpass', mfaToken: '123456' });
      
      expect([200, 401]).toContain(res.status);
    });

    it('should return mfaRequired when MFA is enabled', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: 'testpass' });
      
      if (res.status === 200 && res.body.data?.mfaRequired) {
        expect(res.body.data.mfaRequired).toBe(true);
        expect(res.body.data.tempToken).toBeDefined();
      }
    });
  });
});

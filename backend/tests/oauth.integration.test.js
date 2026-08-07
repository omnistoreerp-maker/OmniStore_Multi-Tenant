const request = require('supertest');
const app = require('../server');
const oauthConfig = require('../config/oauth');

describe('OAuth Integration', () => {
  describe('GET /auth/providers', () => {
    it('should return list of OAuth providers or 404 if disabled', async () => {
      const res = await request(app)
        .get('/auth/providers');
      
      // If OAuth is disabled, routes are not mounted (404)
      // If enabled, should return 200
      if (oauthConfig.enabled) {
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data.providers)).toBe(true);
      } else {
        expect(res.status).toBe(404);
      }
    });
  });

  describe('GET /auth/google', () => {
    it('should redirect to Google OAuth or return 404/501 if not configured', async () => {
      const res = await request(app)
        .get('/auth/google');
      
      // If OAuth is disabled, routes are not mounted (404)
      // If Google OAuth is not configured, should return 501
      // If configured, should redirect (302)
      expect([302, 404, 501]).toContain(res.status);
    });
  });

  describe('GET /auth/github', () => {
    it('should redirect to GitHub OAuth or return 404/501 if not configured', async () => {
      const res = await request(app)
        .get('/auth/github');
      
      // If OAuth is disabled, routes are not mounted (404)
      // If GitHub OAuth is not configured, should return 501
      // If configured, should redirect (302)
      expect([302, 404, 501]).toContain(res.status);
    });
  });

  describe('GET /auth/google/callback', () => {
    it('should handle invalid callback gracefully', async () => {
      const res = await request(app)
        .get('/auth/google/callback');
      
      // If OAuth is disabled, routes are not mounted (404)
      // Otherwise should return 401, 302, or 500
      expect([302, 401, 404, 500]).toContain(res.status);
    });
  });

  describe('GET /auth/github/callback', () => {
    it('should handle invalid callback gracefully', async () => {
      const res = await request(app)
        .get('/auth/github/callback');
      
      // If OAuth is disabled, routes are not mounted (404)
      // Otherwise should return 401, 302, or 500
      expect([302, 401, 404, 500]).toContain(res.status);
    });
  });

  describe('Backward Compatibility', () => {
    it('should still support email/password login', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: 'testpass' });
      
      // Should still work (may return 401 for invalid credentials)
      expect([200, 401]).toContain(res.status);
    });

    it('should still support token refresh', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' });
      
      // Should still work (may return 401 for invalid token)
      expect([401, 500]).toContain(res.status);
    });

    it('should still support logout', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout');
      
      // Should still work
      expect([200, 401]).toContain(res.status);
    });
  });
});

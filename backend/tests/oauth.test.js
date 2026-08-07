const oauthService = require('../services/oauth.service');

describe('OAuth Service', () => {
  describe('findOrCreateUser', () => {
    it('should return error when no email or provider ID', () => {
      const profile = { emails: [], id: null, _json: {} };
      const result = oauthService.findOrCreateUser(profile, 'google');
      expect(result.error).toBeDefined();
    });

    it('should extract email from profile', () => {
      const email = oauthService._extractEmail({
        emails: [{ value: 'test@example.com' }]
      });
      expect(email).toBe('test@example.com');
    });

    it('should extract email from _json', () => {
      const email = oauthService._extractEmail({
        emails: [],
        _json: { email: 'test@example.com' }
      });
      expect(email).toBe('test@example.com');
    });

    it('should return null when no email found', () => {
      const email = oauthService._extractEmail({
        emails: [],
        _json: {}
      });
      expect(email).toBeNull();
    });

    it('should extract display name from profile', () => {
      const name = oauthService._extractDisplayName({
        displayName: 'John Doe'
      });
      expect(name).toBe('John Doe');
    });

    it('should extract display name from name object', () => {
      const name = oauthService._extractDisplayName({
        name: { givenName: 'John', familyName: 'Doe' }
      });
      expect(name).toBe('John Doe');
    });

    it('should extract display name from username', () => {
      const name = oauthService._extractDisplayName({
        username: 'johndoe'
      });
      expect(name).toBe('johndoe');
    });

    it('should generate username from profile', () => {
      const username = oauthService._generateUsername({
        username: 'johndoe'
      }, 'google');
      expect(username).toBe('google_johndoe');
    });

    it('should sanitize username', () => {
      const username = oauthService._generateUsername({
        username: 'john-doe-123'
      }, 'github');
      expect(username).toBe('github_johndoe123');
    });
  });

  describe('_extractProviderId', () => {
    it('should extract provider ID from profile', () => {
      const id = oauthService._extractProviderId({ id: '12345' });
      expect(id).toBe('12345');
    });

    it('should extract provider ID from _json.sub', () => {
      const id = oauthService._extractProviderId({ _json: { sub: '12345' } });
      expect(id).toBe('12345');
    });
  });
});

const usersService = require('./users.service');
const logger = require('../utils/logger');

class OAuthService {
  findOrCreateUser(profile, provider) {
    try {
      const email = this._extractEmail(profile);
      const providerId = this._extractProviderId(profile);
      const username = this._generateUsername(profile, provider);
      const displayName = this._extractDisplayName(profile);

      if (!email && !providerId) {
        logger.error('OAuth: No email or provider ID found in profile');
        return { error: 'Unable to authenticate: no identifying information' };
      }

      const existingByProvider = this._findByProvider(provider, providerId);
      if (existingByProvider) {
        // P0-004 — a disabled account must not mint fresh tokens through a
        // second authentication path. Mirrors the Phase E login gate.
        if (existingByProvider.status === 'disabled') {
          return { error: 'User is disabled' };
        }
        return { user: existingByProvider, isNew: false };
      }

      if (email) {
        const existingByEmail = usersService.getByUsername(email);
        if (existingByEmail) {
          // P0-004 — same disabled-account gate for the email-match path.
          if (existingByEmail.status === 'disabled') {
            return { error: 'User is disabled' };
          }
          if (!existingByEmail.oauth) existingByEmail.oauth = {};
          existingByEmail.oauth[provider] = providerId;
          existingByEmail.oauthProvider = provider;
          usersService.update(existingByEmail.id, { oauth: existingByEmail.oauth, oauthProvider: provider });
          return { user: existingByEmail, isNew: false };
        }
      }

      const result = usersService.create({
        username: email || username,
        fullName: displayName,
        oauthProvider: provider,
        oauth: { [provider]: providerId },
        role: process.env.OAUTH_DEFAULT_ROLE || 'Viewer'
      });

      if (result.error) {
        return { error: result.error };
      }

      return { user: result.user, isNew: true };
    } catch (err) {
      logger.error('OAuth findOrCreateUser error:', err.message);
      return { error: 'OAuth authentication failed' };
    }
  }

  // Link a VERIFIED provider identity to an existing user. Verification of the
  // provider response (e.g. a Google ID token) belongs to the caller; the
  // atomic store invariants live in usersService.linkOAuthProvider.
  async linkProvider(userId, provider, profile) {
    try {
      const providerId = this._extractProviderId(profile);
      if (!providerId) return { error: 'Missing provider identity', statusCode: 400 };
      const email = this._extractEmail(profile);
      return await usersService.linkOAuthProvider(userId, provider, providerId, email);
    } catch (err) {
      logger.error('OAuth linkProvider error:', err.message);
      if (err && err.code === 'ELOCKED') {
        return { error: 'Account linking is temporarily unavailable', statusCode: 503 };
      }
      return { error: 'Failed to link provider' };
    }
  }

  _findByProvider(provider, providerId) {
    const result = usersService.list({ limit: 1000 });
    if (!result.users) return null;

    return result.users.find(user => {
      if (!user.oauth || !user.oauth[provider]) return false;
      return user.oauth[provider] === providerId;
    }) || null;
  }

  _extractEmail(profile) {
    if (profile.emails && profile.emails.length > 0) {
      return profile.emails[0].value;
    }
    if (profile.email) return profile.email;
    if (profile._json && profile._json.email) return profile._json.email;
    return null;
  }

  _extractProviderId(profile) {
    return profile.id || profile._json?.sub || '';
  }

  _extractDisplayName(profile) {
    if (profile.displayName) return profile.displayName;
    if (profile.name) {
      const name = profile.name;
      if (name.givenName && name.familyName) return `${name.givenName} ${name.familyName}`;
      if (name.givenName) return name.givenName;
    }
    if (profile.username) return profile.username;
    return 'OAuth User';
  }

  _generateUsername(profile, provider) {
    const base = profile.username || profile._json?.login || this._extractDisplayName(profile);
    const sanitized = base.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
    return `${provider}_${sanitized}`;
  }
}

module.exports = new OAuthService();

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
        return { user: existingByProvider, isNew: false };
      }

      if (email) {
        const existingByEmail = usersService.getByUsername(email);
        if (existingByEmail) {
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

  linkProvider(userId, provider, profile) {
    try {
      const user = usersService.getById(userId);
      if (!user) return { error: 'User not found' };

      const providerId = this._extractProviderId(profile);
      const email = this._extractEmail(profile);

      if (email) {
        const existingUser = usersService.getByUsername(email);
        if (existingUser && existingUser.id !== userId) {
          return { error: 'Email already linked to another account' };
        }
      }

      if (!user.oauth) user.oauth = {};
      user.oauth[provider] = providerId;

      const result = usersService.update(userId, {
        oauth: user.oauth,
        oauthProvider: provider
      });

      if (result.error) return { error: result.error };
      return { user: result.user };
    } catch (err) {
      logger.error('OAuth linkProvider error:', err.message);
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

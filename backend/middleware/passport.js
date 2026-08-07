const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const oauthConfig = require('../config/oauth');
const oauthService = require('../services/oauth.service');
const logger = require('../utils/logger');

function configurePassport() {
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser((id, done) => {
    try {
      const usersService = require('../services/users.service');
      const user = usersService.getById(id);
      if (user) {
        done(null, user);
      } else {
        done(null, false);
      }
    } catch (err) {
      logger.error('Passport deserializeUser error:', err.message);
      done(null, false);
    }
  });

  if (oauthConfig.providers.google.enabled) {
    passport.use(new GoogleStrategy({
      clientID: oauthConfig.providers.google.clientID,
      clientSecret: oauthConfig.providers.google.clientSecret,
      callbackURL: oauthConfig.providers.google.callbackURL,
      scope: oauthConfig.providers.google.scope,
      passReqToCallback: true
    }, async (req, accessToken, refreshToken, profile, done) => {
      try {
        const result = oauthService.findOrCreateUser(profile, 'google');
        if (result.error) {
          return done(null, false, { message: result.error });
        }
        return done(null, result.user);
      } catch (err) {
        logger.error('Google OAuth error:', err.message);
        return done(null, false, { message: 'Google authentication failed' });
      }
    }));
  }

  if (oauthConfig.providers.github.enabled) {
    passport.use(new GitHubStrategy({
      clientID: oauthConfig.providers.github.clientID,
      clientSecret: oauthConfig.providers.github.clientSecret,
      callbackURL: oauthConfig.providers.github.callbackURL,
      scope: oauthConfig.providers.github.scope,
      passReqToCallback: true
    }, async (req, accessToken, refreshToken, profile, done) => {
      try {
        const result = oauthService.findOrCreateUser(profile, 'github');
        if (result.error) {
          return done(null, false, { message: result.error });
        }
        return done(null, result.user);
      } catch (err) {
        logger.error('GitHub OAuth error:', err.message);
        return done(null, false, { message: 'GitHub authentication failed' });
      }
    }));
  }

  return passport;
}

module.exports = { configurePassport };

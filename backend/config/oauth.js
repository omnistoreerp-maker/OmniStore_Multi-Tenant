const dotenv = require('dotenv');
dotenv.config();

const env = process.env.NODE_ENV || 'development';
const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

const oauth = {
  enabled: process.env.OAUTH_ENABLED === 'true',

  session: {
    secret: process.env.SESSION_SECRET || 'session-secret-dev',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: env === 'production',
      sameSite: env === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000
    }
  },

  providers: {
    google: {
      enabled: process.env.GOOGLE_CLIENT_ID !== undefined && process.env.GOOGLE_CLIENT_SECRET !== undefined,
      clientID: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackURL: process.env.GOOGLE_CALLBACK_URL || `${baseUrl}/auth/google/callback`,
      scope: ['profile', 'email']
    },
    github: {
      enabled: process.env.GITHUB_CLIENT_ID !== undefined && process.env.GITHUB_CLIENT_SECRET !== undefined,
      clientID: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      callbackURL: process.env.GITHUB_CALLBACK_URL || `${baseUrl}/auth/github/callback`,
      scope: ['user:email']
    }
  },

  defaultRole: process.env.OAUTH_DEFAULT_ROLE || 'Viewer',
  linkExistingUsers: process.env.OAUTH_LINK_EXISTING !== 'false'
};

module.exports = oauth;

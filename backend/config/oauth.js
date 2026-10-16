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

  // Platform Master Google sign-in (server-side OIDC path, sub-based
  // linking only). `email` is the approved linking policy: enforced ONLY
  // when a Google account is explicitly linked to the master session —
  // never as an authentication condition, never as a link-by-email rule.
  master: {
    email: process.env.OAUTH_MASTER_EMAIL || '',
    callbackURL: process.env.GOOGLE_MASTER_CALLBACK_URL || `${baseUrl}/auth/google/master/callback`,
    // Optional parent-domain scope for the LOGIN binding cookie (P0 fix).
    // The Google callback host (from GOOGLE_MASTER_CALLBACK_URL, e.g.
    // app.omnistoreerp.com) is frequently a SIBLING subdomain of the host
    // the owner actually browses (e.g. omnistoreerp.com). A host-only
    // binding cookie set by the site host is never sent to the callback
    // host, so every LOGIN fails with browser_binding_mismatch. When this
    // is set (or safely derivable), the short-lived CSRF nonce cookie is
    // scoped to the parent registrable domain so both subdomains see it.
    // Session cookies are NOT affected. Precedence:
    //   OAUTH_COOKIE_DOMAIN set to a value  -> use it verbatim
    //   OAUTH_COOKIE_DOMAIN set to ""       -> force host-only (unset)
    //   production + PLATFORM_DOMAIN        -> derive parent of the platform
    //                                          host (app.X.Y -> .X.Y)
    //   otherwise (dev, single-label hosts) -> host-only (current behavior)
    cookieDomain: (() => {
      const explicit = process.env.OAUTH_COOKIE_DOMAIN;
      if (explicit !== undefined) {
        const v = String(explicit).trim().toLowerCase();
        return v || undefined;
      }
      if (env !== 'production') return undefined;
      const platformDomain = String(process.env.PLATFORM_DOMAIN || 'app.omnistoreerp.com').trim().toLowerCase();
      const labels = platformDomain.split('.');
      if (platformDomain && labels.length >= 3) return '.' + labels.slice(1).join('.');
      return undefined;
    })()
  },

  defaultRole: process.env.OAUTH_DEFAULT_ROLE || 'Viewer',
  linkExistingUsers: process.env.OAUTH_LINK_EXISTING !== 'false'
};

module.exports = oauth;

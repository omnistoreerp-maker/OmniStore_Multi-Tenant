// In-memory revoked-token denylist (per process).
// Access tokens are short-lived; refresh tokens are checked against
// this list on every refresh exchange and on authenticated requests.
const revoked = new Set();

function revokeToken(token) {
  if (token) revoked.add(String(token));
}

function isRevoked(token) {
  return revoked.has(String(token));
}

module.exports = { revokeToken, isRevoked };

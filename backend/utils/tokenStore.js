// In-memory revoked-token denylist (per process).
// Access tokens are short-lived; refresh tokens are checked against
// this list on every refresh exchange and on authenticated requests.
//
// v1.0.1 — DEPLOYMENT NOTE (documented limitation, unchanged behavior):
//   The denylist is MEMORY-ONLY. Every restart of the backend process clears
//   it, so a token revoked just before a restart again becomes accepted until
//   its natural expiration. This is acceptable for the default short-lived
//   access tokens (and revoke-on-password-change is additionally enforced by
//   the per-user tokenVersion at the identity layer), but an operator that
//   needs revocations to SURVIVE restarts should back this set with the file/
//   store layer (e.g. write-through append to a data-file denylist keyed by
//   token hash, pruned by expiry) rather than relying on process memory.
const revoked = new Set();

function revokeToken(token) {
  if (token) revoked.add(String(token));
}

function isRevoked(token) {
  return revoked.has(String(token));
}

module.exports = { revokeToken, isRevoked };

// Persistent revoked-token denylist.
// Tokens are stored as SHA-256 hashes — raw JWTs are NEVER persisted.
// Each entry includes the token expiry (exp) for automatic pruning.
// Survives process restarts via a JSON file in the data directory.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DENYLIST_FILE = path.join(
  process.env.DIGITRONICS_DATA_DIR || path.join(__dirname, '..', 'data'),
  'revoked-tokens.json'
);

// In-memory map of hash -> exp (epoch seconds) for fast lookup + pruning.
const revoked = new Map();
let _loaded = false;

function _hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Decode JWT payload without verification (for exp extraction only).
// Returns null on malformed input.
function _decodePayload(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload;
  } catch (_) {
    return null;
  }
}

// Load denied-list from disk. Idempotent. Auto-prunes expired entries.
function _load() {
  if (_loaded) return;
  try {
    const raw = fs.readFileSync(DENYLIST_FILE, 'utf8');
    const entries = JSON.parse(raw);
    if (Array.isArray(entries)) {
      const now = Math.floor(Date.now() / 1000);
      for (const entry of entries) {
        if (entry && entry.hash && (entry.exp == null || entry.exp > now)) {
          revoked.set(entry.hash, entry.exp || null);
        }
      }
    }
  } catch (_) {
    // File missing or corrupt on first boot — start empty.
  }
  _loaded = true;
}

// Persist to disk atomically (tmp + rename). Includes exp for pruning.
function _save() {
  const entries = [];
  for (const [hash, exp] of revoked) {
    const entry = { hash };
    if (exp != null) entry.exp = exp;
    entries.push(entry);
  }
  try {
    const dir = path.dirname(DENYLIST_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = DENYLIST_FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
    fs.renameSync(tmp, DENYLIST_FILE);
  } catch (_) {
    // Best-effort persistence. In-memory map remains authoritative.
  }
}

// Revoke a token. Accepts the raw JWT string.
// Extracts exp for future pruning, stores only the SHA-256 hash.
function revokeToken(token) {
  if (!token) return;
  _load();
  const hash = _hashToken(token);
  const payload = _decodePayload(token);
  const exp = payload && payload.exp ? payload.exp : null;
  revoked.set(hash, exp);
  _save();
}

// Check whether a token has been revoked.
// Returns false for null/undefined (safe default — let auth middleware handle).
function isRevoked(token) {
  if (!token) return false;
  _load();
  return revoked.has(_hashToken(token));
}

// Expose for testing: reset state (used between test cases).
function _reset() {
  revoked.clear();
  _loaded = false;
}

module.exports = { revokeToken, isRevoked, _reset, _hashToken };

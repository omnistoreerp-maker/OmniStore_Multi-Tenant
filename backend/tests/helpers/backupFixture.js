'use strict';

// Shared fixtures for the backup/restore suites: build small, valid SQLite
// token and challenge databases in a temp directory. Never touches backend/data.

function makeTokenDb(file, marker, familyCount) {
  const store = require('../../utils/tokenStore.sqlite');
  const count = familyCount === undefined ? 1 : familyCount;
  store.initialise(file);
  try {
    for (let i = 0; i < count; i++) {
      const fam = store.createSessionFamily(marker + '-' + i, 'tenant-x');
      store.issueRefreshToken('jti-' + marker + '-' + i, {
        familyId: fam.familyId,
        sub: marker + '-' + i,
        ver: 0,
        tenantId: 'tenant-x',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 600000
      });
    }
  } finally {
    store.closeDb();
  }
  return file;
}

function makeChallengeDb(file) {
  const store = require('../../utils/challengeStore.sqlite');
  const opened = store.initialise(file);
  try {
    store.persistChallenge(opened.db, {
      token: 'challenge-token-1',
      sub: 'user-1',
      purpose: 'mfa',
      ttlMs: 60000
    });
  } finally {
    store.closeDb(opened.db);
  }
  return file;
}

module.exports = { makeTokenDb, makeChallengeDb };

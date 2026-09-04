'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

const MANIFEST_PATH = path.join(__dirname, '..', 'data', 'updateManifest.json');
const GIT_HEAD_PATH = path.join(__dirname, '..', '..', '.git', 'HEAD');

let _cachedIdentity = null;

function _readManifest() {
  try {
    if (!fs.existsSync(MANIFEST_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    if (!raw || typeof raw !== 'object') return null;
    return raw;
  } catch (err) {
    logger.warn('buildIdentity: failed to read manifest', err.message);
    return null;
  }
}

function _readGitHead() {
  try {
    if (!fs.existsSync(GIT_HEAD_PATH)) return null;
    const head = fs.readFileSync(GIT_HEAD_PATH, 'utf-8').trim();
    if (head.startsWith('ref: ')) {
      const refPath = path.join(__dirname, '..', '..', '.git', head.slice(5));
      if (fs.existsSync(refPath)) {
        return fs.readFileSync(refPath, 'utf-8').trim();
      }
      return null;
    }
    return head || null;
  } catch (err) {
    return null;
  }
}

function getBuildIdentity() {
  if (_cachedIdentity) return _cachedIdentity;
  const manifest = _readManifest();
  const commitSha = _readGitHead();
  const version = (manifest && manifest.version) || config.appVersion || '0.0.0';
  const buildId = version;
  _cachedIdentity = {
    version: version,
    buildId: buildId,
    commitSha: commitSha || null,
    releaseDate: (manifest && manifest.releaseDate) || null,
    sha256: (manifest && manifest.sha256) || null,
    product: 'OMNISTORE',
    environment: process.env.NODE_ENV || 'development'
  };
  return _cachedIdentity;
}

function clearCache() {
  _cachedIdentity = null;
}

module.exports = {
  getBuildIdentity,
  clearCache
};

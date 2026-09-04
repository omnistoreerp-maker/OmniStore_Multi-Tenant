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
  } catch (_) {
    return null;
  }
}

function getBuildIdentity() {
  if (_cachedIdentity) return _cachedIdentity;
  const manifest = _readManifest();
  const commitSha = _readGitHead();
  const version = (manifest && manifest.version) || config.appVersion || '0.0.0';
  const buildId = version;
  // The sha256 from the manifest is the AUTHORITATIVE artifact identity.
  // It represents the actual binary artifact that was published, not the
  // current runtime state. This is what should be compared against
  // release evidence on customer requests.
  const artifactSha256 = (manifest && manifest.sha256) || null;
  _cachedIdentity = {
    version: version,
    buildId: buildId,
    commitSha: commitSha || null,
    artifactSha256: artifactSha256,
    releaseDate: (manifest && manifest.releaseDate) || null,
    sha256: artifactSha256,
    product: 'OMNISTORE',
    environment: process.env.NODE_ENV || 'development'
  };
  return _cachedIdentity;
}

function getArtifactIdentity() {
  const id = getBuildIdentity();
  return {
    version: id.version,
    buildId: id.buildId,
    artifactSha256: id.artifactSha256,
    releaseDate: id.releaseDate
  };
}

function clearCache() {
  _cachedIdentity = null;
}

module.exports = {
  getBuildIdentity,
  getArtifactIdentity,
  clearCache
};

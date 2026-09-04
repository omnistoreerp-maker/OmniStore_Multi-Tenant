'use strict';

const storageAdapter = require('../repositories/storageAdapter');
const logger = require('../utils/logger');
const buildIdentity = require('./buildIdentity.service');

const STORE_KEY = 'releases';

const IMMUTABLE_FIELDS = ['id', 'version', 'buildId', 'commitSha', 'artifactSha256', 'createdAt'];

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && Array.isArray(raw.releases)) return raw;
  } catch (err) {
    logger.warn('release.service: failed to read store', err.message);
  }
  return { releases: [] };
}

function _saveStore(data) {
  storageAdapter.write(STORE_KEY, data);
}

function _validateReleaseInput(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Invalid request body'] };
  }
  const version = String(data.version || '').trim();
  if (!version) errors.push('version is required');
  const buildId = String(data.buildId || data.version || '').trim();
  if (!buildId) errors.push('buildId is required');
  const artifactSha256 = String(data.artifactSha256 || '').trim();
  if (!artifactSha256) errors.push('artifactSha256 is required');
  if (artifactSha256 && !/^[a-fA-F0-9]{64}$/.test(artifactSha256)) {
    errors.push('artifactSha256 must be a 64-character hex string');
  }
  const commitSha = data.commitSha ? String(data.commitSha).trim() : null;
  const environment = String(data.environment || 'production').trim();
  const notes = data.notes ? String(data.notes).trim() : '';
  return {
    valid: errors.length === 0,
    errors: errors,
    data: { version, buildId, artifactSha256, commitSha, environment, notes }
  };
}

function _generateId(version) {
  return 'rel_' + String(version).replace(/[^a-zA-Z0-9._-]/g, '_') + '_' + Date.now().toString(36);
}

function registerRelease(data) {
  const validation = _validateReleaseInput(data);
  if (!validation.valid) {
    return { error: 'Invalid release: ' + validation.errors.join('; '), code: 'INVALID_REQUEST' };
  }
  const store = _readStore();
  const existing = store.releases.find(r => r && r.artifactSha256 === validation.data.artifactSha256);
  if (existing) {
    return { error: 'Release with this artifact SHA-256 already exists', code: 'DUPLICATE_ARTIFACT', existing: existing };
  }
  const now = new Date().toISOString();
  const record = {
    id: _generateId(validation.data.version),
    version: validation.data.version,
    buildId: validation.data.buildId,
    commitSha: validation.data.commitSha,
    artifactSha256: validation.data.artifactSha256,
    createdAt: now,
    releasedAt: now,
    environment: validation.data.environment,
    notes: validation.data.notes,
    registeredBy: data.registeredBy || 'system'
  };
  store.releases.push(record);
  _saveStore(store);
  return { release: record };
}

function getReleaseById(id) {
  if (!id) return null;
  const store = _readStore();
  return store.releases.find(r => r && String(r.id) === String(id)) || null;
}

function getReleaseByArtifact(artifactSha256) {
  if (!artifactSha256) return null;
  const store = _readStore();
  return store.releases.find(r => r && r.artifactSha256 === artifactSha256) || null;
}

function listReleases() {
  const store = _readStore();
  return store.releases
    .slice()
    .sort((a, b) => String(b.releasedAt || '').localeCompare(String(a.releasedAt || '')));
}

function ensureCurrentBuildRelease() {
  const build = buildIdentity.getBuildIdentity();
  if (!build.artifactSha256) return null;
  const existing = getReleaseByArtifact(build.artifactSha256);
  if (existing) return existing;
  return null;
}

function sanitizeForResponse(record) {
  if (!record) return null;
  return {
    id: record.id,
    version: record.version,
    buildId: record.buildId,
    commitSha: record.commitSha,
    artifactSha256: record.artifactSha256,
    createdAt: record.createdAt,
    releasedAt: record.releasedAt,
    environment: record.environment,
    notes: record.notes,
    registeredBy: record.registeredBy
  };
}

module.exports = {
  IMMUTABLE_FIELDS,
  registerRelease,
  getReleaseById,
  getReleaseByArtifact,
  listReleases,
  ensureCurrentBuildRelease,
  sanitizeForResponse
};

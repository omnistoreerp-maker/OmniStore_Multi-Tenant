'use strict';

const storageAdapter = require('../repositories/storageAdapter');
const logger = require('../utils/logger');
const buildIdentity = require('./buildIdentity.service');

const STORE_KEY = 'customerRequests';
const SEQUENCE_KEY = 'customerRequestSequence';

const VALID_TYPES = ['BUG', 'CHANGE', 'FEATURE', 'FEEDBACK'];
const VALID_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const VALID_PRODUCTS = ['ERP', 'MARKETPLACE', 'GAME_HOSTING', 'PLATFORM'];
const VALID_STATUSES = [
  'NEW', 'TRIAGED', 'APPROVED', 'IN_PROGRESS', 'READY_FOR_TEST', 'TESTED',
  'READY_FOR_RELEASE', 'RELEASED', 'READY_FOR_CUSTOMER_VERIFICATION', 'RESOLVED',
  'BLOCKED', 'REJECTED', 'CANCELLED', 'REOPENED', 'NEEDS_EVIDENCE'
];

const ALLOWED_TRANSITIONS = {
  'NEW': ['TRIAGED', 'REJECTED', 'CANCELLED', 'NEEDS_EVIDENCE'],
  'TRIAGED': ['APPROVED', 'REJECTED', 'CANCELLED', 'NEEDS_EVIDENCE', 'BLOCKED'],
  'APPROVED': ['IN_PROGRESS', 'CANCELLED', 'BLOCKED'],
  'IN_PROGRESS': ['READY_FOR_TEST', 'BLOCKED', 'CANCELLED'],
  'READY_FOR_TEST': ['TESTED', 'IN_PROGRESS', 'BLOCKED'],
  'TESTED': ['READY_FOR_RELEASE', 'IN_PROGRESS'],
  'READY_FOR_RELEASE': ['RELEASED', 'BLOCKED'],
  'RELEASED': ['READY_FOR_CUSTOMER_VERIFICATION'],
  'READY_FOR_CUSTOMER_VERIFICATION': ['RESOLVED', 'REOPENED'],
  'RESOLVED': ['REOPENED'],
  'REOPENED': ['TRIAGED', 'IN_PROGRESS', 'CANCELLED'],
  'BLOCKED': ['IN_PROGRESS', 'TRIAGED', 'CANCELLED'],
  'REJECTED': [],
  'CANCELLED': ['REOPENED'],
  'NEEDS_EVIDENCE': ['TRIAGED', 'REJECTED', 'CANCELLED']
};

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && Array.isArray(raw.requests)) return raw;
  } catch (err) {
    logger.warn('customerRequest.service: failed to read store', err.message);
  }
  return { requests: [], verifications: [], audit: [] };
}

function _saveStore(data) {
  storageAdapter.write(STORE_KEY, data);
}

function _readSequence() {
  try {
    const raw = storageAdapter.read(SEQUENCE_KEY);
    if (raw && typeof raw === 'object' && typeof raw.last === 'number') return raw.last;
  } catch (err) {}
  return 0;
}

function _saveSequence(last) {
  storageAdapter.write(SEQUENCE_KEY, { last: last });
}

function _nextSequence() {
  const last = _readSequence();
  const next = last + 1;
  _saveSequence(next);
  return next;
}

function _formatRequestNumber(seq) {
  const year = new Date().getFullYear();
  const padded = String(seq).padStart(4, '0');
  return 'CR-' + year + '-' + padded;
}

function _sanitizeText(text, max) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (max && trimmed.length > max) return trimmed.slice(0, max);
  return trimmed;
}

function _validateCreateInput(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Invalid request body'] };
  }
  const title = _sanitizeText(data.title, 200);
  if (!title) errors.push('Title is required');
  const description = _sanitizeText(data.description, 5000);
  if (!description) errors.push('Description is required');
  const type = String(data.type || '').toUpperCase();
  if (!VALID_TYPES.includes(type)) errors.push('Type must be BUG, CHANGE, FEATURE, or FEEDBACK');
  const priority = String(data.priority || '').toUpperCase();
  if (!VALID_PRIORITIES.includes(priority)) errors.push('Priority must be P0, P1, P2, or P3');
  const product = String(data.product || '').toUpperCase();
  if (!VALID_PRODUCTS.includes(product)) errors.push('Product must be ERP, MARKETPLACE, GAME_HOSTING, or PLATFORM');
  return {
    valid: errors.length === 0,
    errors: errors,
    data: { title, description, type, priority, product }
  };
}

function _buildRequestRecord(companyId, branchId, user, input, historical) {
  const now = new Date().toISOString();
  return {
    id: null,
    customerRequestNumber: null,
    companyId: companyId,
    branchId: branchId || null,
    product: input.product,
    type: input.type,
    priority: input.priority,
    title: input.title,
    description: input.description,
    status: historical ? historical.status : 'NEW',
    resolution: historical ? (historical.resolution || '') : '',
    createdAt: historical ? historical.createdAt : now,
    updatedAt: now,
    createdBy: user ? user.username : 'unknown',
    assignedTo: historical ? (historical.assignedTo || null) : null,
    releaseId: historical ? (historical.releaseId || null) : null,
    implementationCommits: historical ? (historical.implementationCommits || []) : [],
    testEvidence: historical ? (historical.testEvidence || []) : [],
    customerVerifiedAt: historical ? (historical.customerVerifiedAt || null) : null,
    customerVerifiedBy: historical ? (historical.customerVerifiedBy || null) : null,
    historical: !!historical,
    historicalSource: historical ? (historical.historicalSource || 'manual_review') : null
  };
}

function _attachRequestNumber(record) {
  const seq = _nextSequence();
  record.id = 'req_' + seq + '_' + Date.now().toString(36);
  record.customerRequestNumber = _formatRequestNumber(seq);
  return record;
}

function _sanitizeForResponse(record) {
  if (!record) return null;
  return {
    id: record.id,
    customerRequestNumber: record.customerRequestNumber,
    companyId: record.companyId,
    branchId: record.branchId,
    product: record.product,
    type: record.type,
    priority: record.priority,
    title: record.title,
    description: record.description,
    status: record.status,
    customerFacingStatus: getCustomerFacingStatus(record.status),
    resolution: record.resolution || '',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    createdBy: record.createdBy,
    assignedTo: record.assignedTo,
    releaseId: record.releaseId,
    implementationCommits: record.implementationCommits || [],
    testEvidence: record.testEvidence || [],
    customerVerifiedAt: record.customerVerifiedAt,
    customerVerifiedBy: record.customerVerifiedBy,
    historical: !!record.historical,
    historicalSource: record.historicalSource
  };
}

function listForCompany(companyId) {
  if (!companyId) return [];
  const store = _readStore();
  return store.requests
    .filter(r => r && String(r.companyId) === String(companyId))
    .map(_sanitizeForResponse);
}

function getByIdForCompany(companyId, requestId) {
  if (!companyId || !requestId) return null;
  const store = _readStore();
  const found = store.requests.find(r => r && String(r.id) === String(requestId));
  if (!found) return null;
  if (String(found.companyId) !== String(companyId)) return null;
  return _sanitizeForResponse(found);
}

function createRequest(companyId, branchId, user, data) {
  const validation = _validateCreateInput(data);
  if (!validation.valid) {
    return { error: 'Invalid request: ' + validation.errors.join('; '), code: 'INVALID_REQUEST' };
  }
  const store = _readStore();
  const record = _buildRequestRecord(companyId, branchId, user, validation.data, null);
  _attachRequestNumber(record);
  store.requests.push(record);
  store.audit.push({
    id: 'audit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    requestId: record.id,
    fromStatus: null,
    toStatus: record.status,
    actor: user ? user.username : 'unknown',
    actorType: 'customer',
    timestamp: new Date().toISOString(),
    note: 'Request created',
    releaseId: null
  });
  _saveStore(store);
  return { request: _sanitizeForResponse(record) };
}

function _findRequestInternal(requestId) {
  const store = _readStore();
  return { store: store, record: store.requests.find(r => r && String(r.id) === String(requestId)) };
}

function _appendAudit(store, record, fromStatus, toStatus, actor, actorType, note, releaseId) {
  store.audit.push({
    id: 'audit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    requestId: record.id,
    fromStatus: fromStatus,
    toStatus: toStatus,
    actor: actor,
    actorType: actorType,
    timestamp: new Date().toISOString(),
    note: note || '',
    releaseId: releaseId || null
  });
}

function transitionStatus(companyId, requestId, toStatus, actor, actorType, note, releaseId) {
  if (!VALID_STATUSES.includes(toStatus)) {
    return { error: 'Invalid status: ' + toStatus, code: 'INVALID_STATUS' };
  }
  const { store, record } = _findRequestInternal(requestId);
  if (!record) return { error: 'Request not found', code: 'REQUEST_NOT_FOUND' };
  if (String(record.companyId) !== String(companyId)) {
    return { error: 'Request not found', code: 'REQUEST_NOT_FOUND' };
  }
  const fromStatus = record.status;
  const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    return { error: 'Invalid status transition: ' + fromStatus + ' -> ' + toStatus, code: 'INVALID_STATUS_TRANSITION' };
  }
  if (toStatus === 'RELEASED' && !releaseId) {
    return { error: 'Release evidence is required to mark a request as RELEASED', code: 'RELEASE_REQUIRED' };
  }
  if (releaseId) {
    record.releaseId = releaseId;
  }
  record.status = toStatus;
  record.updatedAt = new Date().toISOString();
  _appendAudit(store, record, fromStatus, toStatus, actor, actorType, note, releaseId);
  _saveStore(store);
  return { request: _sanitizeForResponse(record) };
}

function verifyReleaseMatches(request) {
  if (!request || !request.releaseId) return { matches: false, reason: 'NO_RELEASE' };
  const current = buildIdentity.getBuildIdentity();
  const requestRelease = request.releaseId || {};
  const currentBuildId = String(current.buildId || '');
  const currentCommit = String(current.commitSha || '');
  const currentArtifact = String(current.artifactSha256 || '');
  const releaseBuildId = String(requestRelease.buildId || '');
  const releaseCommit = String(requestRelease.commitSha || '');
  const releaseArtifact = String(requestRelease.artifactSha256 || '');
  // Primary: artifact identity (sha256) — this is the authoritative proof
  // that the same binary artifact is being served. If the release has an
  // artifact hash, it MUST match the current served artifact.
  if (releaseArtifact && currentArtifact) {
    if (releaseArtifact !== currentArtifact) {
      return { matches: false, reason: 'ARTIFACT_MISMATCH', currentArtifact, releaseArtifact };
    }
  }
  if (releaseBuildId && currentBuildId && releaseBuildId !== currentBuildId) {
    return { matches: false, reason: 'BUILD_ID_MISMATCH', currentBuildId, releaseBuildId };
  }
  if (releaseCommit && currentCommit && releaseCommit !== currentCommit) {
    return { matches: false, reason: 'COMMIT_MISMATCH', currentCommit, releaseCommit };
  }
  // If the release has NO artifact identity at all, we cannot prove the
  // build matches. This is intentionally a MISMATCH to prevent false
  // resolution when evidence is incomplete.
  if (!releaseArtifact && !releaseBuildId && !releaseCommit) {
    return { matches: false, reason: 'NO_RELEASE_IDENTITY' };
  }
  return { matches: true, currentBuildId, currentCommit, currentArtifact };
}

function getCustomerFacingStatus(status) {
  const map = {
    'NEW': 'Request received',
    'TRIAGED': 'Being reviewed',
    'APPROVED': 'Approved — work scheduled',
    'IN_PROGRESS': 'Being worked on',
    'READY_FOR_TEST': 'Ready for internal testing',
    'TESTED': 'Tested — preparing release',
    'READY_FOR_RELEASE': 'Preparing release',
    'RELEASED': 'Released — please verify',
    'READY_FOR_CUSTOMER_VERIFICATION': 'Released — please verify',
    'RESOLVED': 'Confirmed resolved',
    'BLOCKED': 'Temporarily blocked',
    'REJECTED': 'Not accepted',
    'CANCELLED': 'Cancelled',
    'REOPENED': 'Customer reported the issue remains',
    'NEEDS_EVIDENCE': 'Additional information required'
  };
  return map[status] || status;
}

function getTimeline(requestId) {
  const events = getAuditForRequest(requestId);
  const verifications = getVerificationsForRequest(requestId);
  const timeline = [];
  for (const e of events) {
    timeline.push({
      type: 'lifecycle',
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actor: e.actor,
      actorType: e.actorType,
      timestamp: e.timestamp,
      note: e.note,
      releaseId: e.releaseId || null
    });
  }
  for (const v of verifications) {
    timeline.push({
      type: 'verification',
      result: v.result,
      actor: v.verifiedBy,
      timestamp: v.verifiedAt,
      note: v.note,
      buildId: v.buildId,
      releaseId: v.releaseId || null
    });
  }
  timeline.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
  return timeline;
}

function verifyRequest(companyId, requestId, user, result, note) {
  if (result !== 'CONFIRMED' && result !== 'FAILED') {
    return { error: 'Invalid verification result', code: 'INVALID_REQUEST' };
  }
  const { store, record } = _findRequestInternal(requestId);
  if (!record) return { error: 'Request not found', code: 'REQUEST_NOT_FOUND' };
  if (String(record.companyId) !== String(companyId)) {
    return { error: 'Request not found', code: 'REQUEST_NOT_FOUND' };
  }
  if (record.status !== 'READY_FOR_CUSTOMER_VERIFICATION') {
    return { error: 'Verification is not allowed in status ' + record.status, code: 'VERIFICATION_NOT_ALLOWED' };
  }
  const current = buildIdentity.getBuildIdentity();
  const releaseMatch = verifyReleaseMatches(record);
  if (!releaseMatch.matches) {
    return { error: 'Release/build identity does not match the currently served build: ' + releaseMatch.reason, code: 'RELEASE_BUILD_MISMATCH' };
  }
  const verificationId = 'ver_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const now = new Date().toISOString();
  store.verifications.push({
    id: verificationId,
    requestId: record.id,
    companyId: record.companyId,
    releaseId: record.releaseId,
    buildId: current.buildId,
    artifactSha256: current.artifactSha256 || null,
    verifiedBy: user ? user.username : 'unknown',
    verifiedAt: now,
    result: result,
    note: _sanitizeText(note, 2000)
  });
  const fromStatus = record.status;
  if (result === 'CONFIRMED') {
    record.status = 'RESOLVED';
    record.resolution = _sanitizeText(note, 2000) || 'Customer confirmed resolution';
    record.customerVerifiedAt = now;
    record.customerVerifiedBy = user ? user.username : 'unknown';
    _appendAudit(store, record, fromStatus, 'RESOLVED', user ? user.username : 'unknown', 'customer', 'Customer confirmed resolution', record.releaseId);
  } else {
    record.status = 'REOPENED';
    record.resolution = '';
    _appendAudit(store, record, fromStatus, 'REOPENED', user ? user.username : 'unknown', 'customer', 'Customer reported issue remains', record.releaseId);
  }
  record.updatedAt = now;
  _saveStore(store);
  return { request: _sanitizeForResponse(record), verification: { id: verificationId, result: result } };
}

function reopenRequest(companyId, requestId, user, note) {
  const { store, record } = _findRequestInternal(requestId);
  if (!record) return { error: 'Request not found', code: 'REQUEST_NOT_FOUND' };
  if (String(record.companyId) !== String(companyId)) {
    return { error: 'Request not found', code: 'REQUEST_NOT_FOUND' };
  }
  const allowed = ALLOWED_TRANSITIONS[record.status] || [];
  if (!allowed.includes('REOPENED')) {
    return { error: 'Cannot reopen from status ' + record.status, code: 'INVALID_STATUS_TRANSITION' };
  }
  const fromStatus = record.status;
  record.status = 'REOPENED';
  record.updatedAt = new Date().toISOString();
  _appendAudit(store, record, fromStatus, 'REOPENED', user ? user.username : 'unknown', 'customer', _sanitizeText(note, 1000) || 'Reopened by customer', record.releaseId);
  _saveStore(store);
  return { request: _sanitizeForResponse(record) };
}

function getAuditForRequest(requestId) {
  const store = _readStore();
  return store.audit.filter(a => a && String(a.requestId) === String(requestId));
}

function getVerificationsForRequest(requestId) {
  const store = _readStore();
  return store.verifications.filter(v => v && String(v.requestId) === String(requestId));
}

function importHistorical(companyId, historicalEntries) {
  if (!Array.isArray(historicalEntries)) return { imported: 0, skipped: 0 };
  const store = _readStore();
  let imported = 0;
  let skipped = 0;
  for (const entry of historicalEntries) {
    if (!entry || !entry.customerRequestNumber) { skipped++; continue; }
    const exists = store.requests.find(r => r && String(r.customerRequestNumber) === String(entry.customerRequestNumber));
    if (exists) { skipped++; continue; }
    const record = _buildRequestRecord(
      companyId,
      entry.branchId || null,
      null,
      {
        title: _sanitizeText(entry.title, 200) || 'Historical request',
        description: _sanitizeText(entry.description, 5000) || '',
        type: VALID_TYPES.includes(String(entry.type || '').toUpperCase()) ? String(entry.type).toUpperCase() : 'BUG',
        priority: VALID_PRIORITIES.includes(String(entry.priority || '').toUpperCase()) ? String(entry.priority).toUpperCase() : 'P2',
        product: VALID_PRODUCTS.includes(String(entry.product || '').toUpperCase()) ? String(entry.product).toUpperCase() : 'ERP'
      },
      {
        status: VALID_STATUSES.includes(String(entry.status || '').toUpperCase()) ? String(entry.status).toUpperCase() : 'RELEASED',
        resolution: entry.resolution || '',
        createdAt: entry.createdAt || new Date().toISOString(),
        assignedTo: entry.assignedTo || null,
        releaseId: entry.releaseId || null,
        implementationCommits: entry.implementationCommits || [],
        testEvidence: entry.testEvidence || [],
        customerVerifiedAt: entry.customerVerifiedAt || null,
        customerVerifiedBy: entry.customerVerifiedBy || null,
        historicalSource: entry.historicalSource || 'manual_review'
      }
    );
    if (entry.customerRequestNumber) {
      record.id = 'hist_' + entry.customerRequestNumber;
      record.customerRequestNumber = entry.customerRequestNumber;
    } else {
      _attachRequestNumber(record);
    }
    store.requests.push(record);
    _appendAudit(store, record, null, record.status, 'system', 'system', 'Historical import: ' + (entry.historicalSource || 'manual_review'), record.releaseId);
    imported++;
  }
  _saveStore(store);
  return { imported: imported, skipped: skipped };
}

function getDefaultHistoricalForCompany(companyId) {
  const now = new Date().toISOString();
  // Read the real artifact sha256 from the update manifest — this is the
  // authoritative artifact identity that verification will compare against.
  const manifest = buildIdentity.getBuildIdentity();
  const baseRelease = {
    id: 'rel_v1.0.0',
    version: manifest.version || '1.0.0',
    buildId: manifest.buildId || '1.0.0',
    commitSha: manifest.commitSha || null,
    artifactSha256: manifest.artifactSha256 || null,
    product: 'OMNISTORE',
    environment: 'production',
    releasedAt: '2026-08-17T00:00:00.000Z',
    deployedAt: '2026-08-17T00:00:00.000Z',
    healthStatus: 'verified',
    releaseNotes: 'OmniStore ERP v1.0.0 — official commercial release.',
    rollbackTarget: null
  };
  return [
    {
      customerRequestNumber: 'CR-2026-0001',
      companyId: companyId,
      title: 'Cross-tenant write corruption and authorization hardening',
      description: 'Hardened multi-tenant isolation, branch-scoped RBAC, and server-authoritative tenant filtering.',
      product: 'ERP',
      type: 'BUG',
      priority: 'P0',
      status: 'RELEASED',
      resolution: 'Implemented and released. Awaiting customer verification.',
      createdAt: '2026-08-19T19:51:52.000Z',
      updatedAt: '2026-08-19T19:51:52.000Z',
      createdBy: 'system',
      releaseId: baseRelease,
      implementationCommits: ['50833cb', '24d1d3f', 'f132538', 'f2d83d4'],
      customerVerifiedAt: null,
      customerVerifiedBy: null,
      historicalSource: 'git_commit:50833cb,24d1d3f,f132538,f2d83d4'
    },
    {
      customerRequestNumber: 'CR-2026-0002',
      companyId: companyId,
      title: 'Duplicate invoice ID prevention',
      description: 'Idempotency and uniqueness guards on invoice creation via BaseRepository.createAsync().',
      product: 'ERP',
      type: 'BUG',
      priority: 'P1',
      status: 'RELEASED',
      resolution: 'Implemented and released. Awaiting customer verification.',
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
      createdBy: 'system',
      releaseId: baseRelease,
      implementationCommits: [],
      testEvidence: ['backend/tests/sales.test.js: POST with a duplicate id returns 400'],
      customerVerifiedAt: null,
      customerVerifiedBy: null,
      historicalSource: 'test_report:sales.test.js'
    },
    {
      customerRequestNumber: 'CR-2026-0003',
      companyId: companyId,
      title: 'Serial product cart — distinct lines for different serials',
      description: 'Serial picker preserves distinct serial lines in cart.',
      product: 'ERP',
      type: 'BUG',
      priority: 'P0',
      status: 'RELEASED',
      resolution: 'Implemented and released. Awaiting customer verification.',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
      createdBy: 'system',
      releaseId: baseRelease,
      implementationCommits: [],
      testEvidence: ['backend/tests/salesAsync.test.js'],
      customerVerifiedAt: null,
      customerVerifiedBy: null,
      historicalSource: 'handoff_document:ERP_CUSTOMER_EXPERIENCE_BACKLOG'
    },
    {
      customerRequestNumber: 'CR-2026-0004',
      companyId: companyId,
      title: 'Unauthorized module visibility — business type filtering',
      description: 'PlayStation and car_rental modules had no businessTypes restrictions. Module loader, navigation builder, and canAccessPage now enforce compatibility.',
      product: 'PLATFORM',
      type: 'BUG',
      priority: 'P1',
      status: 'RELEASED',
      resolution: 'Implemented and released. Awaiting customer verification.',
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
      createdBy: 'system',
      releaseId: baseRelease,
      implementationCommits: [],
      testEvidence: ['backend/tests/frontendNavScope.test.js'],
      customerVerifiedAt: null,
      customerVerifiedBy: null,
      historicalSource: 'handoff_document:OMNISTORE_CUSTOMER_HOTFIX_REPORT'
    },
    {
      customerRequestNumber: 'CR-2026-0005',
      companyId: companyId,
      title: 'Browser storage vs server authority — stale data',
      description: 'Customer browser localStorage may contain stale data diverging from server. Conservative documentation approach.',
      product: 'PLATFORM',
      type: 'BUG',
      priority: 'P2',
      status: 'RELEASED',
      resolution: 'Documentation created. No code rewrite (preserves offline-first architecture).',
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
      createdBy: 'system',
      releaseId: baseRelease,
      customerVerifiedAt: null,
      customerVerifiedBy: null,
      historicalSource: 'handoff_document:OMNISTORE_CUSTOMER_HOTFIX_REPORT'
    },
    {
      customerRequestNumber: 'CR-2026-0006',
      companyId: companyId,
      title: 'Owner PIN P0.00 display issue',
      description: 'Owner PIN zero-amount display bug. Per hotfix report, may have been a browser-side cash-flow data issue rather than a server-side purchases issue. Awaiting production evidence.',
      product: 'ERP',
      type: 'BUG',
      priority: 'P0',
      status: 'NEEDS_EVIDENCE',
      resolution: '',
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
      createdBy: 'system',
      releaseId: null,
      customerVerifiedAt: null,
      customerVerifiedBy: null,
      historicalSource: 'handoff_document:OMNISTORE_CUSTOMER_HOTFIX_REPORT'
    },
    {
      customerRequestNumber: 'CR-2026-0007',
      companyId: companyId,
      title: 'Webhook tenant context propagation',
      description: 'Webhook dispatch was missing tenant context, causing cross-tenant webhook leakage.',
      product: 'ERP',
      type: 'BUG',
      priority: 'P1',
      status: 'RELEASED',
      resolution: 'Implemented and released. Awaiting customer verification.',
      createdAt: '2026-08-21T20:57:05.000Z',
      updatedAt: '2026-08-21T20:57:05.000Z',
      createdBy: 'system',
      releaseId: baseRelease,
      implementationCommits: ['becddf6'],
      testEvidence: ['backend/tests/webhook.test.js', 'backend/tests/webhook.integration.test.js'],
      customerVerifiedAt: null,
      customerVerifiedBy: null,
      historicalSource: 'git_commit:becddf6'
    },
    {
      customerRequestNumber: 'CR-2026-0008',
      companyId: companyId,
      title: 'Generic login error messages',
      description: 'Login error message is generic for every failure. Backend already returns distinct codes (COMPANY_SUSPENDED, ACCOUNT_DISABLED, MFA_REQUIRED). Frontend improvement recommended.',
      product: 'ERP',
      type: 'CHANGE',
      priority: 'P2',
      status: 'RELEASED',
      resolution: 'Backend verified. Frontend improvement deferred to next phase.',
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
      createdBy: 'system',
      releaseId: baseRelease,
      customerVerifiedAt: null,
      customerVerifiedBy: null,
      historicalSource: 'handoff_document:ERP_CUSTOMER_EXPERIENCE_BACKLOG'
    }
  ];
}

function ensureHistoricalForCompany(companyId) {
  if (!companyId) return { imported: 0, skipped: 0 };
  const store = _readStore();
  const hasHistorical = store.requests.some(r => r && r.historical && String(r.companyId) === String(companyId));
  if (hasHistorical) return { imported: 0, skipped: 0 };
  const historical = getDefaultHistoricalForCompany(companyId);
  return importHistorical(companyId, historical);
}

function getBuildIdentityPublic() {
  return buildIdentity.getBuildIdentity();
}

function getArtifactIdentityPublic() {
  return buildIdentity.getArtifactIdentity();
}

function getAllowedTransitions() {
  return ALLOWED_TRANSITIONS;
}

module.exports = {
  VALID_TYPES,
  VALID_PRIORITIES,
  VALID_PRODUCTS,
  VALID_STATUSES,
  ALLOWED_TRANSITIONS,
  listForCompany,
  getByIdForCompany,
  createRequest,
  transitionStatus,
  verifyRequest,
  reopenRequest,
  getAuditForRequest,
  getVerificationsForRequest,
  importHistorical,
  ensureHistoricalForCompany,
  getDefaultHistoricalForCompany,
  verifyReleaseMatches,
  getBuildIdentityPublic,
  getArtifactIdentityPublic,
  getCustomerFacingStatus,
  getTimeline
};

'use strict';

const storageAdapter = require('../repositories/storageAdapter');
const assignmentService = require('./assignment.service');
const enrollmentService = require('./enrollment.service');
const logger = require('../utils/logger');

const STORE_KEY = 'educationAssignmentSubmissions';

const SUBMISSION_STATUSES = Object.freeze(['submitted', 'reviewed']);

const CONTENT_MAX_LEN = 5000;
const GRADE_MAX_LEN = 160;
const FEEDBACK_MAX_LEN = 2000;

const STUDENT_WRITABLE_FIELDS = Object.freeze({ content: 'string' });
const REVIEW_WRITABLE_FIELDS = Object.freeze({ grade: 'string', feedback: 'string' });

const FORBIDDEN_FIELDS = Object.freeze([
  'id',
  'tenantId',
  'companyId',
  'branchId',
  'userId',
  'ownerUserId',
  'assignmentId',
  'studentId',
  'status',
  'submittedAt',
  'reviewedAt',
  'createdAt',
  'updatedAt'
]);

class SubmissionConflictError extends Error {
  constructor() {
    super('this submission has already been reviewed');
    this.name = 'SubmissionConflictError';
    this.code = 'SUBMISSION_REVIEWED';
    this.conflict = true;
  }
}

class ReferenceValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReferenceValidationError';
    this.validation = [message];
  }
}

function _defaultDoc() {
  return { submissions: [] };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('assignmentSubmission.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(doc) {
  try {
    storageAdapter.write(STORE_KEY, doc);
  } catch (err) {
    logger.warn('assignmentSubmission.service: failed to write store', err.message);
  }
}

function _tenantId(tenantContext) {
  if (!tenantContext) return null;
  const t = tenantContext.tenantId || tenantContext.id;
  if (t === undefined || t === null || String(t) === '') return null;
  return String(t);
}

function _requireTenantId(tenantContext) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');
  return tid;
}

function _present(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function _now() {
  return new Date().toISOString();
}

function _generateId() {
  return 'sub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function _submissions(doc) {
  return Array.isArray(doc.submissions) ? doc.submissions : [];
}

function _validationError(errors) {
  const err = new Error(errors.join('; '));
  err.validation = errors;
  return err;
}

function _sanitize(payload, fields) {
  const src = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const clean = {};
  for (const key of Object.keys(fields)) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const value = src[key];
    if (value === null) {
      clean[key] = '';
      continue;
    }
    if (typeof value !== 'string') throw _validationError([key + ' must be a string']);
    clean[key] = value.trim();
  }
  return clean;
}

function _rejectFields(data, fields, errors) {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    if (Object.prototype.hasOwnProperty.call(data, key)) errors.push(key + ' is not allowed');
  }
  for (const key of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) errors.push(key + ' is not writable');
  }
  for (const key of fields) {
    if (Object.prototype.hasOwnProperty.call(data, key)) errors.push(key + ' is not writable');
  }
}

function _validateStudentWrite(data, allowedFields) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }
  const errors = [];
  _rejectFields(data, allowedFields, errors);
  if (data.content === undefined || data.content === null || String(data.content).trim() === '') {
    errors.push('content is required');
  } else if (typeof data.content !== 'string') {
    errors.push('content must be a string');
  } else if (data.content.trim().length > CONTENT_MAX_LEN) {
    errors.push('content must be at most ' + CONTENT_MAX_LEN + ' characters');
  }
  return errors;
}

function _validateReview(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['request body must be a JSON object'];
  }
  const errors = [];
  _rejectFields(data, ['content', 'assignmentId', 'studentId', 'status', 'submittedAt', 'reviewedAt'], errors);
  if (data.grade === undefined || data.grade === null || String(data.grade).trim() === '') {
    errors.push('grade is required');
  } else if (typeof data.grade !== 'string') {
    errors.push('grade must be a string');
  } else if (data.grade.trim().length > GRADE_MAX_LEN) {
    errors.push('grade must be at most ' + GRADE_MAX_LEN + ' characters');
  }
  if (data.feedback !== undefined && data.feedback !== null) {
    if (typeof data.feedback !== 'string') {
      errors.push('feedback must be a string');
    } else if (data.feedback.trim().length > FEEDBACK_MAX_LEN) {
      errors.push('feedback must be at most ' + FEEDBACK_MAX_LEN + ' characters');
    }
  }
  return errors;
}

function _assignmentInTenant(tenantId, assignmentId, requireActive) {
  const id = String(assignmentId || '').trim();
  if (!id) throw new ReferenceValidationError('assignmentId is required');
  const found = assignmentService.getAssignment({ tenantId }, id);
  if (!found) {
    throw new ReferenceValidationError('assignmentId does not reference an Assignment in this tenant');
  }
  if (requireActive && found.status !== 'active') {
    throw new ReferenceValidationError('assignmentId must reference an active Assignment');
  }
  return found;
}

function _assertStudentEnrolled(tenantId, studentId, classId) {
  if (!_present(studentId)) throw new ReferenceValidationError('studentId is required');
  const rows = enrollmentService.listEnrollments({ tenantId: String(tenantId) }, { studentId: String(studentId) }) || [];
  const enrolled = rows.some((row) => {
    return row &&
      String(row.status || '') === 'active' &&
      String(row.classId || '') === String(classId || '');
  });
  if (!enrolled) {
    throw new ReferenceValidationError("student is not actively enrolled in this assignment's class");
  }
}

function _findIndex(records, tenantId, id) {
  return records.findIndex((row) => {
    return String(row.id || '') === String(id) &&
      String(row.tenantId || '') === String(tenantId);
  });
}

function _findStudentSubmission(records, tenantId, assignmentId, studentId) {
  return records.findIndex((row) => {
    return String(row.tenantId || '') === String(tenantId) &&
      String(row.assignmentId || '') === String(assignmentId) &&
      String(row.studentId || '') === String(studentId);
  });
}

function listSubmissions(tenantContext, filters) {
  const tid = _requireTenantId(tenantContext);
  const f = (filters && typeof filters === 'object') ? filters : {};
  let rows = _submissions(_readStore()).filter((row) => String(row.tenantId || '') === tid);

  if (_present(f.assignmentId)) {
    const assignmentId = String(f.assignmentId).trim();
    rows = rows.filter((row) => String(row.assignmentId || '') === assignmentId);
  }
  if (_present(f.studentId)) {
    const studentId = String(f.studentId).trim();
    rows = rows.filter((row) => String(row.studentId || '') === studentId);
  }
  if (_present(f.status) && SUBMISSION_STATUSES.includes(String(f.status).trim())) {
    const status = String(f.status).trim();
    rows = rows.filter((row) => String(row.status || '') === status);
  }

  rows.sort((a, b) => {
    const left = String(a.submittedAt || '') + String(a.id || '');
    const right = String(b.submittedAt || '') + String(b.id || '');
    return left.localeCompare(right);
  });
  return rows.map((row) => ({ ...row }));
}

function getSubmission(tenantContext, id) {
  const tid = _requireTenantId(tenantContext);
  const rows = _submissions(_readStore());
  const index = _findIndex(rows, tid, id);
  if (index < 0) return null;
  return { ...rows[index] };
}

function getStudentSubmission(tenantContext, assignmentId, studentId) {
  const tid = _requireTenantId(tenantContext);
  const rows = _submissions(_readStore());
  const index = _findStudentSubmission(rows, tid, assignmentId, studentId);
  if (index < 0) return null;
  return { ...rows[index] };
}

function saveStudentSubmission(tenantContext, assignmentId, studentId, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateStudentWrite(input, ['grade', 'feedback']);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitize(input, STUDENT_WRITABLE_FIELDS);
  const assignment = _assignmentInTenant(tid, assignmentId, true);
  _assertStudentEnrolled(tid, studentId, assignment.classId);

  const doc = _readStore();
  const rows = _submissions(doc);
  const index = _findStudentSubmission(rows, tid, assignment.id, studentId);
  const now = _now();

  if (index >= 0) {
    const base = { ...rows[index] };
    if (base.status === 'reviewed') throw new SubmissionConflictError();
    const next = {
      ...base,
      id: base.id,
      tenantId: tid,
      assignmentId: base.assignmentId,
      studentId: base.studentId,
      content: String(clean.content).trim(),
      status: 'submitted',
      grade: base.grade || '',
      feedback: base.feedback || '',
      submittedAt: base.submittedAt,
      reviewedAt: base.reviewedAt || '',
      createdAt: base.createdAt,
      updatedAt: now
    };
    rows[index] = next;
    _writeStore({ ...doc, submissions: rows });
    return { ...next };
  }

  const record = {
    id: _generateId(),
    tenantId: tid,
    assignmentId: assignment.id,
    studentId: String(studentId),
    content: String(clean.content).trim(),
    status: 'submitted',
    grade: '',
    feedback: '',
    submittedAt: now,
    reviewedAt: '',
    createdAt: now,
    updatedAt: now
  };
  rows.push(record);
  _writeStore({ ...doc, submissions: rows });
  return { ...record };
}

function reviewSubmission(tenantContext, id, input) {
  const tid = _requireTenantId(tenantContext);
  const errors = _validateReview(input);
  if (errors.length) throw _validationError(errors);

  const clean = _sanitize(input, REVIEW_WRITABLE_FIELDS);
  const doc = _readStore();
  const rows = _submissions(doc);
  const index = _findIndex(rows, tid, id);
  if (index < 0) return null;

  const base = { ...rows[index] };
  const next = {
    ...base,
    id: base.id,
    tenantId: tid,
    assignmentId: base.assignmentId,
    studentId: base.studentId,
    content: base.content,
    status: 'reviewed',
    grade: String(clean.grade).trim(),
    feedback: clean.feedback || '',
    submittedAt: base.submittedAt,
    reviewedAt: _now(),
    createdAt: base.createdAt,
    updatedAt: _now()
  };
  rows[index] = next;
  _writeStore({ ...doc, submissions: rows });
  return { ...next };
}

module.exports = {
  listSubmissions,
  getSubmission,
  getStudentSubmission,
  saveStudentSubmission,
  reviewSubmission,
  SUBMISSION_STATUSES,
  STUDENT_WRITABLE_FIELDS,
  REVIEW_WRITABLE_FIELDS,
  FORBIDDEN_FIELDS,
  SubmissionConflictError,
  ReferenceValidationError,
  STORE_KEY
};

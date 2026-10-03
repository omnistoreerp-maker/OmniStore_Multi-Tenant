'use strict';

// Education Core — tenant-isolated learning-domain foundation.
//
// Real, persisted data layer behind the education surface (centers, teachers,
// students, courses, lessons, enrollments, lesson progress). It follows the
// exact conventions of its sibling `studentServicesPack.service.js`:
//   - persistence goes through the storage adapter (never the raw engine);
//   - every operation is scoped by a tenant context supplied by server-side
//     middleware (never from query/body/header);
//   - a client-supplied tenantId in a payload is always rejected;
//   - cross-entity references are validated to belong to the SAME tenant, so a
//     tenant can never link its records to another tenant's records (no
//     cross-tenant IDOR);
//   - all state is read-through/write-through JSON, so tests run hermetically
//     against a temp data dir.
//
// Ownership model:
//   tenant -> centers -> (teachers, students, courses)
//   course -> (lessons, enrollments)
//   enrollment -> lessonProgress
// A teacher may be attached to a center OR be tenant-global (centerId null).
// A course belongs to a center and is authored by a teacher.

const storageAdapter = require('../repositories/storageAdapter');
const logger = require('../utils/logger');

const STORE_KEY = 'educationCore';

const CENTER_STATUSES = ['active', 'inactive'];
const TEACHER_STATUSES = ['active', 'inactive'];
const STUDENT_STATUSES = ['active', 'inactive'];
const COURSE_STATUSES = ['draft', 'published', 'archived'];
const LESSON_STATUSES = ['draft', 'published'];
const ENROLLMENT_STATUSES = ['active', 'completed', 'cancelled'];

function _defaultDoc() {
  return {
    centers: [],
    teachers: [],
    students: [],
    courses: [],
    lessons: [],
    enrollments: [],
    lessonProgress: []
  };
}

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') {
      const doc = Object.assign(_defaultDoc(), raw);
      for (const key of Object.keys(_defaultDoc())) {
        if (!Array.isArray(doc[key])) doc[key] = [];
      }
      return doc;
    }
  } catch (err) {
    logger.warn('educationCore.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(data) {
  try {
    storageAdapter.write(STORE_KEY, data);
  } catch (err) {
    logger.warn('educationCore.service: failed to write store', err.message);
  }
}

function _now() {
  return new Date().toISOString();
}

function _generateId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function _tenantId(tenantContext) {
  if (!tenantContext) return null;
  const t = tenantContext.tenantId || tenantContext.id;
  return t != null && String(t) !== '' ? String(t) : null;
}

function _requireTenant(tenantContext) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');
  return tid;
}

function _rejectTenantIdInPayload(data) {
  if (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'tenantId')) {
    throw new Error('tenantId cannot be supplied in payload');
  }
}

// Trimmed, length-capped string. Returns '' for nullish input.
function _str(value, max) {
  if (value === undefined || value === null) return '';
  const s = String(value).trim();
  return max && s.length > max ? s.slice(0, max) : s;
}

function _requireName(value, field) {
  const name = _str(value, 200);
  if (!name) throw new Error(field + ' is required');
  return name;
}

function _strArray(value, max) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const s = _str(raw, max || 80);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function _enum(value, allowed, field, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(field + ' is required');
  }
  const s = String(value).trim();
  if (!allowed.includes(s)) throw new Error(field + ' must be one of: ' + allowed.join(', '));
  return s;
}

function _tenantCollection(doc, collection, tenantId) {
  const rows = Array.isArray(doc[collection]) ? doc[collection] : [];
  return rows.filter((r) => String(r.tenantId || '') === tenantId);
}

function _findOwned(doc, collection, tenantId, id) {
  const rows = Array.isArray(doc[collection]) ? doc[collection] : [];
  return rows.find((r) => String(r.id) === String(id) && String(r.tenantId || '') === tenantId) || null;
}

// Validates that a referenced entity exists AND belongs to the same tenant.
// This is the anti-cross-tenant-link guard: a tenant cannot attach its course
// to another tenant's teacher, enroll its student into another tenant's
// course, etc.
function _assertSameTenantRef(doc, collection, tenantId, id, label) {
  if (id === undefined || id === null || String(id) === '') return null;
  const found = _findOwned(doc, collection, tenantId, id);
  if (!found) throw new Error(label + ' not found');
  return found;
}

function _paginate(rows, query) {
  const q = query || {};
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 50));
  const start = (page - 1) * limit;
  return {
    items: rows.slice(start, start + limit),
    total: rows.length,
    page,
    limit,
    totalPages: Math.ceil(rows.length / limit) || 1
  };
}

function _matchesSearch(record, term, fields) {
  if (!term) return true;
  const needle = String(term).toLowerCase();
  return fields.some((f) => String(record[f] || '').toLowerCase().includes(needle));
}

// ---------------------------- CENTERS ----------------------------

function listCenters(tenantContext, query) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const q = query || {};
  let rows = _tenantCollection(doc, 'centers', tid);
  if (q.status) rows = rows.filter((r) => r.status === q.status);
  if (q.search) rows = rows.filter((r) => _matchesSearch(r, q.search, ['name', 'description', 'contactPhone', 'contactEmail']));
  rows = rows.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return _paginate(rows, q);
}

function getCenter(tenantContext, id) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const center = _findOwned(doc, 'centers', tid, id);
  if (!center) throw new Error('Center not found');
  return center;
}

function createCenter(tenantContext, data) {
  const tid = _requireTenant(tenantContext);
  _rejectTenantIdInPayload(data);
  const payload = data || {};
  const name = _requireName(payload.name, 'name');

  const doc = _readStore();
  const now = _now();
  const record = {
    id: _generateId('center'),
    tenantId: tid,
    name,
    description: _str(payload.description, 1000),
    contactPhone: _str(payload.contactPhone, 40),
    contactEmail: _str(payload.contactEmail, 160),
    address: _str(payload.address, 300),
    subjects: _strArray(payload.subjects),
    status: _enum(payload.status, CENTER_STATUSES, 'status', 'active'),
    createdAt: now,
    updatedAt: now
  };
  doc.centers.push(record);
  _writeStore(doc);
  return record;
}

function updateCenter(tenantContext, id, data) {
  const tid = _requireTenant(tenantContext);
  _rejectTenantIdInPayload(data);
  const payload = data || {};
  const doc = _readStore();
  const existing = _findOwned(doc, 'centers', tid, id);
  if (!existing) throw new Error('Center not found');

  if (payload.name !== undefined) existing.name = _requireName(payload.name, 'name');
  if (payload.description !== undefined) existing.description = _str(payload.description, 1000);
  if (payload.contactPhone !== undefined) existing.contactPhone = _str(payload.contactPhone, 40);
  if (payload.contactEmail !== undefined) existing.contactEmail = _str(payload.contactEmail, 160);
  if (payload.address !== undefined) existing.address = _str(payload.address, 300);
  if (payload.subjects !== undefined) existing.subjects = _strArray(payload.subjects);
  if (payload.status !== undefined) existing.status = _enum(payload.status, CENTER_STATUSES, 'status');

  existing.updatedAt = _now();
  _writeStore(doc);
  return existing;
}

function deleteCenter(tenantContext, id) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const center = _findOwned(doc, 'centers', tid, id);
  if (!center) throw new Error('Center not found');

  // Referential integrity: refuse to delete a center still in use.
  const cid = String(center.id);
  const usedBy =
    _tenantCollection(doc, 'teachers', tid).filter((t) => String(t.centerId || '') === cid).length +
    _tenantCollection(doc, 'students', tid).filter((s) => String(s.centerId || '') === cid).length +
    _tenantCollection(doc, 'courses', tid).filter((c) => String(c.centerId || '') === cid).length;
  if (usedBy > 0) throw new Error('Center has active teachers, students or courses and cannot be deleted');

  doc.centers = doc.centers.filter((r) => !(String(r.id) === String(id) && String(r.tenantId || '') === tid));
  _writeStore(doc);
  return { ok: true };
}

// ---------------------------- TEACHERS ----------------------------

function listTeachers(tenantContext, query) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const q = query || {};
  let rows = _tenantCollection(doc, 'teachers', tid);
  if (q.centerId) rows = rows.filter((r) => String(r.centerId || '') === String(q.centerId));
  if (q.status) rows = rows.filter((r) => r.status === q.status);
  if (q.search) rows = rows.filter((r) => _matchesSearch(r, q.search, ['displayName', 'bio']));
  rows = rows.slice().sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
  return _paginate(rows, q);
}

function getTeacher(tenantContext, id) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const teacher = _findOwned(doc, 'teachers', tid, id);
  if (!teacher) throw new Error('Teacher not found');
  return teacher;
}

function createTeacher(tenantContext, data) {
  const tid = _requireTenant(tenantContext);
  _rejectTenantIdInPayload(data);
  const payload = data || {};
  const displayName = _requireName(payload.displayName, 'displayName');

  const doc = _readStore();
  const centerId = payload.centerId ? String(payload.centerId) : null;
  if (centerId) _assertSameTenantRef(doc, 'centers', tid, centerId, 'Center');

  const now = _now();
  const record = {
    id: _generateId('teacher'),
    tenantId: tid,
    centerId,
    displayName,
    bio: _str(payload.bio, 2000),
    subjects: _strArray(payload.subjects),
    contactEmail: _str(payload.contactEmail, 160),
    status: _enum(payload.status, TEACHER_STATUSES, 'status', 'active'),
    createdAt: now,
    updatedAt: now
  };
  doc.teachers.push(record);
  _writeStore(doc);
  return record;
}

function updateTeacher(tenantContext, id, data) {
  const tid = _requireTenant(tenantContext);
  _rejectTenantIdInPayload(data);
  const payload = data || {};
  const doc = _readStore();
  const existing = _findOwned(doc, 'teachers', tid, id);
  if (!existing) throw new Error('Teacher not found');

  if (payload.displayName !== undefined) existing.displayName = _requireName(payload.displayName, 'displayName');
  if (payload.bio !== undefined) existing.bio = _str(payload.bio, 2000);
  if (payload.subjects !== undefined) existing.subjects = _strArray(payload.subjects);
  if (payload.contactEmail !== undefined) existing.contactEmail = _str(payload.contactEmail, 160);
  if (payload.status !== undefined) existing.status = _enum(payload.status, TEACHER_STATUSES, 'status');
  if (payload.centerId !== undefined) {
    const centerId = payload.centerId ? String(payload.centerId) : null;
    if (centerId) _assertSameTenantRef(doc, 'centers', tid, centerId, 'Center');
    existing.centerId = centerId;
  }

  existing.updatedAt = _now();
  _writeStore(doc);
  return existing;
}

function deleteTeacher(tenantContext, id) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const teacher = _findOwned(doc, 'teachers', tid, id);
  if (!teacher) throw new Error('Teacher not found');

  const teacherRef = String(teacher.id);
  const courses = _tenantCollection(doc, 'courses', tid).filter((c) => String(c.teacherId || '') === teacherRef).length;
  if (courses > 0) throw new Error('Teacher is assigned to courses and cannot be deleted');

  doc.teachers = doc.teachers.filter((r) => !(String(r.id) === String(id) && String(r.tenantId || '') === tid));
  _writeStore(doc);
  return { ok: true };
}

// ---------------------------- STUDENTS ----------------------------

function listStudents(tenantContext, query) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const q = query || {};
  let rows = _tenantCollection(doc, 'students', tid);
  if (q.centerId) rows = rows.filter((r) => String(r.centerId || '') === String(q.centerId));
  if (q.status) rows = rows.filter((r) => r.status === q.status);
  if (q.search) rows = rows.filter((r) => _matchesSearch(r, q.search, ['displayName', 'grade', 'contactPhone']));
  rows = rows.slice().sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
  return _paginate(rows, q);
}

function getStudent(tenantContext, id) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const student = _findOwned(doc, 'students', tid, id);
  if (!student) throw new Error('Student not found');
  return student;
}

function createStudent(tenantContext, data) {
  const tid = _requireTenant(tenantContext);
  _rejectTenantIdInPayload(data);
  const payload = data || {};
  const displayName = _requireName(payload.displayName, 'displayName');

  const doc = _readStore();
  const centerId = payload.centerId ? String(payload.centerId) : null;
  if (centerId) _assertSameTenantRef(doc, 'centers', tid, centerId, 'Center');

  const now = _now();
  const record = {
    id: _generateId('student'),
    tenantId: tid,
    centerId,
    displayName,
    grade: _str(payload.grade, 60),
    contactPhone: _str(payload.contactPhone, 40),
    guardianName: _str(payload.guardianName, 120),
    status: _enum(payload.status, STUDENT_STATUSES, 'status', 'active'),
    createdAt: now,
    updatedAt: now
  };
  doc.students.push(record);
  _writeStore(doc);
  return record;
}

function updateStudent(tenantContext, id, data) {
  const tid = _requireTenant(tenantContext);
  _rejectTenantIdInPayload(data);
  const payload = data || {};
  const doc = _readStore();
  const existing = _findOwned(doc, 'students', tid, id);
  if (!existing) throw new Error('Student not found');

  if (payload.displayName !== undefined) existing.displayName = _requireName(payload.displayName, 'displayName');
  if (payload.grade !== undefined) existing.grade = _str(payload.grade, 60);
  if (payload.contactPhone !== undefined) existing.contactPhone = _str(payload.contactPhone, 40);
  if (payload.guardianName !== undefined) existing.guardianName = _str(payload.guardianName, 120);
  if (payload.status !== undefined) existing.status = _enum(payload.status, STUDENT_STATUSES, 'status');
  if (payload.centerId !== undefined) {
    const centerId = payload.centerId ? String(payload.centerId) : null;
    if (centerId) _assertSameTenantRef(doc, 'centers', tid, centerId, 'Center');
    existing.centerId = centerId;
  }

  existing.updatedAt = _now();
  _writeStore(doc);
  return existing;
}

function deleteStudent(tenantContext, id) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const student = _findOwned(doc, 'students', tid, id);
  if (!student) throw new Error('Student not found');

  const studentRef = String(student.id);
  const enrollments = _tenantCollection(doc, 'enrollments', tid).filter((e) => String(e.studentId || '') === studentRef).length;
  if (enrollments > 0) throw new Error('Student has enrollments and cannot be deleted');

  doc.students = doc.students.filter((r) => !(String(r.id) === String(id) && String(r.tenantId || '') === tid));
  _writeStore(doc);
  return { ok: true };
}

// ---------------------------- COURSES ----------------------------

function listCourses(tenantContext, query) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const q = query || {};
  let rows = _tenantCollection(doc, 'courses', tid);
  if (q.centerId) rows = rows.filter((r) => String(r.centerId || '') === String(q.centerId));
  if (q.teacherId) rows = rows.filter((r) => String(r.teacherId || '') === String(q.teacherId));
  if (q.status) rows = rows.filter((r) => r.status === q.status);
  if (q.subject) rows = rows.filter((r) => String(r.subject || '') === String(q.subject));
  if (q.search) rows = rows.filter((r) => _matchesSearch(r, q.search, ['title', 'description', 'subject']));
  rows = rows.slice().sort((a, b) => String(a.title).localeCompare(String(b.title)));
  return _paginate(rows, q);
}

function getCourse(tenantContext, id) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const course = _findOwned(doc, 'courses', tid, id);
  if (!course) throw new Error('Course not found');
  return course;
}

function createCourse(tenantContext, data) {
  const tid = _requireTenant(tenantContext);
  _rejectTenantIdInPayload(data);
  const payload = data || {};
  const title = _requireName(payload.title, 'title');

  const doc = _readStore();
  const centerId = payload.centerId ? String(payload.centerId) : null;
  if (!centerId) throw new Error('centerId is required');
  _assertSameTenantRef(doc, 'centers', tid, centerId, 'Center');

  const teacherId = payload.teacherId ? String(payload.teacherId) : null;
  if (teacherId) _assertSameTenantRef(doc, 'teachers', tid, teacherId, 'Teacher');

  const now = _now();
  const record = {
    id: _generateId('course'),
    tenantId: tid,
    centerId,
    teacherId,
    title,
    description: _str(payload.description, 2000),
    subject: _str(payload.subject, 80),
    status: _enum(payload.status, COURSE_STATUSES, 'status', 'draft'),
    createdAt: now,
    updatedAt: now
  };
  doc.courses.push(record);
  _writeStore(doc);
  return record;
}

function updateCourse(tenantContext, id, data) {
  const tid = _requireTenant(tenantContext);
  _rejectTenantIdInPayload(data);
  const payload = data || {};
  const doc = _readStore();
  const existing = _findOwned(doc, 'courses', tid, id);
  if (!existing) throw new Error('Course not found');

  if (payload.title !== undefined) existing.title = _requireName(payload.title, 'title');
  if (payload.description !== undefined) existing.description = _str(payload.description, 2000);
  if (payload.subject !== undefined) existing.subject = _str(payload.subject, 80);
  if (payload.status !== undefined) existing.status = _enum(payload.status, COURSE_STATUSES, 'status');
  if (payload.centerId !== undefined) {
    const centerId = payload.centerId ? String(payload.centerId) : null;
    if (!centerId) throw new Error('centerId is required');
    _assertSameTenantRef(doc, 'centers', tid, centerId, 'Center');
    existing.centerId = centerId;
  }
  if (payload.teacherId !== undefined) {
    const teacherId = payload.teacherId ? String(payload.teacherId) : null;
    if (teacherId) _assertSameTenantRef(doc, 'teachers', tid, teacherId, 'Teacher');
    existing.teacherId = teacherId;
  }

  existing.updatedAt = _now();
  _writeStore(doc);
  return existing;
}

function deleteCourse(tenantContext, id) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const course = _findOwned(doc, 'courses', tid, id);
  if (!course) throw new Error('Course not found');

  const courseRef = String(course.id);
  const enrollments = _tenantCollection(doc, 'enrollments', tid).filter((e) => String(e.courseId || '') === courseRef);
  if (enrollments.length > 0) throw new Error('Course has enrollments and cannot be deleted');

  // Safe cascade: lessons belong exclusively to the course being removed.
  doc.lessons = doc.lessons.filter((l) => !(String(l.courseId || '') === courseRef && String(l.tenantId || '') === tid));
  doc.courses = doc.courses.filter((r) => !(String(r.id) === String(id) && String(r.tenantId || '') === tid));
  _writeStore(doc);
  return { ok: true };
}

// ---------------------------- LESSONS ----------------------------

function listLessons(tenantContext, courseId) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const course = _assertSameTenantRef(doc, 'courses', tid, courseId, 'Course');
  const rows = _tenantCollection(doc, 'lessons', tid)
    .filter((l) => String(l.courseId) === String(course.id))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  return rows;
}

function getLesson(tenantContext, id) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const lesson = _findOwned(doc, 'lessons', tid, id);
  if (!lesson) throw new Error('Lesson not found');
  return lesson;
}

function createLesson(tenantContext, data) {
  const tid = _requireTenant(tenantContext);
  _rejectTenantIdInPayload(data);
  const payload = data || {};
  const title = _requireName(payload.title, 'title');

  const doc = _readStore();
  const course = _assertSameTenantRef(doc, 'courses', tid, payload.courseId, 'Course');

  const siblings = _tenantCollection(doc, 'lessons', tid).filter((l) => String(l.courseId) === String(course.id));
  const order = payload.order !== undefined && payload.order !== null && String(payload.order) !== ''
    ? Math.max(1, parseInt(payload.order, 10) || (siblings.length + 1))
    : (siblings.length + 1);

  const now = _now();
  const record = {
    id: _generateId('lesson'),
    tenantId: tid,
    courseId: String(course.id),
    title,
    content: _str(payload.content, 20000),
    order,
    status: _enum(payload.status, LESSON_STATUSES, 'status', 'draft'),
    createdAt: now,
    updatedAt: now
  };
  doc.lessons.push(record);
  _writeStore(doc);
  return record;
}

function updateLesson(tenantContext, id, data) {
  const tid = _requireTenant(tenantContext);
  _rejectTenantIdInPayload(data);
  const payload = data || {};
  const doc = _readStore();
  const existing = _findOwned(doc, 'lessons', tid, id);
  if (!existing) throw new Error('Lesson not found');

  if (payload.title !== undefined) existing.title = _requireName(payload.title, 'title');
  if (payload.content !== undefined) existing.content = _str(payload.content, 20000);
  if (payload.status !== undefined) existing.status = _enum(payload.status, LESSON_STATUSES, 'status');
  if (payload.order !== undefined && payload.order !== null && String(payload.order) !== '') {
    existing.order = Math.max(1, parseInt(payload.order, 10) || existing.order);
  }

  existing.updatedAt = _now();
  _writeStore(doc);
  return existing;
}

function deleteLesson(tenantContext, id) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const lesson = _findOwned(doc, 'lessons', tid, id);
  if (!lesson) throw new Error('Lesson not found');

  const lessonRef = String(lesson.id);
  doc.lessonProgress = doc.lessonProgress.filter((p) => !(String(p.lessonId || '') === lessonRef && String(p.tenantId || '') === tid));
  doc.lessons = doc.lessons.filter((r) => !(String(r.id) === String(id) && String(r.tenantId || '') === tid));
  _writeStore(doc);
  return { ok: true };
}

// ---------------------------- ENROLLMENTS ----------------------------

function listEnrollments(tenantContext, query) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const q = query || {};
  let rows = _tenantCollection(doc, 'enrollments', tid);
  if (q.courseId) rows = rows.filter((r) => String(r.courseId || '') === String(q.courseId));
  if (q.studentId) rows = rows.filter((r) => String(r.studentId || '') === String(q.studentId));
  if (q.status) rows = rows.filter((r) => r.status === q.status);
  rows = rows.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return _paginate(rows, q);
}

function getEnrollment(tenantContext, id) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const enrollment = _findOwned(doc, 'enrollments', tid, id);
  if (!enrollment) throw new Error('Enrollment not found');
  return enrollment;
}

function createEnrollment(tenantContext, data) {
  const tid = _requireTenant(tenantContext);
  _rejectTenantIdInPayload(data);
  const payload = data || {};

  const doc = _readStore();
  const course = _assertSameTenantRef(doc, 'courses', tid, payload.courseId, 'Course');
  if (!course) throw new Error('courseId is required');
  if (course.status === 'archived') throw new Error('Cannot enroll in an archived course');
  const student = _assertSameTenantRef(doc, 'students', tid, payload.studentId, 'Student');
  if (!student) throw new Error('studentId is required');

  const duplicate = _tenantCollection(doc, 'enrollments', tid).find(
    (e) => String(e.courseId) === String(course.id) &&
      String(e.studentId) === String(student.id) &&
      e.status !== 'cancelled'
  );
  if (duplicate) throw new Error('Student is already enrolled in this course');

  const now = _now();
  const record = {
    id: _generateId('enrollment'),
    tenantId: tid,
    courseId: String(course.id),
    studentId: String(student.id),
    status: _enum(payload.status, ENROLLMENT_STATUSES, 'status', 'active'),
    enrolledAt: now,
    createdAt: now,
    updatedAt: now
  };
  doc.enrollments.push(record);
  _writeStore(doc);
  return record;
}

function updateEnrollmentStatus(tenantContext, id, status) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const existing = _findOwned(doc, 'enrollments', tid, id);
  if (!existing) throw new Error('Enrollment not found');
  existing.status = _enum(status, ENROLLMENT_STATUSES, 'status');
  existing.updatedAt = _now();
  _writeStore(doc);
  return existing;
}

function deleteEnrollment(tenantContext, id) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const enrollment = _findOwned(doc, 'enrollments', tid, id);
  if (!enrollment) throw new Error('Enrollment not found');

  const ref = String(enrollment.id);
  doc.lessonProgress = doc.lessonProgress.filter((p) => !(String(p.enrollmentId || '') === ref && String(p.tenantId || '') === tid));
  doc.enrollments = doc.enrollments.filter((r) => !(String(r.id) === String(id) && String(r.tenantId || '') === tid));
  _writeStore(doc);
  return { ok: true };
}

// ---------------------------- PROGRESS ----------------------------

// Marks a lesson complete/incomplete for a specific enrollment. The lesson MUST
// belong to the course the enrollment points at, and both must belong to the
// caller's tenant — so a student can never mark progress on a lesson from a
// course they are not enrolled in, or from another tenant.
function markLessonComplete(tenantContext, data) {
  const tid = _requireTenant(tenantContext);
  _rejectTenantIdInPayload(data);
  const payload = data || {};

  const doc = _readStore();
  const enrollment = _assertSameTenantRef(doc, 'enrollments', tid, payload.enrollmentId, 'Enrollment');
  if (!enrollment) throw new Error('enrollmentId is required');
  const lesson = _assertSameTenantRef(doc, 'lessons', tid, payload.lessonId, 'Lesson');
  if (!lesson) throw new Error('lessonId is required');
  if (String(lesson.courseId) !== String(enrollment.courseId)) {
    throw new Error('Lesson does not belong to the enrolled course');
  }

  const completed = payload.completed === undefined ? true : Boolean(payload.completed);
  const now = _now();
  let record = _tenantCollection(doc, 'lessonProgress', tid).find(
    (p) => String(p.enrollmentId) === String(enrollment.id) && String(p.lessonId) === String(lesson.id)
  );
  if (record) {
    record.completed = completed;
    record.completedAt = completed ? (record.completedAt || now) : null;
    record.updatedAt = now;
  } else {
    record = {
      id: _generateId('progress'),
      tenantId: tid,
      enrollmentId: String(enrollment.id),
      lessonId: String(lesson.id),
      completed,
      completedAt: completed ? now : null,
      createdAt: now,
      updatedAt: now
    };
    doc.lessonProgress.push(record);
  }
  _writeStore(doc);
  return record;
}

function _buildProgress(doc, tid, enrollment) {
  const lessons = _tenantCollection(doc, 'lessons', tid)
    .filter((l) => String(l.courseId) === String(enrollment.courseId))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const progressRows = _tenantCollection(doc, 'lessonProgress', tid)
    .filter((p) => String(p.enrollmentId) === String(enrollment.id));

  const byLesson = {};
  for (const p of progressRows) byLesson[String(p.lessonId)] = p;

  const items = lessons.map((l) => {
    const p = byLesson[String(l.id)];
    return {
      lessonId: String(l.id),
      title: l.title,
      order: l.order || 0,
      status: l.status,
      completed: !!(p && p.completed),
      completedAt: p && p.completed ? p.completedAt : null
    };
  });

  const totalLessons = items.length;
  const completedLessons = items.filter((i) => i.completed).length;
  const percentage = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

  return {
    enrollmentId: String(enrollment.id),
    courseId: String(enrollment.courseId),
    studentId: String(enrollment.studentId),
    status: enrollment.status,
    totalLessons,
    completedLessons,
    percentage,
    lessons: items
  };
}

function getEnrollmentProgress(tenantContext, enrollmentId) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const enrollment = _findOwned(doc, 'enrollments', tid, enrollmentId);
  if (!enrollment) throw new Error('Enrollment not found');
  return _buildProgress(doc, tid, enrollment);
}

function getStudentCourseProgress(tenantContext, studentId, courseId) {
  const tid = _requireTenant(tenantContext);
  const doc = _readStore();
  const enrollment = _tenantCollection(doc, 'enrollments', tid).find(
    (e) => String(e.studentId) === String(studentId) &&
      String(e.courseId) === String(courseId) &&
      e.status !== 'cancelled'
  );
  if (!enrollment) throw new Error('Enrollment not found');
  return _buildProgress(doc, tid, enrollment);
}

module.exports = {
  // centers
  listCenters,
  getCenter,
  createCenter,
  updateCenter,
  deleteCenter,
  // teachers
  listTeachers,
  getTeacher,
  createTeacher,
  updateTeacher,
  deleteTeacher,
  // students
  listStudents,
  getStudent,
  createStudent,
  updateStudent,
  deleteStudent,
  // courses
  listCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
  // lessons
  listLessons,
  getLesson,
  createLesson,
  updateLesson,
  deleteLesson,
  // enrollments
  listEnrollments,
  getEnrollment,
  createEnrollment,
  updateEnrollmentStatus,
  deleteEnrollment,
  // progress
  markLessonComplete,
  getEnrollmentProgress,
  getStudentCourseProgress
};








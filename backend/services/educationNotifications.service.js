'use strict';

// educationNotifications.service.js — Phase 0 student-scoped notifications.
//
// WHY A THIN ADAPTER AND NOT A NEW STORE. OmniStore already owns a
// notification surface (backend/services/notificationEngine.service.js behind
// /tenant/notifications), but that surface is DELIVERY CONFIGURATION: Telegram
// and WhatsApp channel settings, alert toggles, per-tenant preferences. It has
// no per-recipient feed and no notion of a student. Building a second
// notification infrastructure next to it would duplicate the domain and add a
// store nobody else reads, so Phase 0 deliberately does NOT.
//
// WHAT THIS IS INSTEAD. A read-only COMPOSITION ADAPTER. Every item it returns
// is DERIVED on demand from records the Education services already store —
// attendance, grading and scheduling — scoped to one student inside one
// tenant. Nothing is persisted, nothing is queued, and no new package is
// added. The consequence is honest and worth stating: these are live facts
// about existing records, not a message history. If the underlying record is
// corrected or removed, the derived item disappears, because it never existed
// independently of it.
//
// TRUST. The tenant comes only from the trusted server-side context handed in
// by the controller (built by trustedTenantId(req)); it is never read from
// query, body or header. Every underlying service filters on that same tenant,
// so no item can describe another tenant's student. The student id is the one
// the caller was already authorised for: a linked student for /me, or a child
// on a linked guardian's own list.

const studentService = require('./student.service');
const enrollmentService = require('./enrollment.service');
const classService = require('./class.service');
const attendanceService = require('./attendance.service');
const schedulingService = require('./scheduling.service');
const gradingService = require('./grading.service');

const MAX_ITEMS = 50;

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

// Local calendar day as YYYY-MM-DD. Deliberately computed from the server's
// own clock: a client-supplied "today" would let the caller ask for any date,
// so it is never accepted.
function _today() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function _sortDesc(items) {
  return items.sort((a, b) => {
    const da = String(a.date || '');
    const db = String(b.date || '');
    if (da === db) return String(b.kind).localeCompare(String(a.kind));
    return db.localeCompare(da);
  });
}

// Everything below composes ONLY records the caller is already entitled to see:
// the student's own enrollments, the attendance/grades recorded against those
// enrollments, and the sessions of the classes those enrollments belong to.
function buildStudentNotifications(tenantContext, studentId) {
  const tid = _requireTenantId(tenantContext);
  const sid = String(studentId || '').trim();
  if (!sid) return [];

  const ctx = { tenantId: tid };
  const student = studentService.getStudent(ctx, sid);
  if (!student) return [];

  const enrollments = enrollmentService.listEnrollments(ctx, { studentId: sid }) || [];
  const enrollmentIds = new Set(enrollments.map(e => String(e.id)));
  const classIds = new Set(
    enrollments.map(e => String(e.classId || '')).filter(Boolean)
  );

  const today = _today();
  const items = [];

  // Attendance — absences and lateness, exactly as recorded.
  const attendance = attendanceService.listAttendance(ctx, { studentId: sid }) || [];
  for (const a of attendance) {
    const status = String(a.status || '');
    if (status !== 'absent' && status !== 'late') continue;
    items.push({
      id: 'attendance-' + String(a.id),
      kind: status === 'absent' ? 'attendance_absent' : 'attendance_late',
      date: String(a.attendanceDate || ''),
      title: status === 'absent' ? 'تم تسجيل غياب' : 'تم تسجيل تأخير',
      detail: status === 'absent'
        ? 'سُجّل غيابك في هذه الحصّة.'
        : 'سُجّل تأخيرك في هذه الحصّة.',
      attendanceId: String(a.id || ''),
      status
    });
  }

  // Grading — a grade exists only because a teacher recorded it.
  const grading = gradingService.listGrading(ctx, {}) || [];
  for (const g of grading) {
    if (!enrollmentIds.has(String(g.enrollmentId || ''))) continue;
    const grade = String(g.grade || '').trim();
    if (!grade) continue;
    items.push({
      id: 'grade-' + String(g.id),
      kind: 'grade_published',
      date: String(g.gradingDate || ''),
      title: 'تم تسجيل درجة جديدة',
      detail: 'الدرجة المسجلة: ' + grade,
      gradeId: String(g.id || ''),
      grade
    });
  }

  // Today's sessions — from the scheduling records of the enrolled classes.
  const sessions = schedulingService.listScheduling(ctx, { scheduledDate: today }) || [];
  const classById = {};
  for (const c of (classService.listClasses(ctx, {}) || [])) classById[String(c.id)] = c;
  for (const s of sessions) {
    if (!classIds.has(String(s.classId || ''))) continue;
    const cls = classById[String(s.classId || '')];
    items.push({
      id: 'session-' + String(s.id),
      kind: 'session_today',
      date: String(s.scheduledDate || today),
      title: 'حصّة اليوم',
      detail: [cls && cls.name ? cls.name : '', s.startTime ? 'من ' + s.startTime : '']
        .filter(Boolean).join(' — '),
      sessionId: String(s.id || ''),
      startTime: String(s.startTime || ''),
      endTime: String(s.endTime || '')
    });
  }

  return _sortDesc(items).slice(0, MAX_ITEMS);
}

module.exports = {
  buildStudentNotifications,
  MAX_ITEMS
};
'use strict';

const { success, error } = require('../utils/apiResponse');
const educationCore = require('../services/educationCore.service');
const logger = require('../utils/logger');

// The tenant is resolved exclusively from server-side request state: the
// reconstructed tenant context (tenantCarry) or the signed token claim. It is
// never read from query/body/header.
function _resolveTenantId(req) {
  if (req.tenantContext && req.tenantContext.tenantId) return String(req.tenantContext.tenantId);
  if (req.user && req.user.tenantId) return String(req.user.tenantId);
  return null;
}

function _handle(res, err, fallback) {
  const message = err && err.message ? err.message : fallback;
  logger.error('educationCore error:', message);
  const notFound = /not found/i.test(message);
  return error(res, message, notFound ? 404 : 400);
}

// ---------- centers ----------
function listCenters(req, res) {
  try { success(res, educationCore.listCenters({ tenantId: _resolveTenantId(req) }, req.query), 'Centers retrieved'); }
  catch (err) { _handle(res, err, 'Failed to retrieve centers'); }
}
function getCenter(req, res) {
  try { success(res, educationCore.getCenter({ tenantId: _resolveTenantId(req) }, req.params.id), 'Center retrieved'); }
  catch (err) { _handle(res, err, 'Failed to retrieve center'); }
}
function createCenter(req, res) {
  try { success(res, educationCore.createCenter({ tenantId: _resolveTenantId(req) }, req.body), 'Center created', 201); }
  catch (err) { _handle(res, err, 'Failed to create center'); }
}
function updateCenter(req, res) {
  try { success(res, educationCore.updateCenter({ tenantId: _resolveTenantId(req) }, req.params.id, req.body), 'Center updated'); }
  catch (err) { _handle(res, err, 'Failed to update center'); }
}
function deleteCenter(req, res) {
  try { success(res, educationCore.deleteCenter({ tenantId: _resolveTenantId(req) }, req.params.id), 'Center deleted'); }
  catch (err) { _handle(res, err, 'Failed to delete center'); }
}

// ---------- teachers ----------
function listTeachers(req, res) {
  try { success(res, educationCore.listTeachers({ tenantId: _resolveTenantId(req) }, req.query), 'Teachers retrieved'); }
  catch (err) { _handle(res, err, 'Failed to retrieve teachers'); }
}
function getTeacher(req, res) {
  try { success(res, educationCore.getTeacher({ tenantId: _resolveTenantId(req) }, req.params.id), 'Teacher retrieved'); }
  catch (err) { _handle(res, err, 'Failed to retrieve teacher'); }
}
function createTeacher(req, res) {
  try { success(res, educationCore.createTeacher({ tenantId: _resolveTenantId(req) }, req.body), 'Teacher created', 201); }
  catch (err) { _handle(res, err, 'Failed to create teacher'); }
}
function updateTeacher(req, res) {
  try { success(res, educationCore.updateTeacher({ tenantId: _resolveTenantId(req) }, req.params.id, req.body), 'Teacher updated'); }
  catch (err) { _handle(res, err, 'Failed to update teacher'); }
}
function deleteTeacher(req, res) {
  try { success(res, educationCore.deleteTeacher({ tenantId: _resolveTenantId(req) }, req.params.id), 'Teacher deleted'); }
  catch (err) { _handle(res, err, 'Failed to delete teacher'); }
}

// ---------- students ----------
function listStudents(req, res) {
  try { success(res, educationCore.listStudents({ tenantId: _resolveTenantId(req) }, req.query), 'Students retrieved'); }
  catch (err) { _handle(res, err, 'Failed to retrieve students'); }
}
function getStudent(req, res) {
  try { success(res, educationCore.getStudent({ tenantId: _resolveTenantId(req) }, req.params.id), 'Student retrieved'); }
  catch (err) { _handle(res, err, 'Failed to retrieve student'); }
}
function createStudent(req, res) {
  try { success(res, educationCore.createStudent({ tenantId: _resolveTenantId(req) }, req.body), 'Student created', 201); }
  catch (err) { _handle(res, err, 'Failed to create student'); }
}
function updateStudent(req, res) {
  try { success(res, educationCore.updateStudent({ tenantId: _resolveTenantId(req) }, req.params.id, req.body), 'Student updated'); }
  catch (err) { _handle(res, err, 'Failed to update student'); }
}
function deleteStudent(req, res) {
  try { success(res, educationCore.deleteStudent({ tenantId: _resolveTenantId(req) }, req.params.id), 'Student deleted'); }
  catch (err) { _handle(res, err, 'Failed to delete student'); }
}

// ---------- courses ----------
function listCourses(req, res) {
  try { success(res, educationCore.listCourses({ tenantId: _resolveTenantId(req) }, req.query), 'Courses retrieved'); }
  catch (err) { _handle(res, err, 'Failed to retrieve courses'); }
}
function getCourse(req, res) {
  try { success(res, educationCore.getCourse({ tenantId: _resolveTenantId(req) }, req.params.id), 'Course retrieved'); }
  catch (err) { _handle(res, err, 'Failed to retrieve course'); }
}
function createCourse(req, res) {
  try { success(res, educationCore.createCourse({ tenantId: _resolveTenantId(req) }, req.body), 'Course created', 201); }
  catch (err) { _handle(res, err, 'Failed to create course'); }
}
function updateCourse(req, res) {
  try { success(res, educationCore.updateCourse({ tenantId: _resolveTenantId(req) }, req.params.id, req.body), 'Course updated'); }
  catch (err) { _handle(res, err, 'Failed to update course'); }
}
function deleteCourse(req, res) {
  try { success(res, educationCore.deleteCourse({ tenantId: _resolveTenantId(req) }, req.params.id), 'Course deleted'); }
  catch (err) { _handle(res, err, 'Failed to delete course'); }
}

// ---------- lessons ----------
function listLessons(req, res) {
  try { success(res, educationCore.listLessons({ tenantId: _resolveTenantId(req) }, req.params.courseId), 'Lessons retrieved'); }
  catch (err) { _handle(res, err, 'Failed to retrieve lessons'); }
}
function getLesson(req, res) {
  try { success(res, educationCore.getLesson({ tenantId: _resolveTenantId(req) }, req.params.id), 'Lesson retrieved'); }
  catch (err) { _handle(res, err, 'Failed to retrieve lesson'); }
}
function createLesson(req, res) {
  try { success(res, educationCore.createLesson({ tenantId: _resolveTenantId(req) }, req.body), 'Lesson created', 201); }
  catch (err) { _handle(res, err, 'Failed to create lesson'); }
}
function updateLesson(req, res) {
  try { success(res, educationCore.updateLesson({ tenantId: _resolveTenantId(req) }, req.params.id, req.body), 'Lesson updated'); }
  catch (err) { _handle(res, err, 'Failed to update lesson'); }
}
function deleteLesson(req, res) {
  try { success(res, educationCore.deleteLesson({ tenantId: _resolveTenantId(req) }, req.params.id), 'Lesson deleted'); }
  catch (err) { _handle(res, err, 'Failed to delete lesson'); }
}

// ---------- enrollments ----------
function listEnrollments(req, res) {
  try { success(res, educationCore.listEnrollments({ tenantId: _resolveTenantId(req) }, req.query), 'Enrollments retrieved'); }
  catch (err) { _handle(res, err, 'Failed to retrieve enrollments'); }
}
function getEnrollment(req, res) {
  try { success(res, educationCore.getEnrollment({ tenantId: _resolveTenantId(req) }, req.params.id), 'Enrollment retrieved'); }
  catch (err) { _handle(res, err, 'Failed to retrieve enrollment'); }
}
function createEnrollment(req, res) {
  try { success(res, educationCore.createEnrollment({ tenantId: _resolveTenantId(req) }, req.body), 'Enrollment created', 201); }
  catch (err) { _handle(res, err, 'Failed to create enrollment'); }
}
function updateEnrollmentStatus(req, res) {
  try {
    const status = req.body ? req.body.status : undefined;
    success(res, educationCore.updateEnrollmentStatus({ tenantId: _resolveTenantId(req) }, req.params.id, status), 'Enrollment status updated');
  } catch (err) { _handle(res, err, 'Failed to update enrollment status'); }
}
function deleteEnrollment(req, res) {
  try { success(res, educationCore.deleteEnrollment({ tenantId: _resolveTenantId(req) }, req.params.id), 'Enrollment deleted'); }
  catch (err) { _handle(res, err, 'Failed to delete enrollment'); }
}

// ---------- progress ----------
function markLessonComplete(req, res) {
  try { success(res, educationCore.markLessonComplete({ tenantId: _resolveTenantId(req) }, req.body), 'Progress saved'); }
  catch (err) { _handle(res, err, 'Failed to save progress'); }
}
function getEnrollmentProgress(req, res) {
  try { success(res, educationCore.getEnrollmentProgress({ tenantId: _resolveTenantId(req) }, req.params.id), 'Progress retrieved'); }
  catch (err) { _handle(res, err, 'Failed to retrieve progress'); }
}
function getStudentCourseProgress(req, res) {
  try {
    const data = educationCore.getStudentCourseProgress(
      { tenantId: _resolveTenantId(req) }, req.params.studentId, req.params.courseId
    );
    success(res, data, 'Progress retrieved');
  } catch (err) { _handle(res, err, 'Failed to retrieve progress'); }
}

// ---------- dashboard (real counts only) ----------
function getDashboard(req, res) {
  try {
    const ctx = { tenantId: _resolveTenantId(req) };
    const centers = educationCore.listCenters(ctx, { limit: 200 });
    const teachers = educationCore.listTeachers(ctx, { limit: 200 });
    const students = educationCore.listStudents(ctx, { limit: 200 });
    const courses = educationCore.listCourses(ctx, { limit: 200 });
    const enrollments = educationCore.listEnrollments(ctx, { limit: 200 });

    success(res, {
      centers: centers.total,
      activeCenters: centers.items.filter((c) => c.status === 'active').length,
      teachers: teachers.total,
      students: students.total,
      courses: courses.total,
      publishedCourses: courses.items.filter((c) => c.status === 'published').length,
      enrollments: enrollments.total,
      activeEnrollments: enrollments.items.filter((e) => e.status === 'active').length,
      completedEnrollments: enrollments.items.filter((e) => e.status === 'completed').length
    }, 'Education dashboard retrieved');
  } catch (err) { _handle(res, err, 'Failed to retrieve dashboard'); }
}

module.exports = {
  listCenters, getCenter, createCenter, updateCenter, deleteCenter,
  listTeachers, getTeacher, createTeacher, updateTeacher, deleteTeacher,
  listStudents, getStudent, createStudent, updateStudent, deleteStudent,
  listCourses, getCourse, createCourse, updateCourse, deleteCourse,
  listLessons, getLesson, createLesson, updateLesson, deleteLesson,
  listEnrollments, getEnrollment, createEnrollment, updateEnrollmentStatus, deleteEnrollment,
  markLessonComplete, getEnrollmentProgress, getStudentCourseProgress,
  getDashboard
};



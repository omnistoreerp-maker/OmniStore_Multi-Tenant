'use strict';

// Education Core routes — mounted at /api/v1/tenant/education.
//
// Authorization follows the tenant add-on convention already used by
// studentServicesPack: reads require `settings.view`, writes require
// `settings.edit` (enforced only when AUTH_REQUIRED=true). This deliberately
// reuses the existing permission registry so no new role/permission group is
// introduced and the registry contract stays byte-stable.
//
// Tenant identity is never taken from the URL/body: the controller resolves it
// from server-side request state only.

const router = require('express').Router();
const ctrl = require('../controllers/educationCore.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermissionIfAuth } = require('../middleware/authorize');

const canView = requirePermissionIfAuth('settings.view');
const canEdit = requirePermissionIfAuth('settings.edit');

// dashboard
router.get('/dashboard', canView, asyncHandler(ctrl.getDashboard));

// centers
router.get('/centers', canView, asyncHandler(ctrl.listCenters));
router.post('/centers', canEdit, asyncHandler(ctrl.createCenter));
router.get('/centers/:id', canView, asyncHandler(ctrl.getCenter));
router.patch('/centers/:id', canEdit, asyncHandler(ctrl.updateCenter));
router.delete('/centers/:id', canEdit, asyncHandler(ctrl.deleteCenter));

// teachers
router.get('/teachers', canView, asyncHandler(ctrl.listTeachers));
router.post('/teachers', canEdit, asyncHandler(ctrl.createTeacher));
router.get('/teachers/:id', canView, asyncHandler(ctrl.getTeacher));
router.patch('/teachers/:id', canEdit, asyncHandler(ctrl.updateTeacher));
router.delete('/teachers/:id', canEdit, asyncHandler(ctrl.deleteTeacher));

// students
router.get('/students', canView, asyncHandler(ctrl.listStudents));
router.post('/students', canEdit, asyncHandler(ctrl.createStudent));
router.get('/students/:id', canView, asyncHandler(ctrl.getStudent));
router.patch('/students/:id', canEdit, asyncHandler(ctrl.updateStudent));
router.delete('/students/:id', canEdit, asyncHandler(ctrl.deleteStudent));
router.get('/students/:studentId/courses/:courseId/progress', canView, asyncHandler(ctrl.getStudentCourseProgress));

// courses
router.get('/courses', canView, asyncHandler(ctrl.listCourses));
router.post('/courses', canEdit, asyncHandler(ctrl.createCourse));
router.get('/courses/:id', canView, asyncHandler(ctrl.getCourse));
router.patch('/courses/:id', canEdit, asyncHandler(ctrl.updateCourse));
router.delete('/courses/:id', canEdit, asyncHandler(ctrl.deleteCourse));

// lessons (nested under a course for reads; flat collection for writes)
router.get('/courses/:courseId/lessons', canView, asyncHandler(ctrl.listLessons));
router.post('/lessons', canEdit, asyncHandler(ctrl.createLesson));
router.get('/lessons/:id', canView, asyncHandler(ctrl.getLesson));
router.patch('/lessons/:id', canEdit, asyncHandler(ctrl.updateLesson));
router.delete('/lessons/:id', canEdit, asyncHandler(ctrl.deleteLesson));

// enrollments
router.get('/enrollments', canView, asyncHandler(ctrl.listEnrollments));
router.post('/enrollments', canEdit, asyncHandler(ctrl.createEnrollment));
router.get('/enrollments/:id', canView, asyncHandler(ctrl.getEnrollment));
router.patch('/enrollments/:id/status', canEdit, asyncHandler(ctrl.updateEnrollmentStatus));
router.delete('/enrollments/:id', canEdit, asyncHandler(ctrl.deleteEnrollment));
router.get('/enrollments/:id/progress', canView, asyncHandler(ctrl.getEnrollmentProgress));

// progress
router.post('/progress/lesson', canEdit, asyncHandler(ctrl.markLessonComplete));

module.exports = router;

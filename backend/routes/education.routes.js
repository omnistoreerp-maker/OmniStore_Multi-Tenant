const router = require('express').Router();
const ctrl = require('../controllers/education.controller');
const { requirePermissionIfAuth } = require('../middleware/authorize');

const educationPerm = (p) => requirePermissionIfAuth('education.' + p);

router.get('/centers', educationPerm('centers.view'), ctrl.listCenters);
router.get('/centers/:id', educationPerm('centers.view'), ctrl.getCenter);
router.post('/centers', educationPerm('centers.create'), ctrl.createCenter);
router.patch('/centers/:id', educationPerm('centers.edit'), ctrl.updateCenter);

router.get('/teachers', educationPerm('teachers.view'), ctrl.listTeachers);
router.get('/teachers/:id', educationPerm('teachers.view'), ctrl.getTeacher);
router.post('/teachers', educationPerm('teachers.create'), ctrl.createTeacher);
router.patch('/teachers/:id', educationPerm('teachers.edit'), ctrl.updateTeacher);

router.get('/students', educationPerm('students.view'), ctrl.listStudents);
router.get('/students/:id', educationPerm('students.view'), ctrl.getStudent);
router.post('/students', educationPerm('students.create'), ctrl.createStudent);
router.patch('/students/:id', educationPerm('students.edit'), ctrl.updateStudent);

router.get('/enrollments', educationPerm('enrollments.view'), ctrl.listEnrollments);
router.get('/enrollments/:id', educationPerm('enrollments.view'), ctrl.getEnrollment);
router.post('/enrollments', educationPerm('enrollments.create'), ctrl.createEnrollment);
router.patch('/enrollments/:id', educationPerm('enrollments.edit'), ctrl.updateEnrollment);

module.exports = router;

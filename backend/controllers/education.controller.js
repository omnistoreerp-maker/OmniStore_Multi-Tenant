const educationService = require('../services/education.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

function listCenters(req, res) {
  try {
    const result = educationService.listCenters(req.tenantContext);
    success(res, result, 'Education centers retrieved');
  } catch (err) {
    logger.error('education.centers.list error:', err.message);
    error(res, err.message || 'Failed to retrieve education centers', 400);
  }
}

function getCenter(req, res) {
  try {
    const center = educationService.getCenter(req.tenantContext, req.params.id);
    if (!center) return error(res, 'Education center not found', 404);
    success(res, center, 'Education center retrieved');
  } catch (err) {
    logger.error('education.centers.get error:', err.message);
    error(res, err.message || 'Failed to retrieve education center', 400);
  }
}

function createCenter(req, res) {
  try {
    const center = educationService.createCenter(req.tenantContext, req.body);
    success(res, center, 'Education center created', 201);
  } catch (err) {
    logger.error('education.centers.create error:', err.message);
    error(res, err.message || 'Failed to create education center', 400);
  }
}

function updateCenter(req, res) {
  try {
    const center = educationService.updateCenter(req.tenantContext, req.params.id, req.body);
    if (!center) return error(res, 'Education center not found', 404);
    success(res, center, 'Education center updated');
  } catch (err) {
    logger.error('education.centers.update error:', err.message);
    error(res, err.message || 'Failed to update education center', 400);
  }
}

function listTeachers(req, res) {
  try {
    const result = educationService.listTeachers(req.tenantContext, req.query);
    success(res, result, 'Teachers retrieved');
  } catch (err) {
    logger.error('education.teachers.list error:', err.message);
    error(res, err.message || 'Failed to retrieve teachers', 400);
  }
}

function getTeacher(req, res) {
  try {
    const teacher = educationService.getTeacher(req.tenantContext, req.params.id);
    if (!teacher) return error(res, 'Teacher not found', 404);
    success(res, teacher, 'Teacher retrieved');
  } catch (err) {
    logger.error('education.teachers.get error:', err.message);
    error(res, err.message || 'Failed to retrieve teacher', 400);
  }
}

function createTeacher(req, res) {
  try {
    const teacher = educationService.createTeacher(req.tenantContext, req.body);
    success(res, teacher, 'Teacher created', 201);
  } catch (err) {
    logger.error('education.teachers.create error:', err.message);
    error(res, err.message || 'Failed to create teacher', 400);
  }
}

function updateTeacher(req, res) {
  try {
    const teacher = educationService.updateTeacher(req.tenantContext, req.params.id, req.body);
    if (!teacher) return error(res, 'Teacher not found', 404);
    success(res, teacher, 'Teacher updated');
  } catch (err) {
    logger.error('education.teachers.update error:', err.message);
    error(res, err.message || 'Failed to update teacher', 400);
  }
}

function listStudents(req, res) {
  try {
    const result = educationService.listStudents(req.tenantContext, req.query);
    success(res, result, 'Students retrieved');
  } catch (err) {
    logger.error('education.students.list error:', err.message);
    error(res, err.message || 'Failed to retrieve students', 400);
  }
}

function getStudent(req, res) {
  try {
    const student = educationService.getStudent(req.tenantContext, req.params.id);
    if (!student) return error(res, 'Student not found', 404);
    success(res, student, 'Student retrieved');
  } catch (err) {
    logger.error('education.students.get error:', err.message);
    error(res, err.message || 'Failed to retrieve student', 400);
  }
}

function createStudent(req, res) {
  try {
    const student = educationService.createStudent(req.tenantContext, req.body);
    success(res, student, 'Student created', 201);
  } catch (err) {
    logger.error('education.students.create error:', err.message);
    error(res, err.message || 'Failed to create student', 400);
  }
}

function updateStudent(req, res) {
  try {
    const student = educationService.updateStudent(req.tenantContext, req.params.id, req.body);
    if (!student) return error(res, 'Student not found', 404);
    success(res, student, 'Student updated');
  } catch (err) {
    logger.error('education.students.update error:', err.message);
    error(res, err.message || 'Failed to update student', 400);
  }
}

function listEnrollments(req, res) {
  try {
    const result = educationService.listEnrollments(req.tenantContext, req.query);
    success(res, result, 'Enrollments retrieved');
  } catch (err) {
    logger.error('education.enrollments.list error:', err.message);
    error(res, err.message || 'Failed to retrieve enrollments', 400);
  }
}

function getEnrollment(req, res) {
  try {
    const enrollment = educationService.getEnrollment(req.tenantContext, req.params.id);
    if (!enrollment) return error(res, 'Enrollment not found', 404);
    success(res, enrollment, 'Enrollment retrieved');
  } catch (err) {
    logger.error('education.enrollments.get error:', err.message);
    error(res, err.message || 'Failed to retrieve enrollment', 400);
  }
}

function createEnrollment(req, res) {
  try {
    const enrollment = educationService.createEnrollment(req.tenantContext, req.body);
    success(res, enrollment, 'Enrollment created', 201);
  } catch (err) {
    logger.error('education.enrollments.create error:', err.message);
    error(res, err.message || 'Failed to create enrollment', 400);
  }
}

function updateEnrollment(req, res) {
  try {
    const enrollment = educationService.updateEnrollment(req.tenantContext, req.params.id, req.body);
    if (!enrollment) return error(res, 'Enrollment not found', 404);
    success(res, enrollment, 'Enrollment updated');
  } catch (err) {
    logger.error('education.enrollments.update error:', err.message);
    error(res, err.message || 'Failed to update enrollment', 400);
  }
}

module.exports = {
  listCenters,
  getCenter,
  createCenter,
  updateCenter,
  listTeachers,
  getTeacher,
  createTeacher,
  updateTeacher,
  listStudents,
  getStudent,
  createStudent,
  updateStudent,
  listEnrollments,
  getEnrollment,
  createEnrollment,
  updateEnrollment
};

'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/assignmentSubmission.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission, requirePermissionOrSelf, requireLinkedStudent } = require('../middleware/authorize');

router.get('/assignments/:id/submissions', requirePermissionOrSelf('education.grading.view'), asyncHandler(ctrl.listSubmissions));
router.put('/assignments/:id/submission', requireLinkedStudent, asyncHandler(ctrl.saveSubmission));
router.patch('/assignments/:id/submissions/:submissionId/review', requirePermission('education.grading.edit'), asyncHandler(ctrl.reviewSubmission));

module.exports = router;

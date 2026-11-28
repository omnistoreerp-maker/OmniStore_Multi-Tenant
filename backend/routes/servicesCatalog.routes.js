'use strict';

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/servicesCatalog.controller');

// GET /api/v1/services/catalog — read-only, server-authoritative service catalog.
// Requires authentication. Returns only services the caller is authorized to discover.
router.get('/catalog', requireAuth, ctrl.getCatalog);

// Explicitly block non-GET methods on /catalog (read-only endpoint).
router.post('/catalog', (req, res) => {
  res.status(405).json({ success: false, message: 'Method not allowed', statusCode: 405, time: new Date().toISOString() });
});
router.put('/catalog', (req, res) => {
  res.status(405).json({ success: false, message: 'Method not allowed', statusCode: 405, time: new Date().toISOString() });
});
router.patch('/catalog', (req, res) => {
  res.status(405).json({ success: false, message: 'Method not allowed', statusCode: 405, time: new Date().toISOString() });
});
router.delete('/catalog', (req, res) => {
  res.status(405).json({ success: false, message: 'Method not allowed', statusCode: 405, time: new Date().toISOString() });
});

module.exports = router;

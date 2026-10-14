const router = require('express').Router();
const ctrl = require('../controllers/oauthMaster.controller');
const { loginRateLimiter, apiRateLimiter } = require('../middleware/security');
const config = require('../config');

// Google round-trips are throttled on the general API budget; the password
// step-up endpoints and the MFA completion get the strict login limiter —
// each surface with its own bucket so one flow can never starve another.
const stepUpLimiter = loginRateLimiter();
const mfaLimiter = loginRateLimiter();

router.get('/google/master', apiRateLimiter(config.rateLimitMax), ctrl.initiateMaster);
router.get('/google/master/callback', apiRateLimiter(config.rateLimitMax), ctrl.callbackMaster);
router.get('/google/master/link', apiRateLimiter(config.rateLimitMax), ctrl.initiateMasterLink);
router.get('/google/master/link-status', apiRateLimiter(config.rateLimitMax), ctrl.linkStatus);
router.post('/google/master/link-session', stepUpLimiter, ctrl.linkSession);
router.post('/google/master/mfa', mfaLimiter, ctrl.completeMfa);
router.post('/google/master/unlink', stepUpLimiter, ctrl.unlink);

module.exports = router;

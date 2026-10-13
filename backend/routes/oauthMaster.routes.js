const router = require('express').Router();
const ctrl = require('../controllers/oauthMaster.controller');
const { loginRateLimiter, apiRateLimiter } = require('../middleware/security');
const config = require('../config');

// Google round-trips are throttled on the general API budget; the two
// password-step-up endpoints get the strict login limiter.
const stepUpLimiter = loginRateLimiter();

router.get('/google/master', apiRateLimiter(config.rateLimitMax), ctrl.initiateMaster);
router.get('/google/master/callback', apiRateLimiter(config.rateLimitMax), ctrl.callbackMaster);
router.get('/google/master/link', apiRateLimiter(config.rateLimitMax), ctrl.initiateMasterLink);
router.post('/google/master/link-session', stepUpLimiter, ctrl.linkSession);
router.post('/google/master/unlink', stepUpLimiter, ctrl.unlink);

module.exports = router;

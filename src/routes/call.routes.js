const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { generateToken } = require('../controllers/call.controller');

const router = express.Router();

/**
 * GET /api/call/token?channel=call_{studentId}_{teacherId}&uid={numericUid}
 * Returns a short-lived Agora RTC publisher token.
 * Requires: Bearer JWT in Authorization header.
 */
router.get('/token', requireAuth, generateToken);

module.exports = router;

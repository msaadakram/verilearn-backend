'use strict';

const express = require('express');

const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { generateAgoraToken, validateJoin } = require('../controllers/call.controller');

const router = express.Router();

/**
 * GET /api/agora/token?channel=session_{teacherId}_{date}_{time}&uid={numericUid}
 *
 * Issues a 1-hour Agora PUBLISHER token.
 * Security: booking must exist, caller must be a participant,
 *           current time must be within session window.
 */
router.get('/token', requireAuth, asyncHandler(generateAgoraToken));

/**
 * GET /api/agora/validate-join?channel=session_{teacherId}_{date}_{time}
 *
 * Pre-flight check before the frontend initialises the Agora SDK.
 * Returns { allowed: true, booking } or 403 with a reason.
 */
router.get('/validate-join', requireAuth, asyncHandler(validateJoin));

module.exports = router;

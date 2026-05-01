'use strict';

const express = require('express');

const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const {
    createBooking,
    getAvailableSlots,
    getMyBookings,
    cancelBooking,
    acceptBooking,
    declineBooking,
    getSessionStatus,
    joinSession,
    endSession,
    submitBookingReview,
    getTeacherReviews,
} = require('../controllers/booking.controller');

const router = express.Router();

/**
 * POST /api/book-session
 * Create a new session booking. No credits deducted at this point.
 */
router.post('/book-session', requireAuth, asyncHandler(createBooking));

/**
 * GET /api/teacher/:id/slots?date=YYYY-MM-DD
 * Return free time slots for a teacher on a specific date.
 */
router.get('/teacher/:id/slots', requireAuth, asyncHandler(getAvailableSlots));

/**
 * GET /api/teacher/:id/reviews
 * Return real student reviews for this teacher from completed bookings.
 */
router.get('/teacher/:id/reviews', requireAuth, asyncHandler(getTeacherReviews));

/**
 * GET /api/bookings/mine?status=pending|accepted|ongoing|completed|cancelled
 * Return all bookings for the authenticated user.
 */
router.get('/bookings/mine', requireAuth, asyncHandler(getMyBookings));

/**
 * PATCH /api/bookings/:id/cancel
 * Cancel a booking. No credits to refund.
 */
router.patch('/bookings/:id/cancel', requireAuth, asyncHandler(cancelBooking));

/**
 * PATCH /api/bookings/:id/accept
 * Teacher accepts a booking request (status → "accepted").
 */
router.patch('/bookings/:id/accept', requireAuth, asyncHandler(acceptBooking));

/**
 * PATCH /api/bookings/:id/decline
 * Teacher declines a booking request (status → "declined").
 */
router.patch('/bookings/:id/decline', requireAuth, asyncHandler(declineBooking));

/* ── Session lifecycle endpoints ─────────────────────────────────── */

/**
 * GET /api/session/:id
 * Get session status: join state, countdown info, duration.
 */
router.get('/session/:id', requireAuth, asyncHandler(getSessionStatus));

/**
 * POST /api/session/:id/join
 * Mark user as joined. If both joined → session starts.
 */
router.post('/session/:id/join', requireAuth, asyncHandler(joinSession));

/**
 * POST /api/session/:id/end
 * End session. Calculate actual duration, transfer credits.
 */
router.post('/session/:id/end', requireAuth, asyncHandler(endSession));

/**
 * POST /api/bookings/:id/review
 * Student submits/updates review after completion.
 */
router.post('/bookings/:id/review', requireAuth, asyncHandler(submitBookingReview));

module.exports = router;

'use strict';

const Booking = require('../models/Booking');
const User = require('../models/User');
const { hasRole } = require('../utils/roles');
const { calculateSessionCredits } = require('../utils/sessionCredits');

/* ─────────────────────────── helpers ─────────────────────────────────────── */

/** Build the deterministic Agora channel name for a session. */
function buildChannelName(teacherId, date, time) {
    const shortId = String(teacherId).slice(-8);
    return `session_${shortId}_${date}_${time.replace(':', '')}`;
}

/** Normalise a "HH:MM" time string to comparable minutes since midnight. */
function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return -1;
    return h * 60 + m;
}

/** Parse a 12-hour time string like "6 AM", "12 PM" into 24-hour minutes. */
function parse12hToMinutes(str) {
    const parts = str.trim().match(/^(\d{1,2})\s*(AM|PM)$/i);
    if (!parts) return -1;
    let h = parseInt(parts[1], 10);
    const ampm = parts[2].toUpperCase();
    if (ampm === 'AM' && h === 12) h = 0;
    if (ampm === 'PM' && h !== 12) h += 12;
    return h * 60;
}

/**
 * Expand teacher availability ranges into 30-minute HH:MM slots.
 *
 * Input:  ['6 AM – 9 AM', '12 PM – 3 PM']
 * Output: ['06:00', '06:30', '07:00', …, '08:30', '12:00', '12:30', …, '14:30']
 */
function expandTimeRanges(rangeStrings) {
    const allSlots = [];

    for (const range of rangeStrings) {
        const separator = range.includes('–') ? '–' : '-';
        const [startPart, endPart] = range.split(separator).map((s) => s.trim());
        if (!startPart || !endPart) continue;

        const startMin = parse12hToMinutes(startPart);
        const endMin = parse12hToMinutes(endPart);
        if (startMin < 0 || endMin < 0 || startMin >= endMin) continue;

        for (let m = startMin; m < endMin; m += 30) {
            const hh = String(Math.floor(m / 60)).padStart(2, '0');
            const mm = String(m % 60).padStart(2, '0');
            allSlots.push(`${hh}:${mm}`);
        }
    }
    return allSlots;
}

/** Build a Date from YYYY-MM-DD + HH:MM strings. */
function buildScheduledDate(dateStr, timeStr) {
    return new Date(`${dateStr}T${timeStr}:00`);
}

/* ───────────────────────── POST /api/book-session ─────────────────────────── */

/**
 * Create a new session booking.
 * NO credit deduction at this point — credits are deducted only after the
 * actual session completes.
 *
 * Body: { teacherId, studentId, date, time, sessionDuration, bookingType?, message? }
 */
async function createBooking(req, res) {
    const {
        teacherId,
        studentId,
        date,
        time: rawTime,
        sessionDuration = 30,
        bookingType = 'slot',
        message = '',
    } = req.body;

    /* ── basic validation ── */
    if (!teacherId || !studentId || !date || !rawTime) {
        return res.status(400).json({ message: 'teacherId, studentId, date, and time are required.' });
    }

    if (String(req.user._id) !== String(studentId)) {
        return res.status(403).json({ message: 'You can only create bookings for yourself.' });
    }

    if (String(teacherId) === String(studentId)) {
        return res.status(400).json({ message: 'You cannot book a session with yourself.' });
    }

    const duration = Number(sessionDuration);
    if (!Number.isInteger(duration) || duration < 15 || duration > 240) {
        return res.status(400).json({ message: 'sessionDuration must be between 15 and 240 minutes.' });
    }

    /* ── normalise time to HH:MM ── */
    const timeParts = String(rawTime).match(/^(\d{1,2}):(\d{2})$/);
    if (!timeParts) {
        return res.status(400).json({ message: 'time must be in HH:MM (24-hour) format.' });
    }
    const time = `${timeParts[1].padStart(2, '0')}:${timeParts[2]}`;

    /* ── reject past times ── */
    const scheduledAt = buildScheduledDate(date, time);
    if (scheduledAt.getTime() <= Date.now()) {
        return res.status(400).json({ message: 'This time is in the past. Please select a future time.' });
    }

    /* ── load teacher ── */
    const teacher = await User.findById(teacherId).lean();
    if (!teacher) {
        return res.status(404).json({ message: 'Teacher not found.' });
    }
    if (!hasRole(teacher, 'teacher')) {
        return res.status(400).json({ message: 'The specified user is not a teacher.' });
    }

    /* ── soft credit check (warn, don't block) ── */
    const creditRate = teacher.teacherProfile?.creditRate || 30;
    const estimatedCredits = Math.ceil(duration / creditRate);
    const student = await User.findById(studentId).lean();
    if (!student) {
        return res.status(404).json({ message: 'Student not found.' });
    }
    const studentCredits = student.learningCredits ?? 0;
    const hasEnoughCredits = studentCredits >= estimatedCredits;
    const studentCreditsAtBooking = studentCredits;
    const hasEnoughCreditsAtBooking = hasEnoughCredits;
    const estimatedCreditsAtBooking = estimatedCredits;

    /* ── validate slot (if booking from schedule) ── */
    if (bookingType === 'slot') {
        const teacherSlots = teacher.teacherProfile?.timeSlots || [];
        const expandedSlots = expandTimeRanges(teacherSlots);
        if (expandedSlots.length > 0 && !expandedSlots.includes(time)) {
            return res.status(400).json({
                message: `${time} is not in this teacher's availability.`,
                availableSlots: expandedSlots,
            });
        }
        // Ensure the requested duration fits entirely within one availability range.
        if (teacherSlots.length > 0) {
            const startMin = timeToMinutes(time);
            const endMin = startMin + duration;
            let fits = false;
            for (const range of teacherSlots) {
                const separator = range.includes('–') ? '–' : '-';
                const [startPart, endPart] = range.split(separator).map((s) => s.trim());
                const rangeStart = parse12hToMinutes(startPart);
                const rangeEnd = parse12hToMinutes(endPart);
                if (rangeStart >= 0 && rangeEnd > rangeStart && startMin >= rangeStart && endMin <= rangeEnd) {
                    fits = true;
                    break;
                }
            }
            if (!fits) {
                return res.status(400).json({
                    message: `Requested duration (${duration}m) does not fit within the teacher's availability at ${time}.`,
                    availableSlots: expandedSlots,
                });
            }
        }
    }

    /* ── check for teacher slot conflict ── */
    const newStart = scheduledAt.getTime();
    const newEnd = newStart + duration * 60 * 1000;

    const teacherConflict = await Booking.findOne({
        teacherId,
        status: { $in: ['accepted', 'ongoing'] },
        scheduledAt: { $lt: new Date(newEnd) },
        $expr: {
            $gt: [
                { $add: ['$scheduledAt', { $multiply: ['$sessionDuration', 60000] }] },
                new Date(newStart),
            ],
        },
    }).lean();
    if (teacherConflict) {
        return res.status(409).json({ message: 'This time slot conflicts with an existing booking for this teacher.' });
    }

    /* ── check for student double-booking ── */
    const studentConflict = await Booking.findOne({
        studentId,
        status: { $in: ['pending', 'accepted', 'ongoing'] },
        scheduledAt: { $lt: new Date(newEnd) },
        $expr: {
            $gt: [
                { $add: ['$scheduledAt', { $multiply: ['$sessionDuration', 60000] }] },
                new Date(newStart),
            ],
        },
    }).lean();
    if (studentConflict) {
        return res.status(409).json({ message: 'You already have a session at this time.' });
    }

    /* ── create booking (NO credit deduction) ── */
    const channelName = buildChannelName(teacherId, date, time);

    const booking = await Booking.create({
        teacherId,
        studentId,
        date,
        time,
        sessionDuration: duration,
        bookingType,
        message: String(message).slice(0, 500),
        channelName,
        scheduledAt,
        status: 'pending',
        creditsUsed: 0,
        studentCreditsAtBooking,
        hasEnoughCreditsAtBooking,
        estimatedCreditsAtBooking,
        studentJoined: false,
        teacherJoined: false,
    });

    return res.status(201).json({
        message: 'Booking created successfully. Credits will be deducted after the session completes.',
        booking,
        channelName,
        estimatedCredits,
        studentCredits,
        hasEnoughCredits,
        studentCreditsAtBooking,
        hasEnoughCreditsAtBooking,
        estimatedCreditsAtBooking,
    });
}

/* ─────────────── GET /api/teacher/:id/slots?date=YYYY-MM-DD ────────────────── */

async function getAvailableSlots(req, res) {
    const { id: teacherId } = req.params;
    const { date } = req.query;

    if (!teacherId || !date) {
        return res.status(400).json({ message: 'teacherId and date are required.' });
    }

    const teacher = await User.findById(teacherId).lean();
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });

    const teacherSlots = teacher.teacherProfile?.timeSlots || [];
    const expandedSlots = expandTimeRanges(teacherSlots);
    const creditRate = teacher.teacherProfile?.creditRate || 30;

    /* find already-booked slots on this date for confirmed bookings only */
    const booked = await Booking.find({
        teacherId,
        date,
        status: { $in: ['accepted', 'ongoing'] },
    }).lean();
    // Build a set of 30-minute slots that are covered by existing bookings.
    // This ensures a 60-minute booking at 06:00 will block both 06:00 and 06:30.
    const bookedTimes = new Set();
    for (const b of booked) {
        const startMin = timeToMinutes(b.time);
        const dur = Number(b.sessionDuration) || 30;
        const endMin = startMin + dur;

        // Add each 30-minute step >= start and < end
        for (let m = startMin; m < endMin; m += 30) {
            const hh = String(Math.floor(m / 60)).padStart(2, '0');
            const mm = String(m % 60).padStart(2, '0');
            bookedTimes.add(`${hh}:${mm}`);
        }
    }

    const availableSlots = expandedSlots.filter((s) => !bookedTimes.has(s));

    return res.json({
        teacherId,
        date,
        creditRate,
        availableSlots,
        bookedSlots: [...bookedTimes],
    });
}

/* ───────────────────── GET /api/bookings/mine ──────────────────────────────── */

async function getMyBookings(req, res) {
    const userId = String(req.user._id);
    const { status } = req.query;

    const filter = {
        $or: [{ studentId: userId }, { teacherId: userId }],
    };
    if (status) filter.status = status;

    const bookings = await Booking.find(filter)
        .sort({ createdAt: -1 })
        .populate('teacherId', 'name email avatarUrl')
        .populate('studentId', 'name email avatarUrl')
        .lean();

    return res.json({ bookings });
}

/* ─────────────────── PATCH /api/bookings/:id/cancel ───────────────────────── */

/**
 * Cancel a booking. No credits to refund (nothing was deducted).
 */
async function cancelBooking(req, res) {
    const { id } = req.params;
    const userId = String(req.user._id);

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: 'Booking not found.' });

    if (String(booking.studentId) !== userId && String(booking.teacherId) !== userId) {
        return res.status(403).json({ message: 'You are not a participant of this booking.' });
    }

    if (['completed', 'cancelled', 'declined'].includes(booking.status)) {
        return res.status(400).json({ message: `Cannot cancel a booking with status "${booking.status}".` });
    }

    booking.status = 'cancelled';
    await booking.save();

    return res.json({ message: 'Booking cancelled.', booking });
}

/* ─────────────────── PATCH /api/bookings/:id/accept ───────────────────────── */

async function acceptBooking(req, res) {
    const { id } = req.params;
    const userId = String(req.user._id);

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: 'Booking not found.' });

    if (String(booking.teacherId) !== userId) {
        return res.status(403).json({ message: 'Only the teacher can accept this booking.' });
    }

    if (booking.status !== 'pending') {
        return res.status(400).json({ message: `Cannot accept a booking with status "${booking.status}".` });
    }

    /* ── teacher conflict check: ensure no overlapping accepted/ongoing session ── */
    const bStart = booking.scheduledAt.getTime();
    const bEnd = bStart + (booking.sessionDuration || 30) * 60 * 1000;

    const conflict = await Booking.findOne({
        teacherId: booking.teacherId,
        _id: { $ne: booking._id },
        status: { $in: ['accepted', 'ongoing'] },
        scheduledAt: { $lt: new Date(bEnd) },
        $expr: {
            $gt: [
                { $add: ['$scheduledAt', { $multiply: ['$sessionDuration', 60000] }] },
                new Date(bStart),
            ],
        },
    }).lean();
    if (conflict) {
        return res.status(409).json({ message: 'You already have an accepted session at this time. Decline or complete it first.' });
    }

    booking.status = 'accepted';
    await booking.save();

    return res.json({ message: 'Booking accepted.', booking });
}

/* ─────────────────── PATCH /api/bookings/:id/decline ──────────────────────── */

async function declineBooking(req, res) {
    const { id } = req.params;
    const userId = String(req.user._id);

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: 'Booking not found.' });

    if (String(booking.teacherId) !== userId) {
        return res.status(403).json({ message: 'Only the teacher can decline this booking.' });
    }

    if (!['pending', 'accepted'].includes(booking.status)) {
        return res.status(400).json({ message: `Cannot decline a booking with status "${booking.status}".` });
    }

    booking.status = 'declined';
    await booking.save();

    return res.json({ message: 'Booking declined.', booking });
}

/* ─────────────────── GET /api/session/:id ──────────────────────────────────── */

/**
 * Get full session status including join state, countdown, and duration info.
 */
async function getSessionStatus(req, res) {
    const { id } = req.params;
    const userId = String(req.user._id);

    const booking = await Booking.findById(id)
        .populate('teacherId', 'name email avatarUrl')
        .populate('studentId', 'name email avatarUrl')
        .lean();

    if (!booking) return res.status(404).json({ message: 'Session not found.' });

    if (String(booking.studentId._id || booking.studentId) !== userId &&
        String(booking.teacherId._id || booking.teacherId) !== userId) {
        return res.status(403).json({ message: 'You are not a participant of this session.' });
    }

    const now = new Date();
    const scheduledAt = booking.scheduledAt ? new Date(booking.scheduledAt) : null;
    const remainingMs = scheduledAt ? Math.max(0, scheduledAt.getTime() - now.getTime()) : 0;
    const canJoin = scheduledAt ? now.getTime() >= scheduledAt.getTime() - 5 * 60 * 1000 : false; // 5 min early

    let liveDurationSeconds = 0;
    if (booking.startTime && booking.status === 'ongoing') {
        liveDurationSeconds = Math.floor((now.getTime() - new Date(booking.startTime).getTime()) / 1000);
    }

    return res.json({
        booking,
        sessionInfo: {
            canJoin,
            remainingMs,
            remainingMinutes: Math.ceil(remainingMs / 60000),
            studentJoined: booking.studentJoined,
            teacherJoined: booking.teacherJoined,
            isOngoing: booking.status === 'ongoing',
            liveDurationSeconds,
            creditsUsed: booking.creditsUsed,
            actualDuration: booking.actualDuration,
        },
    });
}

/* ─────────────────── POST /api/session/:id/join ───────────────────────────── */

/**
 * Mark a user as joined for a session.
 * When both users have joined → set startTime, status = 'ongoing'.
 */
async function joinSession(req, res) {
    const { id } = req.params;
    const userId = String(req.user._id);

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: 'Session not found.' });

    const isStudent = String(booking.studentId) === userId;
    const isTeacher = String(booking.teacherId) === userId;
    if (!isStudent && !isTeacher) {
        return res.status(403).json({ message: 'You are not a participant of this session.' });
    }

    if (!['accepted', 'ongoing'].includes(booking.status)) {
        return res.status(400).json({
            message: `Cannot join session with status "${booking.status}". Session must be accepted first.`,
        });
    }

    // Mark joined
    if (isStudent) booking.studentJoined = true;
    if (isTeacher) booking.teacherJoined = true;

    // If both joined and session hasn't started yet → start it
    let bothJoined = false;
    if (booking.studentJoined && booking.teacherJoined && !booking.startTime) {
        booking.startTime = new Date();
        booking.status = 'ongoing';
        bothJoined = true;
    }

    await booking.save();

    return res.json({
        message: bothJoined
            ? 'Both participants joined. Session started!'
            : `You joined the session. Waiting for the ${isStudent ? 'teacher' : 'student'}...`,
        booking,
        bothJoined,
        startTime: booking.startTime,
    });
}

/* ─────────────────── POST /api/session/:id/end ────────────────────────────── */

/**
 * End an active session. Calculate actual duration and transfer credits.
 *
 * Credit calculation:
 *   actualDuration = (endTime - startTime) in minutes
 *   creditsUsed = ceil(actualDuration / teacher.creditRate)
 *   minimum 1 credit if session actually started
 *
 * Atomically: deduct from student, add to teacher.
 */
async function endSession(req, res) {
    const { id } = req.params;
    const userId = String(req.user._id);

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: 'Session not found.' });

    const isStudent = String(booking.studentId) === userId;
    const isTeacher = String(booking.teacherId) === userId;
    if (!isStudent && !isTeacher) {
        return res.status(403).json({ message: 'You are not a participant of this session.' });
    }

    if (booking.status === 'completed') {
        return res.status(400).json({ message: 'Session is already completed.' });
    }

    const now = new Date();
    booking.endTime = now;
    booking.status = 'completed';

    /* ── Calculate credits only if session actually started (both joined) ── */
    let creditsUsed = 0;
    let actualDurationMinutes = 0;

    if (booking.startTime) {
        // Fetch teacher credit rate once and apply the shared duration rule.
        const teacher = await User.findById(booking.teacherId).select('teacherProfile.creditRate').lean();
        const creditCalculation = calculateSessionCredits({
            startTime: booking.startTime,
            endTime: now,
            creditRate: teacher?.teacherProfile?.creditRate || 30,
        });

        actualDurationMinutes = creditCalculation.actualDurationMinutes;
        booking.actualDuration = creditCalculation.roundedDurationMinutes;

        // Calculate credits from the live session duration.
        creditsUsed = creditCalculation.creditsUsed;
        booking.creditsUsed = creditsUsed;

        // Atomic credit transfer: deduct from student, add to teacher
        const studentUpdate = await User.findOneAndUpdate(
            { _id: booking.studentId, learningCredits: { $gte: creditsUsed } },
            { $inc: { learningCredits: -creditsUsed } },
            { new: true },
        );

        if (studentUpdate) {
            // Only add to teacher if deduction succeeded
            await User.findByIdAndUpdate(
                booking.teacherId,
                { $inc: { learningCredits: creditsUsed } },
            );
        } else {
            // Student doesn't have enough credits — deduct whatever they have
            const student = await User.findById(booking.studentId);
            if (student && student.learningCredits > 0) {
                creditsUsed = student.learningCredits;
                booking.creditsUsed = creditsUsed;
                await User.findByIdAndUpdate(booking.studentId, { learningCredits: 0 });
                await User.findByIdAndUpdate(booking.teacherId, { $inc: { learningCredits: creditsUsed } });
            } else {
                creditsUsed = 0;
                booking.creditsUsed = 0;
            }
        }

        await User.findByIdAndUpdate(booking.teacherId, { $inc: { 'teacherProfile.successfulSessionCount': 1 } });
    } else {
        // Session never started (one party didn't join) → no credits
        booking.actualDuration = 0;
        booking.creditsUsed = 0;
    }

    await booking.save();

    // Fetch updated balances
    const [studentFinal, teacherFinal] = await Promise.all([
        User.findById(booking.studentId, 'learningCredits').lean(),
        User.findById(booking.teacherId, 'learningCredits').lean(),
    ]);
    const teacherAfterStats = await User.findById(booking.teacherId, 'teacherProfile.successfulSessionCount').lean();
    const successfulSessions = Number(teacherAfterStats?.teacherProfile?.successfulSessionCount) || 0;

    return res.json({
        message: creditsUsed > 0
            ? `Session completed. ${creditsUsed} credit${creditsUsed !== 1 ? 's' : ''} transferred.`
            : 'Session ended. No credits were deducted (session did not start).',
        booking,
        creditsUsed,
        actualDurationMinutes: Math.round(actualDurationMinutes),
        studentCreditsRemaining: studentFinal?.learningCredits ?? 0,
        teacherCreditsTotal: teacherFinal?.learningCredits ?? 0,
        teacherSessionStats: {
            successfulSessions,
            tier: successfulSessions >= 30 ? 'Diamond' : successfulSessions >= 10 ? 'Gold' : 'Bronze',
        },
    });
}

/* ───────────── POST /api/bookings/:id/review ─────────────────────────────── */

/**
 * Submit/update a student review for a completed booking.
 * Only the booking's student can submit this review.
 *
 * Body: { rating: 1..5, text?: string }
 */
async function submitBookingReview(req, res) {
    const { id } = req.params;
    const userId = String(req.user._id);
    const { rating, text = '' } = req.body || {};

    const parsedRating = Number(rating);
    if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
        return res.status(400).json({ message: 'rating must be an integer between 1 and 5.' });
    }

    const reviewText = String(text || '').trim();
    if (reviewText.length > 1000) {
        return res.status(400).json({ message: 'Review text must be 1000 characters or less.' });
    }

    const booking = await Booking.findById(id)
        .populate('studentId', 'name avatarUrl studentProfile.avatarUrl')
        .populate('teacherId', 'name avatarUrl teacherProfile.avatarUrl');

    if (!booking) {
        return res.status(404).json({ message: 'Booking not found.' });
    }

    if (String(booking.studentId?._id || booking.studentId) !== userId) {
        return res.status(403).json({ message: 'Only the student of this booking can submit a review.' });
    }

    if (booking.status !== 'completed') {
        return res.status(400).json({ message: 'You can only review a booking after session completion.' });
    }

    const now = new Date();
    booking.studentReview = {
        rating: parsedRating,
        text: reviewText,
        submittedAt: booking.studentReview?.submittedAt || now,
        updatedAt: now,
    };

    await booking.save();

    return res.json({
        message: 'Review saved successfully.',
        bookingId: booking._id,
        teacherId: booking.teacherId?._id || booking.teacherId,
        review: booking.studentReview,
    });
}

/* ───────────── GET /api/teacher/:id/reviews ──────────────────────────────── */

/**
 * Return aggregated teacher review stats and recent real student reviews.
 * Reviews are sourced ONLY from completed bookings with a submitted studentReview.
 */
async function getTeacherReviews(req, res) {
    const { id: teacherId } = req.params;

    const reviewBookings = await Booking.find({
        teacherId,
        status: 'completed',
        'studentReview.rating': { $gte: 1, $lte: 5 },
    })
        .sort({ 'studentReview.submittedAt': -1, updatedAt: -1 })
        .populate('studentId', 'name avatarUrl studentProfile.avatarUrl')
        .lean();

    const totalReviews = reviewBookings.length;
    const ratingSum = reviewBookings.reduce((sum, booking) => sum + Number(booking.studentReview?.rating || 0), 0);
    const averageRating = totalReviews > 0
        ? Number((ratingSum / totalReviews).toFixed(1))
        : 0;

    const distributionRaw = [5, 4, 3, 2, 1].map((stars) => {
        const count = reviewBookings.filter((booking) => Number(booking.studentReview?.rating) === stars).length;
        const percent = totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0;
        return { stars, count, percent };
    });

    const reviews = reviewBookings.map((booking) => {
        const student = booking.studentId || {};
        const studentId = student._id?.toString?.() || String(booking.studentId || '');
        const avatarUrl =
            student.avatarUrl
            || student.studentProfile?.avatarUrl
            || '';

        return {
            bookingId: booking._id,
            student: {
                id: studentId,
                name: student.name || 'Student',
                avatarUrl,
            },
            rating: Number(booking.studentReview?.rating || 0),
            text: booking.studentReview?.text || '',
            submittedAt: booking.studentReview?.submittedAt || booking.updatedAt,
            updatedAt: booking.studentReview?.updatedAt || booking.updatedAt,
        };
    });

    return res.json({
        teacherId,
        summary: {
            totalReviews,
            averageRating,
            distribution: distributionRaw,
        },
        reviews,
    });
}

module.exports = {
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
};

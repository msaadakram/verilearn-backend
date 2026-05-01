'use strict';

const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
const Booking = require('../models/Booking');

/* ─────────────────────────── constants ────────────────────────────────────── */

const TOKEN_EXPIRY_SECONDS = 3600; // 1 hour

/**
 * How many minutes before/after a session's scheduled start time to allow
 * a participant to obtain a token / join.
 *
 * -15 min  → early-join buffer so participants can do audio/video checks
 * +60 min  → session length grace window (matches default sessionLength)
 */
const EARLY_JOIN_BUFFER_MINUTES = 15;
const SESSION_DURATION_MINUTES = 90; // generous max; adjust per business rule

/* ─────────────────────────── helpers ─────────────────────────────────────── */

/**
 * Convert "YYYY-MM-DD" + "HH:MM" to a UTC Date object using the wall-clock
 * interpretation (no timezone conversion — both parties share the same PKT).
 */
function sessionStartDate(date, time) {
    return new Date(`${date}T${time}:00`);
}

/**
 * Check whether the current moment falls within the allowed joining window.
 *
 * Window: [sessionStart - EARLY_JOIN_BUFFER_MINUTES, sessionStart + SESSION_DURATION_MINUTES]
 */
function isWithinSessionWindow(date, time, now = new Date()) {
    const start = sessionStartDate(date, time);
    const windowStart = new Date(start.getTime() - EARLY_JOIN_BUFFER_MINUTES * 60 * 1000);
    const windowEnd = new Date(start.getTime() + SESSION_DURATION_MINUTES * 60 * 1000);
    return now >= windowStart && now <= windowEnd;
}

/**
 * Build and return the Agora RTC token.
 */
function buildAgoraToken(channel, uid) {
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!appId || !appCertificate) {
        const err = new Error('Agora credentials are not configured.');
        err.statusCode = 500;
        throw err;
    }

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + TOKEN_EXPIRY_SECONDS;

    const token = RtcTokenBuilder.buildTokenWithUid(
        appId,
        appCertificate,
        channel,
        uid,
        RtcRole.PUBLISHER,
        privilegeExpiredTs,
    );

    return { token, appId, expiresAt: new Date(privilegeExpiredTs * 1000).toISOString() };
}

/* ─────────────────── shared booking-lookup + access guard ─────────────────── */

/**
 * Resolves the booking for a given channel name and validates that the
 * authenticated user is a participant.
 *
 * Returns { booking } on success or sends an HTTP error response and returns null.
 */
async function resolveAndAuthorizeBooking(req, res, channel) {
    const callerId = req.user._id.toString();

    // 1. Find the booking by channelName
    const booking = await Booking.findOne({ channelName: channel }).lean();
    if (!booking) {
        res.status(404).json({ message: 'No booking found for this channel.' });
        return null;
    }

    // 2. Must be a participant
    const isParticipant =
        booking.studentId.toString() === callerId || booking.teacherId.toString() === callerId;

    if (!isParticipant) {
        res.status(403).json({ message: 'You are not authorised to join this session.' });
        return null;
    }

    // 3. Booking must be active
    if (booking.status === 'cancelled') {
        res.status(403).json({ message: 'This booking has been cancelled.' });
        return null;
    }

    if (booking.status === 'completed') {
        res.status(403).json({ message: 'This session has already been completed.' });
        return null;
    }

    // 4. Time-window check
    if (!isWithinSessionWindow(booking.date, booking.time)) {
        const start = sessionStartDate(booking.date, booking.time);
        const now = new Date();
        const diffMin = Math.round((start - now) / 60000);

        if (diffMin > 0) {
            res.status(403).json({
                message: `Session has not started yet. You can join ${EARLY_JOIN_BUFFER_MINUTES} minutes before the session.`,
                sessionStartsIn: `${diffMin} minutes`,
                sessionStartsAt: start.toISOString(),
            });
        } else {
            res.status(403).json({ message: 'This session window has expired.' });
        }
        return null;
    }

    return booking;
}

/* ─────────────── GET /api/agora/token?channel=&uid= ───────────────────────── */

/**
 * Issue a secure Agora RTC publisher token.
 *
 * Requirements:
 *   - Caller must be authenticated (JWT).
 *   - "channel" must match an active, non-cancelled booking's channelName.
 *   - Caller must be that booking's teacher or student.
 *   - Current time must be within the session window.
 */
async function generateAgoraToken(req, res) {
    const { channel, uid } = req.query;

    if (!channel || typeof channel !== 'string') {
        return res.status(400).json({ message: 'Query param "channel" is required.' });
    }

    const uidNumber = parseInt(uid, 10);
    if (!uid || Number.isNaN(uidNumber)) {
        return res.status(400).json({ message: 'Query param "uid" must be a valid integer.' });
    }

    const booking = await resolveAndAuthorizeBooking(req, res, channel);
    if (!booking) return; // response already sent

    try {
        const { token, appId, expiresAt } = buildAgoraToken(channel, uidNumber);

        return res.status(200).json({
            token,
            channel,
            uid: uidNumber,
            appId,
            expiresAt,
            booking: {
                _id: booking._id,
                date: booking.date,
                time: booking.time,
                status: booking.status,
            },
        });
    } catch (err) {
        console.error('[Agora] Token generation failed:', err);
        return res.status(err.statusCode || 500).json({ message: err.message || 'Failed to generate token.' });
    }
}

/* ─────────────── GET /api/agora/validate-join?channel= ────────────────────── */

/**
 * Pre-flight check used by the frontend before initialising the Agora SDK.
 * Returns { allowed: true, booking } or a 403 with a human-readable reason.
 */
async function validateJoin(req, res) {
    const { channel } = req.query;

    if (!channel || typeof channel !== 'string') {
        return res.status(400).json({ message: 'Query param "channel" is required.' });
    }

    const booking = await resolveAndAuthorizeBooking(req, res, channel);
    if (!booking) return; // response already sent

    return res.status(200).json({
        allowed: true,
        booking: {
            _id: booking._id,
            teacherId: booking.teacherId,
            studentId: booking.studentId,
            date: booking.date,
            time: booking.time,
            status: booking.status,
            channelName: booking.channelName,
        },
    });
}

/* ─────────────── GET /api/call/token (legacy — kept for compatibility) ─────── */

/**
 * Original simple token endpoint without booking validation.
 * Channel must still start with "call_" per old convention.
 * @deprecated – prefer /api/agora/token
 */
async function generateToken(req, res) {
    const { channel, uid } = req.query;

    if (!channel || typeof channel !== 'string') {
        return res.status(400).json({ message: 'Query param "channel" is required.' });
    }

    const uidNumber = parseInt(uid, 10);
    if (!uid || Number.isNaN(uidNumber)) {
        return res.status(400).json({ message: 'Query param "uid" must be a valid integer.' });
    }

    if (!channel.startsWith('call_') && !channel.startsWith('session_')) {
        return res.status(400).json({ message: 'Channel name must follow the format: call_{studentId}_{teacherId} or session_{id}_{date}_{time}.' });
    }

    // Prevent initiating a direct call to yourself: call_{id}_{id}
    if (channel.startsWith('call_')) {
        const parts = channel.split('_');
        // expected format: ['call', '<studentId>', '<teacherId>']
        if (parts.length >= 3) {
            const studentId = parts[1];
            const teacherId = parts[2];
            if (studentId === teacherId) {
                return res.status(400).json({ message: 'Cannot start a direct call with yourself.' });
            }

            // Require caller to be one of the participants
            const callerId = req.user && req.user._id ? req.user._id.toString() : null;
            if (callerId && callerId !== studentId && callerId !== teacherId) {
                return res.status(403).json({ message: 'You are not authorised to generate a token for this call channel.' });
            }
        }
    }

    try {
        const { token, appId, expiresAt } = buildAgoraToken(channel, uidNumber);
        return res.status(200).json({ token, channel, uid: uidNumber, appId, expiresAt });
    } catch (err) {
        console.error('[Call] Token generation failed:', err);
        return res.status(err.statusCode || 500).json({ message: err.message || 'Failed to generate call token.' });
    }
}

module.exports = { generateToken, generateAgoraToken, validateJoin };

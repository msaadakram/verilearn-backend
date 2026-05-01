'use strict';

const { Schema, model, Types } = require('mongoose');

/**
 * Booking schema – Session lifecycle
 *
 * Status flow:  pending → accepted → ongoing → completed
 *               pending → cancelled / declined
 *
 * Credits are ONLY deducted when the session completes (status → completed),
 * based on the actual call duration, not the planned duration.
 */
const bookingSchema = new Schema(
    {
        teacherId: {
            type: Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        studentId: {
            type: Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        /** ISO date string: YYYY-MM-DD */
        date: {
            type: String,
            required: true,
            match: /^\d{4}-\d{2}-\d{2}$/,
        },
        /** 24-hour time string: HH:MM */
        time: {
            type: String,
            required: true,
            match: /^\d{2}:\d{2}$/,
        },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'ongoing', 'completed', 'cancelled', 'declined'],
            default: 'pending',
            index: true,
        },
        /** Agora channel name — unique per booking */
        channelName: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        /** 'slot' = booked from teacher availability, 'request' = student-requested custom time */
        bookingType: {
            type: String,
            enum: ['slot', 'request'],
            default: 'slot',
        },
        /** Optional message from student */
        message: {
            type: String,
            maxlength: 500,
            default: '',
        },
        /** Planned session duration in minutes */
        sessionDuration: {
            type: Number,
            required: true,
            min: 15,
            max: 240,
            default: 30,
        },

        /* ── Session lifecycle fields ────────────────────────── */

        /** Combined date+time as a real Date for countdown timers */
        scheduledAt: {
            type: Date,
            default: null,
        },
        /** Whether the student has joined the session */
        studentJoined: {
            type: Boolean,
            default: false,
        },
        /** Whether the teacher has joined the session */
        teacherJoined: {
            type: Boolean,
            default: false,
        },
        /** When both users joined (session actually started) */
        startTime: {
            type: Date,
            default: null,
        },
        /** When the session ended */
        endTime: {
            type: Date,
            default: null,
        },
        /** Actual call duration in minutes */
        actualDuration: {
            type: Number,
            default: 0,
            min: 0,
        },
        /** Credits deducted from student / earned by teacher (set after call ends) */
        creditsUsed: {
            type: Number,
            default: 0,
            min: 0,
        },
        /** Student credit snapshot when the booking was created */
        studentCreditsAtBooking: {
            type: Number,
            default: 0,
            min: 0,
        },
        /** Whether the student already had enough credits at request time */
        hasEnoughCreditsAtBooking: {
            type: Boolean,
            default: false,
        },
        /** Estimated credits for the requested duration at booking time */
        estimatedCreditsAtBooking: {
            type: Number,
            default: 0,
            min: 0,
        },
        /** Student review submitted after session completion */
        studentReview: {
            rating: {
                type: Number,
                min: 1,
                max: 5,
                default: null,
            },
            text: {
                type: String,
                trim: true,
                maxlength: 1000,
                default: '',
            },
            submittedAt: {
                type: Date,
                default: null,
            },
            updatedAt: {
                type: Date,
                default: null,
            },
        },
    },
    {
        timestamps: true,
        versionKey: false,
    },
);

/**
 * Compound unique index – one teacher can only have one booking per (date + time).
 */
bookingSchema.index({ teacherId: 1, date: 1, time: 1 }, { unique: true });

module.exports = model('Booking', bookingSchema);

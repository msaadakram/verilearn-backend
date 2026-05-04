/**
 * Test script — inserts a completed booking with a 5-star review for ONE teacher.
 * The booking is NOT deleted so you can verify it on the frontend.
 *
 * Usage:  node test-add-review.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Booking = require('./src/models/Booking');
const bookingController = require('./src/controllers/booking.controller');

(async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            dbName: process.env.MONGODB_DB_NAME || 'verilearn',
        });
        console.log('✅ Connected to MongoDB');

        // ── Find a teacher (qualified) ──
        const teacher = await User.findOne({
            'teacherProfile.profileCompleted': true,
            'teacherProfile.assessment.passed': true,
        });
        if (!teacher) {
            console.error('❌ Could not find a qualified teacher in the DB.');
            process.exit(1);
        }

        // ── Find a student (any user that is NOT this teacher) ──
        const student = await User.findOne({ _id: { $ne: teacher._id } });
        if (!student) {
            console.error('❌ Could not find a second user to act as student.');
            process.exit(1);
        }

        console.log(`Student : ${student.name} (${student._id})`);
        console.log(`Teacher : ${teacher.name} (${teacher._id})`);

        // ── Create a completed booking with a review already attached ──
        const now = new Date();
        const thirtyMinAgo = new Date(now.getTime() - 30 * 60_000);

        const booking = await Booking.create({
            studentId: student._id,
            teacherId: teacher._id,
            date: now.toISOString().slice(0, 10),
            time: '10:00',
            sessionDuration: 30,
            bookingType: 'slot',
            status: 'completed',
            channelName: `test_review_${Date.now()}`,
            scheduledAt: thirtyMinAgo,
            startTime: thirtyMinAgo,
            endTime: now,
            actualDuration: 30,
            creditsUsed: 1,
            studentJoined: true,
            teacherJoined: true,
            studentReview: {
                rating: 5,
                text: 'Amazing session! The teacher explained everything clearly and was very patient. Highly recommended!',
                submittedAt: now,
                updatedAt: now,
            },
        });

        console.log(`\n🎉 Created completed booking with 5-star review:`);
        console.log(`   Booking ID : ${booking._id}`);
        console.log(`   Teacher    : ${teacher.name}`);
        console.log(`   Rating     : ⭐⭐⭐⭐⭐ (5/5)`);
        console.log(`   Review     : "${booking.studentReview.text}"`);

        // ── Verify by fetching the teacher reviews via the controller ──
        console.log('\n📊 Fetching teacher review stats via getTeacherReviews...');
        const statsResponse = await new Promise(resolve => {
            const req = { params: { id: teacher._id } };
            const res = {};
            res.status = () => res;
            res.json = (data) => { resolve(data); return res; };
            bookingController.getTeacherReviews(req, res).catch(console.error);
        });

        console.log('\n── Teacher Review Summary ──');
        console.log(JSON.stringify(statsResponse.summary, null, 2));
        console.log(`\nTotal reviews : ${statsResponse.reviews.length}`);
        if (statsResponse.reviews.length > 0) {
            console.log('Latest review :', JSON.stringify(statsResponse.reviews[0], null, 2));
        }

        console.log('\n✅ Test complete! The review is persistent — check the frontend to verify.');
        console.log('   Student Dashboard → Browse Tutors → the teacher card should show the updated rating.');
        console.log('   Teacher Profile → Reviews tab → should show the review card.');
    } catch (e) {
        console.error('❌ Test failed:', e);
    } finally {
        await mongoose.disconnect();
    }
})();

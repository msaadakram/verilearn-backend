require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Booking = require('./src/models/Booking');
const bookingController = require('./src/controllers/booking.controller');

(async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Connected to MongoDB database.");

        // Find a student and a teacher
        const student = await User.findOne({ profession: 'student', learningCredits: { $gt: 10 } });
        const teacher = await User.findOne({ 'teacherProfile.profileCompleted': true });

        if (!student || !teacher) {
            console.log("Could not find matching student/teacher in DB. Ensure you have seeded data.");
            process.exit(1);
        }
        console.log("Found Student:", student.name, "| Initial Credits:", student.learningCredits);
        console.log("Found Teacher:", teacher.name, "| Initial Credits:", teacher.learningCredits);

        // Create a mock ongoing booking started 30 mins ago
        const booking = await Booking.create({
            studentId: student._id,
            teacherId: teacher._id,
            date: '2026-05-04',
            time: '12:00',
            sessionDuration: 30,
            bookingType: 'slot',
            status: 'ongoing',
            channelName: 'test_channel',
            startTime: new Date(Date.now() - 30 * 60000),
            studentJoined: true,
            teacherJoined: true
        });
        console.log("\n1. Created an ongoing session booking for 30 duration:", booking._id);

        const makeRes = (resolve) => {
            const res = {};
            res.status = () => res;
            res.json = (data) => {
                resolve(data);
                return res;
            };
            return res;
        };

        // 2. End session (teacher ends it)
        console.log("\n2. Teacher terminating session (Atomically transferring credits...)");
        const endResponse = await new Promise(resolve => {
            const req = { params: { id: booking._id }, user: { _id: teacher._id } };
            bookingController.endSession(req, makeRes(resolve)).catch(console.error);
        });
        console.log("End Session Result:", {
            message: endResponse.message,
            creditsUsed: endResponse.creditsUsed,
            studentCreditsRemaining: endResponse.studentCreditsRemaining,
            teacherCreditsTotal: endResponse.teacherCreditsTotal,
        });

        // 3. Student submits review
        console.log("\n3. Student successfully submitting a 5-star review...");
        const reviewResponse = await new Promise(resolve => {
            const req = {
                params: { id: booking._id },
                user: { _id: student._id },
                body: { rating: 5, text: "Absolutely phenomenal teacher! Very helpful session." }
            };
            bookingController.submitBookingReview(req, makeRes(resolve)).catch(console.error);
        });
        console.log("Review Submit Result:", reviewResponse.message);

        // 4. Fetch the teacher's updated review state
        console.log("\n4. Pulling Teacher's public review and rating stats from API...");
        const statsResponse = await new Promise(resolve => {
            const req = { params: { id: teacher._id } };
            bookingController.getTeacherReviews(req, makeRes(resolve)).catch(console.error);
        });

        console.log("\nTeacher Final Summary:");
        console.log(JSON.stringify(statsResponse.summary, null, 2));

        console.log("\nTeacher Latest Review Object:");
        console.log(JSON.stringify(statsResponse.reviews[0], null, 2));

        // Clean up mock booking afterwards to keep DB clean
        await Booking.findByIdAndDelete(booking._id);
        console.log("\nTest Completed successfully. Cleaned up mock booking.");
    } catch (e) {
        console.error("Test failed:", e);
    } finally {
        await mongoose.disconnect();
    }
})();

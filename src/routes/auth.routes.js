const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole, requireAdmin } = require('../middleware/auth');
const { verifyCnicDocument } = require('../controllers/cnic.controller');
const {
	getMySubmission,
	getAllSubmissions,
	updateSubmissionStatus,
} = require('../controllers/cnicAdmin.controller');
const {
	signup,
	signin,
	verifyEmailVerificationCode,
	resendEmailVerificationCode,
	sendForgotPasswordCode,
	verifyForgotPasswordCode,
	resetPasswordWithCode,
	getCurrentUser,
	getUserById,
	uploadAvatar,
	getStudentProfile,
	updateStudentProfile,
	getQualifiedTeachersForStudent,
	getQualifiedTeacherDetailForStudent,
	getTeacherProfile,
	updateTeacherProfile,
	getStudentDashboardAccess,
	getTeacherDashboardAccess,
	getTeacherOnboardingStatus,
	updateTeacherSubjects,
	submitTeacherAssessment,
	switchAccountMode,
} = require('../controllers/auth.controller');

const router = express.Router();

/* ─── Auth-specific rate limiter (stricter than global) ─────────────── */
const authRateLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 10,
	standardHeaders: true,
	legacyHeaders: false,
	message: {
		message: 'Too many attempts. Please wait 15 minutes before trying again.',
	},
	skipSuccessfulRequests: true, // Only count failed/rejected requests
});

/* ─── File upload (CNIC image + profile avatar) ─────────────────────── */
const allowedMimeTypes = new Set([
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/webp',
	'image/bmp',
	'image/tiff',
]);

const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 8 * 1024 * 1024 },
	fileFilter: (_req, file, cb) => {
		if (allowedMimeTypes.has(file.mimetype)) {
			return cb(null, true);
		}
		return cb(new Error(`Unsupported file type: ${file.mimetype || 'unknown'}`));
	},
});

const profileAvatarUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 8 * 1024 * 1024 },
	fileFilter: (_req, file, cb) => {
		if (allowedMimeTypes.has(file.mimetype)) {
			return cb(null, true);
		}

		return cb(new Error(`Unsupported file type: ${file.mimetype || 'unknown'}`));
	},
});

function uploadCnicImage(req, res, next) {
	upload.fields([
		{ name: 'imageFront', maxCount: 1 },
		{ name: 'imageBack', maxCount: 1 },
	])(req, res, (error) => {
		if (!error) {
			return next();
		}

		if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
			return res.status(413).json({ message: 'Image size exceeds 8MB limit.' });
		}

		if (error instanceof multer.MulterError && error.code === 'LIMIT_UNEXPECTED_FILE') {
			return res.status(400).json({
				message: `Unexpected upload field: ${error.field || 'unknown'}. Expected "imageFront" and "imageBack".`,
			});
		}

		return res.status(400).json({ message: error.message || 'Invalid image upload.' });
	});
}

function uploadProfileAvatar(req, res, next) {
	profileAvatarUpload.single('avatar')(req, res, (error) => {
		if (!error) {
			return next();
		}

		if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
			return res.status(413).json({ message: 'Avatar image size exceeds 8MB limit.' });
		}

		if (error instanceof multer.MulterError && error.code === 'LIMIT_UNEXPECTED_FILE') {
			return res.status(400).json({
				message: `Unexpected upload field: ${error.field || 'unknown'}. Expected "avatar".`,
			});
		}

		return res.status(400).json({ message: error.message || 'Invalid avatar upload.' });
	});
}

/* ─── Auth routes (rate-limited) ─────────────────────────────────────── */
router.post('/signup', authRateLimiter, asyncHandler(signup));
router.post('/signin', authRateLimiter, asyncHandler(signin));
router.post('/email-verification/verify', asyncHandler(verifyEmailVerificationCode));
router.post('/email-verification/resend', authRateLimiter, asyncHandler(resendEmailVerificationCode));
router.post('/forgot-password/send-code', authRateLimiter, asyncHandler(sendForgotPasswordCode));
router.post('/forgot-password/verify-code', asyncHandler(verifyForgotPasswordCode));
router.post('/forgot-password/reset', authRateLimiter, asyncHandler(resetPasswordWithCode));

/* ─── User profile routes ─────────────────────────────────────────────── */
router.get('/me', requireAuth, asyncHandler(getCurrentUser));
router.get('/user/:id', requireAuth, asyncHandler(getUserById));
router.post('/upload-avatar', requireAuth, uploadProfileAvatar, asyncHandler(uploadAvatar));
router.get('/student-profile', requireAuth, requireRole('student'), asyncHandler(getStudentProfile));
router.put('/student-profile', requireAuth, requireRole('student'), uploadProfileAvatar, asyncHandler(updateStudentProfile));
router.get('/student/teachers', requireAuth, requireRole('student'), asyncHandler(getQualifiedTeachersForStudent));
router.get('/student/teachers/:teacherId', requireAuth, requireRole('student'), asyncHandler(getQualifiedTeacherDetailForStudent));
router.get('/teacher-profile', requireAuth, requireRole('teacher'), asyncHandler(getTeacherProfile));
router.put('/teacher-profile', requireAuth, requireRole('teacher'), uploadProfileAvatar, asyncHandler(updateTeacherProfile));
router.get('/dashboard/student', requireAuth, requireRole('student'), asyncHandler(getStudentDashboardAccess));
router.get('/dashboard/teacher', requireAuth, requireRole('teacher'), asyncHandler(getTeacherDashboardAccess));
router.get('/teacher-onboarding/status', requireAuth, requireRole('teacher'), asyncHandler(getTeacherOnboardingStatus));
router.put('/teacher-onboarding/subjects', requireAuth, requireRole('teacher'), asyncHandler(updateTeacherSubjects));
router.post('/teacher-onboarding/assessment', requireAuth, requireRole('teacher'), asyncHandler(submitTeacherAssessment));
router.post('/account/switch', requireAuth, asyncHandler(switchAccountMode));

/* ─── CNIC verification routes (teachers only) ───────────────────────── */
router.post(
	'/cnic/verify',
	requireAuth,
	requireRole('teacher'),
	uploadCnicImage,
	asyncHandler(verifyCnicDocument),
);
router.get('/cnic/my-submission', requireAuth, requireRole('teacher'), asyncHandler(getMySubmission));
router.get('/cnic/submissions', requireAuth, requireAdmin, asyncHandler(getAllSubmissions));
router.patch('/cnic/:id/status', requireAuth, requireAdmin, asyncHandler(updateSubmissionStatus));

module.exports = router;

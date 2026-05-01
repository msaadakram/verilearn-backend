const Joi = require('joi');
const CnicVerification = require('../models/CnicVerification');

const ALLOWED_STATUSES = ['Pending', 'Verified', 'Rejected'];

const updateStatusSchema = Joi.object({
    status: Joi.string().valid('Verified', 'Rejected').required(),
    rejectionReason: Joi.string().trim().max(500).when('status', {
        is: 'Rejected',
        then: Joi.required(),
        otherwise: Joi.optional().allow('', null),
    }),
});

/** GET /api/auth/cnic/my-submission
 *  Returns the teacher's latest CNIC submission (or null). */
async function getMySubmission(req, res) {
    // Populate userId so we get user details (not just ObjectId) — fixes "user = null" bug
    const submission = await CnicVerification.findOne({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .populate('userId', 'name email profession')
        .lean();

    return res.status(200).json({
        submission: submission ? serializeSubmission(submission) : null,
    });
}

/** GET /api/auth/cnic/submissions
 *  Returns all CNIC submissions (admin view), newest first. */
async function getAllSubmissions(req, res) {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const statusFilter = ALLOWED_STATUSES.includes(req.query.status)
        ? { status: req.query.status }
        : {};

    const [submissions, total] = await Promise.all([
        CnicVerification.find(statusFilter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('userId', 'name email profession')
            .populate('reviewedBy', 'name email')
            .lean(),
        CnicVerification.countDocuments(statusFilter),
    ]);

    return res.status(200).json({
        submissions: submissions.map((s) => serializeSubmissionWithUser(s)),
        total,
        page,
        totalPages: Math.ceil(total / limit),
    });
}

/** PATCH /api/auth/cnic/:id/status
 *  Approve or reject a CNIC submission. */
async function updateSubmissionStatus(req, res) {
    const { id } = req.params;

    const { error, value } = updateStatusSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
    });

    if (error) {
        return res.status(400).json({
            message: 'Invalid status update data.',
            errors: error.details.map((d) => d.message),
        });
    }

    const submission = await CnicVerification.findById(id);

    if (!submission) {
        return res.status(404).json({ message: 'CNIC submission not found.' });
    }

    submission.status = value.status;
    submission.rejectionReason = value.status === 'Rejected' ? value.rejectionReason : null;
    submission.reviewedBy = req.user._id;
    submission.reviewedAt = new Date();
    await submission.save();

    // Reload with populated fields so response has full user data
    const updated = await CnicVerification.findById(submission._id)
        .populate('userId', 'name email profession')
        .populate('reviewedBy', 'name email')
        .lean();

    return res.status(200).json({
        message: `Submission ${value.status.toLowerCase()} successfully.`,
        submission: serializeSubmissionWithUser(updated),
    });
}

/** Serialize a single teacher's own submission — userId is populated */
function serializeSubmission(doc) {
    const user = doc.userId;
    return {
        id: doc._id.toString(),
        userId: user?._id?.toString?.() ?? doc.userId?.toString?.() ?? '',
        tutorName: user?.name ?? '',
        tutorEmail: user?.email ?? '',
        cnicNumberEntered: doc.enteredCnicNumber || doc.cnicNumberEntered || '',
        enteredCnicNumber: doc.enteredCnicNumber || doc.cnicNumberEntered || '',
        parsedCnicNumber: doc.parsedCnicNumber ?? doc.ocrCnic ?? null,
        parsedDob: doc.parsedDob ?? doc.ocrDob ?? null,
        parsedName: doc.parsedName ?? null,
        parsedFatherOrHusbandName: doc.parsedFatherOrHusbandName ?? null,
        parsedGender: doc.parsedGender ?? null,
        parsedNationality: doc.parsedNationality ?? null,
        parsedIssueDate: doc.parsedIssueDate ?? null,
        parsedExpiryDate: doc.parsedExpiryDate ?? null,
        parsedAddress: doc.parsedAddress ?? null,
        parsedConfidence: doc.parsedConfidence ?? doc.ocrConfidence ?? null,
        parsedRawText: doc.parsedRawText || doc.ocrRawText || '',
        parsedOcrBackend: doc.parsedOcrBackend || doc.ocrBackend || '',
        parsedWarnings: doc.parsedWarnings ?? [],
        parsedGeminiJson: doc.parsedGeminiJson ?? doc.geminiResponseJson ?? null,
        cnicAvailable: doc.cnicAvailable ?? true,
        ocrCnic: doc.parsedCnicNumber ?? doc.ocrCnic ?? null,
        ocrDob: doc.parsedDob ?? doc.ocrDob ?? null,
        ocrRawText: doc.parsedRawText || doc.ocrRawText || '',
        ocrConfidence: doc.parsedConfidence ?? doc.ocrConfidence ?? null,
        ocrBackend: doc.parsedOcrBackend || doc.ocrBackend || '',
        geminiResponseJson: doc.parsedGeminiJson ?? doc.geminiResponseJson ?? null,
        status: doc.status,
        rejectionReason: doc.rejectionReason ?? null,
        reviewedBy: doc.reviewedBy
            ? { id: doc.reviewedBy._id?.toString?.() ?? doc.reviewedBy.toString(), name: doc.reviewedBy.name ?? '' }
            : null,
        reviewedAt: doc.reviewedAt ?? null,
        submittedAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

/** Serialize a submission from the admin list — userId is populated via .populate() */
function serializeSubmissionWithUser(doc) {
    return serializeSubmission(doc);
}

module.exports = {
    getMySubmission,
    getAllSubmissions,
    updateSubmissionStatus,
};

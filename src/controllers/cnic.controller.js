const { verifyCnicWithGemini } = require('../services/cnicVerification.service');
const CnicVerification = require('../models/CnicVerification');

const CNIC_CONFIDENCE_THRESHOLD = 0.5;

function normalizeCnic(rawValue) {
  const digits = (rawValue || '').toString().replace(/\D/g, '').slice(0, 13);

  if (digits.length !== 13) {
    return '';
  }

  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

function createVerificationError(statusCode, errorCode, message, details = null, retryable = false) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  error.details = details;
  error.retryable = retryable;
  return error;
}

async function verifyCnicDocument(req, res) {
  const frontImageFile = req.files?.imageFront?.[0];
  const backImageFile = req.files?.imageBack?.[0];

  if (!frontImageFile) {
    return res.status(400).json({ message: 'Front CNIC image is required in form-data key "imageFront".' });
  }

  if (!backImageFile) {
    return res.status(400).json({ message: 'Back CNIC image is required in form-data key "imageBack".' });
  }

  const cnicNumberEntered = normalizeCnic(req.body?.cnicNumber);

  if (!cnicNumberEntered) {
    return res.status(400).json({ message: 'Valid 13-digit CNIC number is required in "cnicNumber".' });
  }

  // Gemini-only submit flow: front image is sent for extraction.
  // Back image is required for submission completeness but not OCR-processed.
  const ocrResult = await verifyCnicWithGemini(frontImageFile);
  const parsedConfidence = Number.isFinite(Number(ocrResult.confidence))
    ? Number(ocrResult.confidence)
    : null;

  if (!ocrResult.cnic_available || !normalizeCnic(ocrResult.cnic)) {
    throw createVerificationError(
      422,
      'CNIC_NOT_FOUND',
      'No CNIC was detected in the uploaded front image. Please upload a clear CNIC image.',
      {
        ai_decision: {
          is_valid_cnic: false,
          confidence: parsedConfidence,
          confidence_threshold: CNIC_CONFIDENCE_THRESHOLD,
        },
        cnic_available: Boolean(ocrResult.cnic_available),
        parsed_cnic: ocrResult.cnic ?? null,
      },
    );
  }

  if (parsedConfidence == null || parsedConfidence <= CNIC_CONFIDENCE_THRESHOLD) {
    throw createVerificationError(
      422,
      'CNIC_LOW_CONFIDENCE',
      'The uploaded image confidence is too low to verify CNIC. Please upload a clearer, valid CNIC image.',
      {
        ai_decision: {
          is_valid_cnic: false,
          confidence: parsedConfidence,
          confidence_threshold: CNIC_CONFIDENCE_THRESHOLD,
        },
      },
      true,
    );
  }

  const parsedCnicNumber = normalizeCnic(ocrResult.cnic);

  if (parsedCnicNumber !== cnicNumberEntered) {
    throw createVerificationError(
      422,
      'CNIC_MISMATCH',
      'The CNIC number entered does not match the CNIC detected in the image. Please enter the correct CNIC number or upload the correct CNIC image.',
      {
        entered_cnic: cnicNumberEntered,
        parsed_cnic: parsedCnicNumber,
      },
    );
  }

  const existingSubmission = await CnicVerification.findOne({
    $or: [
      { parsedCnicNumber },
      { enteredCnicNumber: parsedCnicNumber },
      { cnicNumberEntered: parsedCnicNumber },
      { ocrCnic: parsedCnicNumber },
    ],
  }).select('_id userId status').lean();

  if (existingSubmission) {
    throw createVerificationError(
      409,
      'CNIC_ALREADY_REGISTERED',
      'This CNIC is already registered. Please use a different CNIC or update the existing record.',
      {
        parsed_cnic: parsedCnicNumber,
        existing_submission_id: existingSubmission._id.toString(),
        existing_status: existingSubmission.status,
      },
    );
  }

  const submissionPayload = {
    userId: req.user._id,
    enteredCnicNumber: cnicNumberEntered,
    parsedCnicNumber,
    parsedDob: ocrResult.dob ?? null,
    parsedName: ocrResult.name ?? null,
    parsedFatherOrHusbandName: ocrResult.father_or_husband_name ?? null,
    parsedGender: ocrResult.gender ?? null,
    parsedNationality: ocrResult.nationality ?? null,
    parsedIssueDate: ocrResult.issue_date ?? null,
    parsedExpiryDate: ocrResult.expiry_date ?? null,
    parsedAddress: ocrResult.address ?? null,
    parsedConfidence,
    parsedRawText: ocrResult.raw_text ?? ocrResult.text ?? '',
    parsedOcrBackend: ocrResult.ocr_backend ?? 'gemini',
    parsedWarnings: Array.isArray(ocrResult.warnings) ? ocrResult.warnings : [],
    parsedGeminiJson: ocrResult.gemini_json ?? null,
    cnicAvailable: Boolean(ocrResult.cnic_available),
    status: 'Verified',
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
  };

  let saved;

  try {
    saved = await CnicVerification.create(submissionPayload);
  } catch (error) {
    if (error?.code === 11000) {
      throw createVerificationError(
        409,
        'CNIC_ALREADY_REGISTERED',
        'This CNIC is already registered. Please use a different CNIC or update the existing record.',
        { parsed_cnic: parsedCnicNumber },
      );
    }

    throw error;
  }

  return res.status(200).json({
    message: 'CNIC verification completed successfully.',
    verificationStatus: 'Verified',
    aiDecision: {
      isValidCnic: true,
      confidence: saved.parsedConfidence,
      confidenceThreshold: CNIC_CONFIDENCE_THRESHOLD,
    },
    submissionId: saved._id.toString(),
    cnicNumberEntered: saved.enteredCnicNumber,
    cnic_available: saved.cnicAvailable,
    cnic: saved.parsedCnicNumber,
    dob: saved.parsedDob,
    name: saved.parsedName,
    father_or_husband_name: saved.parsedFatherOrHusbandName,
    gender: saved.parsedGender,
    nationality: saved.parsedNationality,
    issue_date: saved.parsedIssueDate,
    expiry_date: saved.parsedExpiryDate,
    address: saved.parsedAddress,
    confidence: saved.parsedConfidence,
    raw_text: saved.parsedRawText,
    text: saved.parsedRawText,
    ocr_backend: saved.parsedOcrBackend,
    warnings: saved.parsedWarnings,
    gemini_json: saved.parsedGeminiJson,
    status: saved.status,
  });
}

module.exports = {
  verifyCnicDocument,
};


const { Schema, model } = require('mongoose');

const cnicVerificationSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    enteredCnicNumber: {
      type: String,
      trim: true,
      default: '',
    },
    parsedCnicNumber: {
      type: String,
      trim: true,
      default: null,
      index: true,
      unique: true,
      sparse: true,
    },
    parsedDob: {
      type: String,
      default: null,
    },
    parsedName: {
      type: String,
      trim: true,
      default: null,
    },
    parsedFatherOrHusbandName: {
      type: String,
      trim: true,
      default: null,
    },
    parsedGender: {
      type: String,
      trim: true,
      default: null,
    },
    parsedNationality: {
      type: String,
      trim: true,
      default: null,
    },
    parsedIssueDate: {
      type: String,
      default: null,
    },
    parsedExpiryDate: {
      type: String,
      default: null,
    },
    parsedAddress: {
      type: String,
      default: null,
    },
    parsedConfidence: {
      type: Number,
      default: null,
    },
    parsedRawText: {
      type: String,
      default: '',
    },
    parsedOcrBackend: {
      type: String,
      default: '',
    },
    parsedWarnings: {
      type: [String],
      default: [],
    },
    parsedGeminiJson: {
      type: Schema.Types.Mixed,
      default: null,
    },
    cnicAvailable: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ['Pending', 'Verified', 'Rejected'],
      default: 'Pending',
      index: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: null,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

module.exports = model('CnicVerification', cnicVerificationSchema);

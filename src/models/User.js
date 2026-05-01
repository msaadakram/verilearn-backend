const { Schema, model } = require('mongoose');
const { VALID_ROLES, normalizeRole } = require('../utils/roles');

const studentProfileSchema = new Schema(
  {
    username: {
      type: String,
      trim: true,
      maxlength: 40,
      default: '',
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 600,
      default: '',
    },
    location: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    avatarUrl: {
      type: String,
      trim: true,
      default: '',
    },
    level: {
      type: String,
      enum: ['beginner', 'elementary', 'intermediate', 'advanced', 'expert'],
      default: 'intermediate',
    },
    subjects: {
      type: [String],
      default: [],
    },
    currentlyLearning: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },
    streak: {
      type: Number,
      default: 0,
      min: 0,
      max: 3650,
    },
    goals: {
      type: [String],
      default: [],
    },
    targetDate: {
      type: String,
      trim: true,
      default: '',
    },
    days: {
      type: [String],
      default: [],
    },
    timeSlots: {
      type: [String],
      default: [],
    },
    timezone: {
      type: String,
      trim: true,
      maxlength: 80,
      default: 'UTC+5 (PKT)',
    },
    weeklyHours: {
      type: Number,
      min: 1,
      max: 40,
      default: 5,
    },
    languages: {
      type: [String],
      default: ['English'],
    },
    sessionPrefs: {
      type: [String],
      default: ['1:1 Private sessions'],
    },
    learningStyle: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
  },
  {
    _id: false,
    id: false,
  },
);

const teacherAssessmentSchema = new Schema(
  {
    totalQuestions: {
      type: Number,
      default: 10,
      min: 1,
    },
    correctAnswers: {
      type: Number,
      default: 0,
      min: 0,
    },
    scorePercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    passed: {
      type: Boolean,
      default: false,
    },
    attemptedAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
    id: false,
  },
);

/* teacherPackageSchema removed — replaced by credit system */

const teacherEducationSchema = new Schema(
  {
    degree: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    institution: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
    },
    year: {
      type: String,
      trim: true,
      maxlength: 20,
      default: '',
    },
  },
  {
    _id: false,
    id: false,
  },
);

const teacherProfileSchema = new Schema(
  {
    subjects: {
      type: [String],
      default: [],
    },
    assessment: {
      type: teacherAssessmentSchema,
      default: () => ({}),
    },
    dashboardUnlocked: {
      type: Boolean,
      default: false,
      index: true,
    },
    onboardingCompletedAt: {
      type: Date,
      default: null,
    },
    assessmentAttemptCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    assessmentCooldownUntil: {
      type: Date,
      default: null,
    },
    successfulSessionCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 140,
      default: '',
    },
    tagline: {
      type: String,
      trim: true,
      maxlength: 220,
      default: '',
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    avatarUrl: {
      type: String,
      trim: true,
      default: '',
    },
    profileSubjects: {
      type: [String],
      default: [],
    },
    skills: {
      type: [String],
      default: [],
    },
    sessionTypes: {
      type: [String],
      default: [],
    },
    teachingStyle: {
      type: String,
      trim: true,
      maxlength: 1500,
      default: '',
    },
    targetAudience: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    /** Minutes of session time per 1 credit (e.g. 30 = 30 min per credit) */
    creditRate: {
      type: Number,
      min: 1,
      max: 240,
      default: 30,
    },
    availabilityDays: {
      type: [String],
      default: [],
    },
    timeSlots: {
      type: [String],
      default: [],
    },
    timezone: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    sessionLength: {
      type: Number,
      min: 15,
      max: 240,
      default: 60,
    },
    education: {
      type: [teacherEducationSchema],
      default: [],
    },
    languages: {
      type: [String],
      default: [],
    },
    experience: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    profileCompleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    profileCompletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
    id: false,
  },
);

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    profession: {
      type: String,
      required: true,
      enum: ['student', 'teacher'],
      index: true,
    },
    roles: {
      type: [String],
      enum: VALID_ROLES,
      default: function defaultRoles() {
        const fallback = normalizeRole(this?.profession) || 'student';
        return [fallback];
      },
      index: true,
    },
    avatarUrl: {
      type: String,
      trim: true,
      default: '',
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
      index: true,
    },
    emailVerifiedAt: {
      type: Date,
      default: null,
    },
    emailVerificationCodeHash: {
      type: String,
      default: null,
    },
    emailVerificationCodeExpiresAt: {
      type: Date,
      default: null,
    },
    emailVerificationCodeRequestedAt: {
      type: Date,
      default: null,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    learningCredits: {
      type: Number,
      default: 10,
      min: 0,
    },
    isAdmin: {
      type: Boolean,
      default: false,
      index: true,
    },
    passwordResetCodeHash: {
      type: String,
      default: null,
    },
    passwordResetCodeExpiresAt: {
      type: Date,
      default: null,
    },
    passwordResetCodeRequestedAt: {
      type: Date,
      default: null,
    },
    studentProfile: {
      type: studentProfileSchema,
      default: () => ({}),
    },
    teacherProfile: {
      type: teacherProfileSchema,
      default: () => ({}),
    },
    onlineStatus: {
      type: String,
      enum: ['online', 'idle', 'offline'],
      default: 'offline',
      index: true,
    },
    lastSeen: {
      type: Date,
      default: null,
      index: true,
    },
    unreadMessageCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    notificationSettings: {
      enableSound: { type: Boolean, default: true },
      enableEmail: { type: Boolean, default: true },
      enableBrowserNotifications: { type: Boolean, default: true },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

userSchema.pre('save', function syncRoles() {
  const normalizedRoles = Array.isArray(this.roles)
    ? this.roles
      .map((role) => normalizeRole(role))
      .filter(Boolean)
    : [];

  const normalizedProfession = normalizeRole(this.profession);

  if (normalizedProfession) {
    normalizedRoles.push(normalizedProfession);
  }

  const deduped = Array.from(new Set(normalizedRoles));
  this.roles = deduped.length > 0 ? deduped : ['student'];
});

module.exports = model('User', userSchema);

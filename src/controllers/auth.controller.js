const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');

const User = require('../models/User');
const CnicVerification = require('../models/CnicVerification');
const { uploadProfileImageToSupabase } = require('../services/profileImageStorage.service');
const {
  sendPasswordResetCodeEmail,
  sendEmailVerificationCodeEmail,
} = require('../services/mailer.service');
const { getUserRoles, hasRole, normalizeRole } = require('../utils/roles');

const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[A-Za-z])(?=.*\d).+$/;
const SIX_DIGIT_CODE_REGEX = /^\d{6}$/;
const STUDENT_USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const ISO_DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const STUDENT_LEARNING_LEVELS = ['beginner', 'elementary', 'intermediate', 'advanced', 'expert'];
const STUDENT_WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STUDENT_TIME_SLOTS = [
  '6 AM – 9 AM',
  '9 AM – 12 PM',
  '12 PM – 3 PM',
  '3 PM – 6 PM',
  '6 PM – 9 PM',
  '9 PM – 12 AM',
];

const DEFAULT_STUDENT_AVATAR_URL = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=400';
const DEFAULT_STUDENT_SUBJECTS = ['JavaScript', 'Python', 'Data Science'];
const DEFAULT_STUDENT_GOALS = ['Get a job / career change', 'Build a project / startup'];
const DEFAULT_STUDENT_DAYS = ['Mon', 'Wed', 'Fri', 'Sat'];
const DEFAULT_STUDENT_TIME_SLOT_SELECTION = ['6 PM – 9 PM'];
const DEFAULT_STUDENT_LANGUAGES = ['English', 'Urdu'];
const DEFAULT_STUDENT_SESSION_PREFS = ['1:1 Private sessions'];
const TEACHER_ASSESSMENT_TOTAL_QUESTIONS = 10;
const TEACHER_ASSESSMENT_PASS_MIN_CORRECT = 8;
const TEACHER_SUBJECTS_MIN = 1;
const TEACHER_SUBJECTS_MAX = 3;
const TEACHER_TIER_THRESHOLDS = {
  bronzeMax: 9,
  goldMax: 29,
};
const TEACHER_ASSESSMENT_COOLDOWN_MS = 5 * 60 * 1000;
const ALLOWED_TEACHER_SUBJECTS = [
  'English',
  'Python',
  'C++',
  'Node.js',
  'JavaScript',
  'Blender',
  'Selenium Automation',
  'C Language',
  'Java',
];
const TEACHER_AVAILABILITY_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TEACHER_TIME_SLOTS = [
  '6 AM – 9 AM',
  '9 AM – 12 PM',
  '12 PM – 3 PM',
  '3 PM – 6 PM',
  '6 PM – 9 PM',
  '9 PM – 12 AM',
];

const signupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  email: Joi.string().trim().email().required(),
  password: Joi.string().min(8).max(72).pattern(PASSWORD_COMPLEXITY_REGEX).required().messages({
    'string.pattern.base': 'Password must include at least one letter and one number.',
  }),
  profession: Joi.string().valid('student', 'teacher', 'tutor').optional(),
});

const switchAccountModeSchema = Joi.object({
  profession: Joi.string().valid('student', 'teacher').required(),
});

const teacherSubjectsUpdateSchema = Joi.object({
  subjects: Joi.array()
    .items(Joi.string().trim().valid(...ALLOWED_TEACHER_SUBJECTS))
    .min(TEACHER_SUBJECTS_MIN)
    .max(TEACHER_SUBJECTS_MAX)
    .unique()
    .required(),
});

const teacherAssessmentSubmitSchema = Joi.object({
  totalQuestions: Joi.number().integer().valid(TEACHER_ASSESSMENT_TOTAL_QUESTIONS).required(),
  correctAnswers: Joi.number().integer().min(0).max(TEACHER_ASSESSMENT_TOTAL_QUESTIONS).required(),
});

const signinSchema = Joi.object({
  email: Joi.string().trim().email().required(),
  password: Joi.string().min(8).max(72).required(),
});

const forgotPasswordSendCodeSchema = Joi.object({
  email: Joi.string().trim().email().required(),
});

const emailVerificationVerifyCodeSchema = Joi.object({
  email: Joi.string().trim().email().required(),
  code: Joi.string().trim().pattern(SIX_DIGIT_CODE_REGEX).required().messages({
    'string.pattern.base': 'Verification code must be a 6-digit number.',
  }),
});

const emailVerificationResendCodeSchema = Joi.object({
  email: Joi.string().trim().email().required(),
});

const forgotPasswordVerifyCodeSchema = Joi.object({
  email: Joi.string().trim().email().required(),
  code: Joi.string().trim().pattern(SIX_DIGIT_CODE_REGEX).required().messages({
    'string.pattern.base': 'Verification code must be a 6-digit number.',
  }),
});

const forgotPasswordResetSchema = Joi.object({
  email: Joi.string().trim().email().required(),
  code: Joi.string().trim().pattern(SIX_DIGIT_CODE_REGEX).required().messages({
    'string.pattern.base': 'Verification code must be a 6-digit number.',
  }),
  newPassword: Joi.string().min(8).max(72).pattern(PASSWORD_COMPLEXITY_REGEX).required().messages({
    'string.pattern.base': 'Password must include at least one letter and one number.',
  }),
});

const studentProfileUpdateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120),
  username: Joi.string().trim().max(40).pattern(STUDENT_USERNAME_REGEX).allow('').messages({
    'string.pattern.base': 'Username can contain only letters, numbers, and underscores.',
  }),
  bio: Joi.string().trim().max(600).allow(''),
  location: Joi.string().trim().max(120).allow(''),
  avatarUrl: Joi.string().trim().uri({ scheme: ['http', 'https'] }).allow(''),
  level: Joi.string().valid(...STUDENT_LEARNING_LEVELS),
  subjects: Joi.array().items(Joi.string().trim().min(2).max(80)).max(8).unique(),
  currentlyLearning: Joi.string().trim().max(300).allow(''),
  streak: Joi.number().integer().min(0).max(3650),
  goals: Joi.array().items(Joi.string().trim().min(2).max(120)).max(10).unique(),
  targetDate: Joi.string().trim().pattern(ISO_DATE_ONLY_REGEX).allow('').messages({
    'string.pattern.base': 'Target date must be in YYYY-MM-DD format.',
  }),
  days: Joi.array().items(Joi.string().valid(...STUDENT_WEEK_DAYS)).max(7).unique(),
  timeSlots: Joi.array().items(Joi.string().valid(...STUDENT_TIME_SLOTS)).max(STUDENT_TIME_SLOTS.length).unique(),
  timezone: Joi.string().trim().max(80).allow(''),
  weeklyHours: Joi.number().integer().min(1).max(40),
  languages: Joi.array().items(Joi.string().trim().min(2).max(60)).max(6).unique(),
  sessionPrefs: Joi.array().items(Joi.string().trim().min(2).max(80)).max(6).unique(),
  learningStyle: Joi.string().trim().max(1000).allow(''),
})
  .min(0)
  .required();

const teacherEducationSchema = Joi.object({
  degree: Joi.string().trim().min(1).max(120).required(),
  institution: Joi.string().trim().min(1).max(160).required(),
  year: Joi.string().trim().min(1).max(20).required(),
});

const teacherProfileUpdateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120),
  title: Joi.string().trim().max(140).allow(''),
  tagline: Joi.string().trim().max(220).allow(''),
  bio: Joi.string().trim().max(2000).allow(''),
  avatarUrl: Joi.string().trim().uri({ scheme: ['http', 'https'] }).allow(''),
  profileSubjects: Joi.array().items(Joi.string().trim().min(2).max(120)).max(20).unique(),
  skills: Joi.array().items(Joi.string().trim().min(1).max(120)).max(30).unique(),
  sessionTypes: Joi.array().items(Joi.string().trim().min(2).max(80)).max(10).unique(),
  teachingStyle: Joi.string().trim().max(1500).allow(''),
  targetAudience: Joi.string().trim().max(1000).allow(''),
  creditRate: Joi.number().integer().min(1).max(240),
  availabilityDays: Joi.array().items(Joi.string().valid(...TEACHER_AVAILABILITY_DAYS)).max(7).unique(),
  timeSlots: Joi.array().items(Joi.string().valid(...TEACHER_TIME_SLOTS)).max(TEACHER_TIME_SLOTS.length).unique(),
  timezone: Joi.string().trim().max(80).allow(''),
  sessionLength: Joi.number().integer().min(15).max(240),
  education: Joi.array().items(teacherEducationSchema).max(10),
  languages: Joi.array().items(Joi.string().trim().min(2).max(80)).max(10).unique(),
  experience: Joi.string().trim().max(120).allow(''),
})
  .min(0)
  .required();

function normalizeEmail(email) {
  return email.toLowerCase();
}

function generateSixDigitCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashResetCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function hashEmailVerificationCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function clearResetCodeState(user) {
  user.passwordResetCodeHash = null;
  user.passwordResetCodeExpiresAt = null;
  user.passwordResetCodeRequestedAt = null;
}

function isResetCodeValid(user, code) {
  if (!user.passwordResetCodeHash || !user.passwordResetCodeExpiresAt) {
    return false;
  }

  if (user.passwordResetCodeExpiresAt.getTime() <= Date.now()) {
    return false;
  }

  return hashResetCode(code) === user.passwordResetCodeHash;
}

function clearEmailVerificationState(user) {
  user.emailVerificationCodeHash = null;
  user.emailVerificationCodeExpiresAt = null;
  user.emailVerificationCodeRequestedAt = null;
}

function isEmailVerificationCodeValid(user, code) {
  if (!user.emailVerificationCodeHash || !user.emailVerificationCodeExpiresAt) {
    return false;
  }

  if (user.emailVerificationCodeExpiresAt.getTime() <= Date.now()) {
    return false;
  }

  return hashEmailVerificationCode(code) === user.emailVerificationCodeHash;
}

function normalizeProfession(profession) {
  if (profession === 'tutor') {
    return 'teacher';
  }

  return profession;
}

function deriveUsernameFromEmail(email) {
  const localPart = (email || '').split('@')[0] || 'student';
  const normalized = localPart
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return (normalized || 'student').slice(0, 40);
}

function buildDefaultTargetDate() {
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);

  return nextYear.toISOString().slice(0, 10);
}

function buildDefaultStudentProfile(user) {
  return {
    username: deriveUsernameFromEmail(user.email),
    bio: '',
    location: '',
    avatarUrl: user.avatarUrl || '',
    level: 'intermediate',
    subjects: [...DEFAULT_STUDENT_SUBJECTS],
    currentlyLearning: '',
    streak: 0,
    goals: [...DEFAULT_STUDENT_GOALS],
    targetDate: buildDefaultTargetDate(),
    days: [...DEFAULT_STUDENT_DAYS],
    timeSlots: [...DEFAULT_STUDENT_TIME_SLOT_SELECTION],
    timezone: 'UTC+5 (PKT)',
    weeklyHours: 5,
    languages: [...DEFAULT_STUDENT_LANGUAGES],
    sessionPrefs: [...DEFAULT_STUDENT_SESSION_PREFS],
    learningStyle: '',
  };
}

function serializeStudentProfile(user) {
  const defaults = buildDefaultStudentProfile(user);
  const profileSource = user.studentProfile?.toObject
    ? user.studentProfile.toObject()
    : (user.studentProfile || {});
  const canonicalAvatarUrl = user.avatarUrl || profileSource.avatarUrl || '';

  return {
    ...defaults,
    ...profileSource,
    username: profileSource.username || defaults.username,
    avatarUrl: canonicalAvatarUrl,
    timezone: profileSource.timezone || defaults.timezone,
    targetDate: profileSource.targetDate || defaults.targetDate,
    subjects: Array.isArray(profileSource.subjects) ? profileSource.subjects : defaults.subjects,
    goals: Array.isArray(profileSource.goals) ? profileSource.goals : defaults.goals,
    days: Array.isArray(profileSource.days) ? profileSource.days : defaults.days,
    timeSlots: Array.isArray(profileSource.timeSlots) ? profileSource.timeSlots : defaults.timeSlots,
    languages: Array.isArray(profileSource.languages) ? profileSource.languages : defaults.languages,
    sessionPrefs: Array.isArray(profileSource.sessionPrefs) ? profileSource.sessionPrefs : defaults.sessionPrefs,
  };
}

function resolveRoleAvatarUrl(user, profession = user.profession) {
  const rootAvatarUrl = user.avatarUrl || '';
  const studentAvatarUrl = user.studentProfile?.avatarUrl || '';
  const teacherAvatarUrl = user.teacherProfile?.avatarUrl || '';

  if (profession === 'student') {
    return rootAvatarUrl || studentAvatarUrl || teacherAvatarUrl || '';
  }

  if (profession === 'teacher') {
    return rootAvatarUrl || teacherAvatarUrl || studentAvatarUrl || '';
  }

  return rootAvatarUrl || studentAvatarUrl || teacherAvatarUrl || '';
}

function serializeUser(user) {
  const avatarUrl = resolveRoleAvatarUrl(user, user.profession);
  const roles = getUserRoles(user);
  const successfulSessions = getTeacherSuccessfulSessionCount(user);

  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    roles,
    profession: user.profession,
    avatarUrl,
    learningCredits: Number.isFinite(Number(user.learningCredits)) ? Number(user.learningCredits) : 10,
    isEmailVerified: user.isEmailVerified !== false,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    teacherOnboarding: {
      subjects: Array.isArray(user.teacherProfile?.subjects) ? user.teacherProfile.subjects : [],
      assessment: {
        totalQuestions: Number(user.teacherProfile?.assessment?.totalQuestions) || TEACHER_ASSESSMENT_TOTAL_QUESTIONS,
        correctAnswers: Number(user.teacherProfile?.assessment?.correctAnswers) || 0,
        scorePercent: Number(user.teacherProfile?.assessment?.scorePercent) || 0,
        passed: user.teacherProfile?.assessment?.passed === true,
        attemptedAt: user.teacherProfile?.assessment?.attemptedAt || null,
      },
      dashboardUnlocked: user.teacherProfile?.dashboardUnlocked === true,
      profileCompleted: user.teacherProfile?.profileCompleted === true,
      profileCompletedAt: user.teacherProfile?.profileCompletedAt || null,
      onboardingCompletedAt: user.teacherProfile?.onboardingCompletedAt || null,
      assessmentAttemptCount: Number(user.teacherProfile?.assessmentAttemptCount) || 0,
      assessmentCooldownUntil: user.teacherProfile?.assessmentCooldownUntil || null,
      passCriteria: {
        minimumCorrectAnswers: TEACHER_ASSESSMENT_PASS_MIN_CORRECT,
        totalQuestions: TEACHER_ASSESSMENT_TOTAL_QUESTIONS,
      },
    },
    teacherSessionStats: {
      successfulSessions,
      tier: getTeacherSessionTier(successfulSessions),
    },
  };
}

async function getLatestCnicStatusForUser(userId) {
  const latestSubmission = await CnicVerification.findOne({ userId })
    .sort({ createdAt: -1 })
    .select('status')
    .lean();

  return latestSubmission?.status || 'Not Submitted';
}

async function buildTeacherOnboardingState(user) {
  const cnicStatus = await getLatestCnicStatusForUser(user._id);
  const cnicVerified = cnicStatus === 'Verified';
  const subjects = Array.isArray(user.teacherProfile?.subjects) ? user.teacherProfile.subjects : [];
  const subjectSelectionCompleted = subjects.length > 0;
  const assessment = {
    totalQuestions: Number(user.teacherProfile?.assessment?.totalQuestions) || TEACHER_ASSESSMENT_TOTAL_QUESTIONS,
    correctAnswers: Number(user.teacherProfile?.assessment?.correctAnswers) || 0,
    scorePercent: Number(user.teacherProfile?.assessment?.scorePercent) || 0,
    passed: user.teacherProfile?.assessment?.passed === true,
    attemptedAt: user.teacherProfile?.assessment?.attemptedAt || null,
  };
  const assessmentPassed = assessment.passed;
  const profileCompleted = user.teacherProfile?.profileCompleted === true;
  const profileCompletedAt = user.teacherProfile?.profileCompletedAt || null;
  const cooldownUntil = user.teacherProfile?.assessmentCooldownUntil || null;
  const cooldownRemainingMs = cooldownUntil
    ? Math.max(0, new Date(cooldownUntil).getTime() - Date.now())
    : 0;
  const cooldownActive = cooldownRemainingMs > 0;
  const dashboardUnlocked = cnicVerified && subjectSelectionCompleted && assessmentPassed && profileCompleted;

  return {
    cnicStatus,
    cnicVerified,
    subjects,
    subjectSelectionCompleted,
    assessment,
    assessmentPassed,
    profileCompleted,
    profileCompletedAt,
    dashboardUnlocked,
    subjectConstraints: {
      min: TEACHER_SUBJECTS_MIN,
      max: TEACHER_SUBJECTS_MAX,
    },
    passCriteria: {
      minimumCorrectAnswers: TEACHER_ASSESSMENT_PASS_MIN_CORRECT,
      totalQuestions: TEACHER_ASSESSMENT_TOTAL_QUESTIONS,
    },
    assessmentAttemptCount: Number(user.teacherProfile?.assessmentAttemptCount) || 0,
    assessmentCooldownUntil: cooldownUntil,
    cooldownActive,
    cooldownRemainingMs,
  };
}

function parseJsonInputField(value, fallbackValue) {
  if (typeof value === 'undefined') {
    return fallbackValue;
  }

  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return value;
  }

  if (typeof value !== 'string') {
    return fallbackValue;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallbackValue;
  }

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return fallbackValue;
  }
}

function numberFromInput(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function buildStudentProfileUpdatePayload(req) {
  const body = req.body || {};

  const rawPayload = {
    name: body.name,
    username: body.username,
    bio: body.bio,
    location: body.location,
    avatarUrl: body.avatarUrl,
    level: body.level,
    subjects: parseJsonInputField(body.subjects, undefined),
    currentlyLearning: body.currentlyLearning,
    streak: numberFromInput(body.streak),
    goals: parseJsonInputField(body.goals, undefined),
    targetDate: body.targetDate,
    days: parseJsonInputField(body.days, undefined),
    timeSlots: parseJsonInputField(body.timeSlots, undefined),
    timezone: body.timezone,
    weeklyHours: numberFromInput(body.weeklyHours),
    languages: parseJsonInputField(body.languages, undefined),
    sessionPrefs: parseJsonInputField(body.sessionPrefs, undefined),
    learningStyle: body.learningStyle,

  };

  return Object.fromEntries(
    Object.entries(rawPayload).filter(([, fieldValue]) => typeof fieldValue !== 'undefined'),
  );
}

function buildTeacherProfileDefaults(user) {
  const source = user.teacherProfile?.toObject
    ? user.teacherProfile.toObject()
    : (user.teacherProfile || {});
  const canonicalAvatarUrl = user.avatarUrl || source.avatarUrl || '';

  return {
    title: source.title || '',
    tagline: source.tagline || '',
    bio: source.bio || '',
    avatarUrl: canonicalAvatarUrl,
    profileSubjects: Array.isArray(source.profileSubjects) ? source.profileSubjects : [],
    skills: Array.isArray(source.skills) ? source.skills : [],
    sessionTypes: Array.isArray(source.sessionTypes) ? source.sessionTypes : [],
    teachingStyle: source.teachingStyle || '',
    targetAudience: source.targetAudience || '',
    creditRate: Number(source.creditRate) || 30,
    availabilityDays: Array.isArray(source.availabilityDays) ? source.availabilityDays : [],
    timeSlots: Array.isArray(source.timeSlots) ? source.timeSlots : [],
    timezone: source.timezone || '',
    sessionLength: Number.isFinite(Number(source.sessionLength)) && Number(source.sessionLength) > 0
      ? Number(source.sessionLength)
      : undefined,
    education: Array.isArray(source.education)
      ? source.education.map((item) => ({
        degree: item?.degree || '',
        institution: item?.institution || '',
        year: item?.year || '',
      }))
      : [],
    languages: Array.isArray(source.languages) ? source.languages : [],
    experience: source.experience || '',
    profileCompleted: source.profileCompleted === true,
    profileCompletedAt: source.profileCompletedAt || null,
  };
}

function getTeacherSessionTier(successfulSessions = 0) {
  const count = Number(successfulSessions) || 0;

  if (count >= TEACHER_TIER_THRESHOLDS.goldMax + 1) {
    return 'Diamond';
  }

  if (count >= TEACHER_TIER_THRESHOLDS.bronzeMax + 1) {
    return 'Gold';
  }

  return 'Bronze';
}

function getTeacherSuccessfulSessionCount(user) {
  return Number(user?.teacherProfile?.successfulSessionCount) || 0;
}

function buildTeacherProfileUpdatePayload(req) {
  const body = req.body || {};

  return {
    name: body.name,
    title: body.title,
    tagline: body.tagline,
    bio: body.bio,
    avatarUrl: body.avatarUrl,
    profileSubjects: parseJsonInputField(body.profileSubjects, undefined),
    skills: parseJsonInputField(body.skills, undefined),
    sessionTypes: parseJsonInputField(body.sessionTypes, undefined),
    teachingStyle: body.teachingStyle,
    targetAudience: body.targetAudience,
    creditRate: numberFromInput(body.creditRate),
    availabilityDays: parseJsonInputField(body.availabilityDays, undefined),
    timeSlots: parseJsonInputField(body.timeSlots, undefined),
    timezone: body.timezone,
    sessionLength: numberFromInput(body.sessionLength),
    education: parseJsonInputField(body.education, undefined),
    languages: parseJsonInputField(body.languages, undefined),
    experience: body.experience,
  };
}

function normalizeTeacherFieldString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasTeacherNonEmptyString(value) {
  return normalizeTeacherFieldString(value).length > 0;
}

function hasTeacherNonEmptyStringItems(items) {
  return Array.isArray(items) && items.some((item) => hasTeacherNonEmptyString(item));
}

function hasTeacherValidEducationItems(items) {
  return Array.isArray(items) && items.some((item) => (
    hasTeacherNonEmptyString(item?.degree)
    && hasTeacherNonEmptyString(item?.institution)
    && hasTeacherNonEmptyString(item?.year)
  ));
}

function computeTeacherProfileCompleted(profile) {
  return Boolean(
    hasTeacherNonEmptyString(profile.title)
    && hasTeacherNonEmptyString(profile.bio)
    && hasTeacherNonEmptyString(profile.avatarUrl)
    && hasTeacherNonEmptyString(profile.tagline)
    && hasTeacherNonEmptyString(profile.experience)
    && hasTeacherNonEmptyStringItems(profile.profileSubjects)
    && hasTeacherNonEmptyStringItems(profile.skills)
    && hasTeacherNonEmptyStringItems(profile.sessionTypes)
    && hasTeacherNonEmptyStringItems(profile.languages)
    && Array.isArray(profile.availabilityDays)
    && profile.availabilityDays.length > 0
    && Array.isArray(profile.timeSlots)
    && profile.timeSlots.length > 0
    && Number(profile.creditRate) > 0
    && hasTeacherValidEducationItems(profile.education),
  );
}

function buildTeacherPublicProfile(user, cnicStatus) {
  const profile = buildTeacherProfileDefaults(user);
  const successfulSessions = getTeacherSuccessfulSessionCount(user);
  const onboarding = {
    cnicStatus,
    cnicVerified: cnicStatus === 'Verified',
    assessmentPassed: user.teacherProfile?.assessment?.passed === true,
    profileCompleted: user.teacherProfile?.profileCompleted === true,
    dashboardUnlocked: user.teacherProfile?.dashboardUnlocked === true,
  };

  const subject = profile.profileSubjects[0]
    || (Array.isArray(user.teacherProfile?.subjects) ? user.teacherProfile.subjects[0] : '')
    || 'General';

  const availabilityDays = Array.isArray(profile.availabilityDays) ? profile.availabilityDays : [];
  const timeSlots = Array.isArray(profile.timeSlots) ? profile.timeSlots : [];

  return {
    id: user._id.toString(),
    name: user.name,
    title: profile.title || 'Teacher',
    subject,
    avatarUrl: profile.avatarUrl || '',
    bio: profile.bio || '',
    specialties: Array.isArray(profile.skills) ? profile.skills : [],
    availability: availabilityDays.length > 0
      ? `${availabilityDays.join(', ')}${timeSlots.length > 0 ? ` · ${timeSlots[0]}` : ''}`
      : '',
    languages: Array.isArray(profile.languages) ? profile.languages : [],
    experience: profile.experience || '',
    creditRate: Number(profile.creditRate) || 30,
    teachingStyle: profile.teachingStyle || '',
    targetAudience: profile.targetAudience || '',
    sessionTypes: Array.isArray(profile.sessionTypes) ? profile.sessionTypes : [],
    timezone: profile.timezone || '',
    successfulSessions,
    sessionTier: getTeacherSessionTier(successfulSessions),
    onboarding,
  };
}

async function getQualifiedTeachersForStudent(_req, res) {
  const teachers = await User.find({
    'teacherProfile.profileCompleted': true,
    'teacherProfile.assessment.passed': true,
  })
    .select('name teacherProfile')
    .sort({ updatedAt: -1 });

  const teachersWithStatus = await Promise.all(
    teachers.map(async (teacher) => {
      const cnicStatus = await getLatestCnicStatusForUser(teacher._id);
      const isQualified = cnicStatus === 'Verified'
        && teacher.teacherProfile?.assessment?.passed === true
        && teacher.teacherProfile?.profileCompleted === true;

      if (!isQualified) {
        return null;
      }

      return buildTeacherPublicProfile(teacher, cnicStatus);
    }),
  );

  return res.status(200).json({
    message: 'Qualified teachers fetched successfully.',
    teachers: teachersWithStatus.filter(Boolean),
  });
}

async function getQualifiedTeacherDetailForStudent(req, res) {
  const teacher = await User.findOne({
    _id: req.params.teacherId,
  }).select('name teacherProfile');

  if (!teacher) {
    return res.status(404).json({ message: 'Teacher not found.' });
  }

  const cnicStatus = await getLatestCnicStatusForUser(teacher._id);
  const isQualified = cnicStatus === 'Verified'
    && teacher.teacherProfile?.assessment?.passed === true
    && teacher.teacherProfile?.profileCompleted === true;

  if (!isQualified) {
    return res.status(404).json({ message: 'Teacher not found.' });
  }

  return res.status(200).json({
    message: 'Teacher detail fetched successfully.',
    teacher: buildTeacherPublicProfile(teacher, cnicStatus),
  });
}

async function syncTeacherDashboardUnlock(user) {
  const onboarding = await buildTeacherOnboardingState(user);
  const shouldUnlock = onboarding.dashboardUnlocked;
  const currentRoles = getUserRoles(user);
  const hasTeacherRole = currentRoles.includes('teacher');

  if (user.teacherProfile?.dashboardUnlocked !== shouldUnlock || (shouldUnlock && !hasTeacherRole)) {
    user.teacherProfile = user.teacherProfile || {};
    user.teacherProfile.dashboardUnlocked = shouldUnlock;
    user.teacherProfile.onboardingCompletedAt = shouldUnlock ? (user.teacherProfile.onboardingCompletedAt || new Date()) : null;
    if (shouldUnlock) {
      user.roles = Array.from(new Set([...currentRoles, 'teacher']));
    }
    await user.save();
  }

  return onboarding;
}

function signAccessToken(user) {
  const roles = getUserRoles(user);
  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      roles,
      profession: user.profession,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  );
}

function buildValidationError(details) {
  return details.map((detail) => detail.message);
}

function isProductionEnvironment() {
  return process.env.NODE_ENV === 'production';
}

function extractEmailProviderErrorMessage(error) {
  const candidates = [
    error?.body?.message,
    error?.response?.body?.message,
    error?.response?.data?.message,
    error?.message,
  ];

  const providerMessage = candidates.find(
    (candidate) => typeof candidate === 'string' && candidate.trim().length > 0,
  );

  return providerMessage ? providerMessage.trim() : 'Email provider unavailable.';
}

function buildDevelopmentEmailFallbackMessage(baseMessage, sendError) {
  const providerMessage = extractEmailProviderErrorMessage(sendError);

  if (/unique recipients limit/i.test(providerMessage)) {
    return `${baseMessage} Mail delivery is blocked by the MailerSend trial recipient limit. Use the development verification code below or add this email as an allowed recipient in MailerSend.`;
  }

  return `${baseMessage} Email provider unavailable in development; use the verification code shown below.`;
}

async function signup(req, res) {
  const { error, value } = signupSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      message: 'Invalid signup data.',
      errors: buildValidationError(error.details),
    });
  }

  const normalizedEmail = normalizeEmail(value.email);
  // Product rule: every new account starts as a student.
  // Teacher capabilities are unlocked later through onboarding.
  const normalizedProfession = 'student';

  const existingUser = await User.findOne({ email: normalizedEmail });

  if (existingUser) {
    if (existingUser.isEmailVerified === false) {
      const verificationCode = generateSixDigitCode();
      const verificationTtlMinutes = Number(process.env.EMAIL_VERIFICATION_CODE_TTL_MINUTES) || 15;

      existingUser.emailVerificationCodeHash = hashEmailVerificationCode(verificationCode);
      existingUser.emailVerificationCodeExpiresAt = new Date(Date.now() + verificationTtlMinutes * 60 * 1000);
      existingUser.emailVerificationCodeRequestedAt = new Date();
      await existingUser.save();

      try {
        await sendEmailVerificationCodeEmail({
          recipientEmail: existingUser.email,
          recipientName: existingUser.name,
          code: verificationCode,
          expiresInMinutes: verificationTtlMinutes,
        });
      } catch (sendError) {
        if (isProductionEnvironment()) {
          throw sendError;
        }

        console.warn('Email verification resend failed in development. Using fallback code.', sendError?.message || sendError);

        return res.status(200).json({
          message: buildDevelopmentEmailFallbackMessage(
            'This email is already registered but not verified.',
            sendError,
          ),
          email: existingUser.email,
          requiresEmailVerification: true,
          developmentVerificationCode: verificationCode,
          emailDeliveryFailed: true,
        });
      }

      return res.status(200).json({
        message: 'This email is already registered but not verified. A new verification code has been sent.',
        email: existingUser.email,
        requiresEmailVerification: true,
      });
    }

    return res.status(409).json({
      message: 'An account with this email already exists.',
    });
  }

  const passwordHash = await bcrypt.hash(value.password, 12);
  const verificationCode = generateSixDigitCode();
  const verificationTtlMinutes = Number(process.env.EMAIL_VERIFICATION_CODE_TTL_MINUTES) || 15;

  const user = await User.create({
    name: value.name,
    email: normalizedEmail,
    passwordHash,
    profession: normalizedProfession,
    roles: ['student'],
    learningCredits: 10,
    isEmailVerified: false,
    emailVerificationCodeHash: hashEmailVerificationCode(verificationCode),
    emailVerificationCodeExpiresAt: new Date(Date.now() + verificationTtlMinutes * 60 * 1000),
    emailVerificationCodeRequestedAt: new Date(),
  });

  try {
    await sendEmailVerificationCodeEmail({
      recipientEmail: user.email,
      recipientName: user.name,
      code: verificationCode,
      expiresInMinutes: verificationTtlMinutes,
    });
  } catch (sendError) {
    if (isProductionEnvironment()) {
      await User.deleteOne({ _id: user._id });
      throw sendError;
    }

    console.warn('Email verification send failed in development. Using fallback code.', sendError?.message || sendError);

    return res.status(201).json({
      message: buildDevelopmentEmailFallbackMessage('Account created.', sendError),
      email: user.email,
      requiresEmailVerification: true,
      developmentVerificationCode: verificationCode,
      emailDeliveryFailed: true,
    });
  }

  return res.status(201).json({
    message: 'Account created. Please verify your email with the code we sent.',
    email: user.email,
    requiresEmailVerification: true,
  });
}

async function signin(req, res) {
  const { error, value } = signinSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      message: 'Invalid sign in data.',
      errors: buildValidationError(error.details),
    });
  }

  const normalizedEmail = normalizeEmail(value.email);
  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const isPasswordValid = await bcrypt.compare(value.password, user.passwordHash);

  if (!isPasswordValid) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  if (user.isEmailVerified === false) {
    return res.status(403).json({
      message: 'Email is not verified. Please verify your email before signing in.',
      requiresEmailVerification: true,
      email: user.email,
    });
  }

  user.lastLoginAt = new Date();
  await user.save();

  const token = signAccessToken(user);

  return res.status(200).json({
    message: 'Signed in successfully.',
    token,
    user: serializeUser(user),
  });
}

async function sendForgotPasswordCode(req, res) {
  const { error, value } = forgotPasswordSendCodeSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      message: 'Invalid forgot password data.',
      errors: buildValidationError(error.details),
    });
  }

  const normalizedEmail = normalizeEmail(value.email);
  const user = await User.findOne({ email: normalizedEmail });
  const genericMessage = 'If an account exists for this email, a verification code has been sent.';

  if (!user) {
    return res.status(404).json({
      message: 'Email does not exist. Please enter the correct email.',
    });
  }

  const resetCode = generateSixDigitCode();
  const ttlMinutes = Number(process.env.PASSWORD_RESET_CODE_TTL_MINUTES) || 10;

  user.passwordResetCodeHash = hashResetCode(resetCode);
  user.passwordResetCodeExpiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  user.passwordResetCodeRequestedAt = new Date();
  await user.save();

  try {
    await sendPasswordResetCodeEmail({
      recipientEmail: user.email,
      recipientName: user.name,
      code: resetCode,
      expiresInMinutes: ttlMinutes,
    });
  } catch (sendError) {
    clearResetCodeState(user);
    await user.save();
    throw sendError;
  }

  return res.status(200).json({ message: genericMessage });
}

async function verifyEmailVerificationCode(req, res) {
  const { error, value } = emailVerificationVerifyCodeSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      message: 'Invalid email verification data.',
      errors: buildValidationError(error.details),
    });
  }

  const normalizedEmail = normalizeEmail(value.email);
  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    return res.status(404).json({ message: 'Email does not exist. Please enter the correct email.' });
  }

  if (user.isEmailVerified === true) {
    clearEmailVerificationState(user);
    await user.save();

    return res.status(200).json({
      message: 'Email is already verified. You can sign in now.',
      email: user.email,
    });
  }

  if (!isEmailVerificationCodeValid(user, value.code)) {
    if (user.emailVerificationCodeExpiresAt && user.emailVerificationCodeExpiresAt.getTime() <= Date.now()) {
      clearEmailVerificationState(user);
      await user.save();
    }

    return res.status(400).json({ message: 'Invalid or expired verification code.' });
  }

  user.isEmailVerified = true;
  user.emailVerifiedAt = new Date();
  clearEmailVerificationState(user);
  await user.save();

  return res.status(200).json({
    message: 'Email verified successfully. You can now sign in.',
    email: user.email,
  });
}

async function resendEmailVerificationCode(req, res) {
  const { error, value } = emailVerificationResendCodeSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      message: 'Invalid resend verification data.',
      errors: buildValidationError(error.details),
    });
  }

  const normalizedEmail = normalizeEmail(value.email);
  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    return res.status(404).json({ message: 'Email does not exist. Please enter the correct email.' });
  }

  if (user.isEmailVerified === true) {
    return res.status(400).json({ message: 'Email is already verified. You can sign in now.' });
  }

  const verificationCode = generateSixDigitCode();
  const verificationTtlMinutes = Number(process.env.EMAIL_VERIFICATION_CODE_TTL_MINUTES) || 15;

  user.emailVerificationCodeHash = hashEmailVerificationCode(verificationCode);
  user.emailVerificationCodeExpiresAt = new Date(Date.now() + verificationTtlMinutes * 60 * 1000);
  user.emailVerificationCodeRequestedAt = new Date();
  await user.save();

  try {
    await sendEmailVerificationCodeEmail({
      recipientEmail: user.email,
      recipientName: user.name,
      code: verificationCode,
      expiresInMinutes: verificationTtlMinutes,
    });
  } catch (sendError) {
    if (isProductionEnvironment()) {
      throw sendError;
    }

    console.warn('Email verification resend failed in development. Using fallback code.', sendError?.message || sendError);

    return res.status(200).json({
      message: buildDevelopmentEmailFallbackMessage('Unable to send a new verification email.', sendError),
      email: user.email,
      developmentVerificationCode: verificationCode,
      emailDeliveryFailed: true,
    });
  }

  return res.status(200).json({
    message: 'A new verification code has been sent to your email.',
    email: user.email,
  });
}

async function verifyForgotPasswordCode(req, res) {
  const { error, value } = forgotPasswordVerifyCodeSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      message: 'Invalid verification data.',
      errors: buildValidationError(error.details),
    });
  }

  const normalizedEmail = normalizeEmail(value.email);
  const user = await User.findOne({ email: normalizedEmail });

  if (!user || !isResetCodeValid(user, value.code)) {
    if (user?.passwordResetCodeExpiresAt && user.passwordResetCodeExpiresAt.getTime() <= Date.now()) {
      clearResetCodeState(user);
      await user.save();
    }

    return res.status(400).json({
      message: 'Invalid or expired verification code.',
    });
  }

  return res.status(200).json({
    message: 'Verification code is valid.',
  });
}

async function resetPasswordWithCode(req, res) {
  const { error, value } = forgotPasswordResetSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      message: 'Invalid reset password data.',
      errors: buildValidationError(error.details),
    });
  }

  const normalizedEmail = normalizeEmail(value.email);
  const user = await User.findOne({ email: normalizedEmail });

  if (!user || !isResetCodeValid(user, value.code)) {
    if (user?.passwordResetCodeExpiresAt && user.passwordResetCodeExpiresAt.getTime() <= Date.now()) {
      clearResetCodeState(user);
      await user.save();
    }

    return res.status(400).json({
      message: 'Invalid or expired verification code.',
    });
  }

  user.passwordHash = await bcrypt.hash(value.newPassword, 12);
  clearResetCodeState(user);
  await user.save();

  return res.status(200).json({
    message: 'Password reset successful. You can now sign in with your new password.',
  });
}

async function getCurrentUser(req, res) {
  return res.status(200).json({
    user: serializeUser(req.user),
  });
}

async function getUserById(req, res) {
  const userId = typeof req.params?.id === 'string' ? req.params.id.trim() : '';

  if (!userId) {
    return res.status(400).json({
      message: 'A user id is required.',
    });
  }

  const user = await User.findById(userId);

  if (!user) {
    return res.status(404).json({
      message: 'User not found.',
    });
  }

  return res.status(200).json({
    user: serializeUser(user),
  });
}

async function uploadAvatar(req, res) {
  if (!req.file && !(typeof req.body?.avatarUrl === 'string' && req.body.avatarUrl.trim())) {
    return res.status(400).json({
      message: 'Please provide an avatar image file or avatar URL.',
    });
  }

  if (req.file) {
    req.user.avatarUrl = await uploadProfileImageToSupabase(req.file, {
      profileType: req.user.profession,
      userId: req.user._id,
    });
  } else if (typeof req.body?.avatarUrl === 'string' && req.body.avatarUrl.trim()) {
    req.user.avatarUrl = req.body.avatarUrl.trim();
  }

  await req.user.save();

  return res.status(200).json({
    message: 'Avatar updated successfully.',
    user: serializeUser(req.user),
  });
}

async function getStudentProfile(req, res) {
  return res.status(200).json({
    message: 'Student profile fetched successfully.',
    user: serializeUser(req.user),
    profile: serializeStudentProfile(req.user),
  });
}

async function updateStudentProfile(req, res) {
  const profilePayload = buildStudentProfileUpdatePayload(req);
  const { error, value } = studentProfileUpdateSchema.validate(profilePayload, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      message: 'Invalid student profile data.',
      errors: buildValidationError(error.details),
    });
  }

  if (typeof value.name === 'string') {
    req.user.name = value.name;
  }

  const { name: _ignoredName, ...profileUpdates } = value;
  const nextProfile = {
    ...serializeStudentProfile(req.user),
    ...profileUpdates,
  };

  if (req.file) {
    req.user.avatarUrl = await uploadProfileImageToSupabase(req.file, {
      profileType: 'student',
      userId: req.user._id,
    });
  } else if (typeof value.avatarUrl === 'string' && value.avatarUrl.trim()) {
    req.user.avatarUrl = value.avatarUrl.trim();
  }

  if (!nextProfile.username) {
    nextProfile.username = deriveUsernameFromEmail(req.user.email);
  }

  if (!nextProfile.timezone) {
    nextProfile.timezone = 'UTC+5 (PKT)';
  }

  req.user.studentProfile = nextProfile;

  await req.user.save();

  return res.status(200).json({
    message: 'Student profile updated successfully.',
    user: serializeUser(req.user),
    profile: serializeStudentProfile(req.user),
  });
}

async function getStudentDashboardAccess(req, res) {
  return res.status(200).json({
    message: 'Student dashboard access granted.',
    user: serializeUser(req.user),
  });
}

async function getTeacherProfile(req, res) {
  const profile = buildTeacherProfileDefaults(req.user);

  return res.status(200).json({
    message: 'Teacher profile fetched successfully.',
    user: serializeUser(req.user),
    onboarding: await syncTeacherDashboardUnlock(req.user),
    profile,
  });
}

async function updateTeacherProfile(req, res) {
  if (req.user.teacherProfile?.assessment?.passed !== true) {
    return res.status(403).json({
      message: 'Please pass the teacher assessment before completing your profile.',
    });
  }

  const profilePayload = buildTeacherProfileUpdatePayload(req);
  const { error, value } = teacherProfileUpdateSchema.validate(profilePayload, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      message: 'Invalid teacher profile data.',
      errors: buildValidationError(error.details),
    });
  }

  if (typeof value.name === 'string') {
    req.user.name = value.name;
  }

  req.user.teacherProfile = req.user.teacherProfile || {};
  const currentProfile = buildTeacherProfileDefaults(req.user);
  const { name: _ignoredName, ...profileUpdates } = value;
  const nextProfile = {
    ...currentProfile,
    ...profileUpdates,
  };

  if (req.file) {
    req.user.avatarUrl = await uploadProfileImageToSupabase(req.file, {
      profileType: 'teacher',
      userId: req.user._id,
    });
  } else if (typeof req.body?.avatarUrl === 'string' && req.body.avatarUrl.trim()) {
    req.user.avatarUrl = req.body.avatarUrl.trim();
  }

  nextProfile.avatarUrl = req.user.avatarUrl || '';

  const profileCompleted = computeTeacherProfileCompleted(nextProfile);
  nextProfile.profileCompleted = profileCompleted;
  nextProfile.profileCompletedAt = profileCompleted
    ? (currentProfile.profileCompletedAt || new Date())
    : null;

  req.user.teacherProfile = {
    ...req.user.teacherProfile.toObject?.(),
    ...nextProfile,
  };

  await req.user.save();

  const onboarding = await syncTeacherDashboardUnlock(req.user);

  return res.status(200).json({
    message: profileCompleted
      ? 'Teacher profile updated successfully. Dashboard unlocked.'
      : 'Teacher profile saved, but complete all required fields to unlock dashboard.',
    user: serializeUser(req.user),
    onboarding,
    profile: buildTeacherProfileDefaults(req.user),
  });
}

async function getTeacherDashboardAccess(req, res) {
  const onboarding = await syncTeacherDashboardUnlock(req.user);

  if (!onboarding.dashboardUnlocked) {
    return res.status(403).json({
      message: 'Teacher dashboard is locked. Complete CNIC verification, subject selection, pass the 8/10 assessment, and finish your teacher profile.',
      user: serializeUser(req.user),
      onboarding,
    });
  }

  return res.status(200).json({
    message: 'Teacher dashboard access granted.',
    user: serializeUser(req.user),
    onboarding,
  });
}

async function getTeacherOnboardingStatus(req, res) {
  const onboarding = await syncTeacherDashboardUnlock(req.user);

  return res.status(200).json({
    message: 'Teacher onboarding status fetched successfully.',
    user: serializeUser(req.user),
    onboarding,
  });
}

async function updateTeacherSubjects(req, res) {
  const { error, value } = teacherSubjectsUpdateSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      message: 'Invalid teacher subjects data.',
      errors: buildValidationError(error.details),
    });
  }

  const cnicStatus = await getLatestCnicStatusForUser(req.user._id);

  if (cnicStatus !== 'Verified') {
    return res.status(403).json({
      message: 'Please verify your CNIC before selecting teaching subjects.',
    });
  }

  req.user.teacherProfile = req.user.teacherProfile || {};
  req.user.teacherProfile.subjects = value.subjects;
  req.user.teacherProfile.assessment = {
    totalQuestions: TEACHER_ASSESSMENT_TOTAL_QUESTIONS,
    correctAnswers: 0,
    scorePercent: 0,
    passed: false,
    attemptedAt: null,
  };
  req.user.teacherProfile.dashboardUnlocked = false;
  req.user.teacherProfile.onboardingCompletedAt = null;
  req.user.teacherProfile.assessmentCooldownUntil = null;
  req.user.teacherProfile.assessmentAttemptCount = 0;
  await req.user.save();

  const onboarding = await syncTeacherDashboardUnlock(req.user);

  return res.status(200).json({
    message: 'Teaching subjects saved successfully. Complete the 8/10 assessment to unlock the teacher dashboard.',
    user: serializeUser(req.user),
    onboarding,
  });
}

async function submitTeacherAssessment(req, res) {
  const { error, value } = teacherAssessmentSubmitSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      message: 'Invalid teacher assessment data.',
      errors: buildValidationError(error.details),
    });
  }

  const cnicStatus = await getLatestCnicStatusForUser(req.user._id);

  if (cnicStatus !== 'Verified') {
    return res.status(403).json({
      message: 'Please verify your CNIC before taking the teacher assessment.',
    });
  }

  const selectedSubjects = Array.isArray(req.user.teacherProfile?.subjects)
    ? req.user.teacherProfile.subjects
    : [];

  if (selectedSubjects.length === 0) {
    return res.status(403).json({
      message: 'Please select at least one teaching subject before taking the assessment.',
    });
  }

  if (selectedSubjects.length > TEACHER_SUBJECTS_MAX) {
    return res.status(403).json({
      message: `Please select between ${TEACHER_SUBJECTS_MIN} and ${TEACHER_SUBJECTS_MAX} teaching subjects before taking the assessment.`,
    });
  }

  const cooldownUntil = req.user.teacherProfile?.assessmentCooldownUntil;
  if (cooldownUntil && new Date(cooldownUntil).getTime() > Date.now()) {
    const cooldownRemainingMs = new Date(cooldownUntil).getTime() - Date.now();
    return res.status(429).json({
      message: 'Assessment retry cooldown is active. Please wait before trying again.',
      cooldownUntil,
      cooldownRemainingMs,
    });
  }

  const scorePercent = Math.round((value.correctAnswers / value.totalQuestions) * 100);
  const passed = value.correctAnswers >= TEACHER_ASSESSMENT_PASS_MIN_CORRECT;

  req.user.teacherProfile = req.user.teacherProfile || {};
  req.user.teacherProfile.assessment = {
    totalQuestions: value.totalQuestions,
    correctAnswers: value.correctAnswers,
    scorePercent,
    passed,
    attemptedAt: new Date(),
  };
  req.user.teacherProfile.assessmentAttemptCount = Number(req.user.teacherProfile.assessmentAttemptCount || 0) + 1;
  req.user.teacherProfile.dashboardUnlocked = passed;
  req.user.teacherProfile.onboardingCompletedAt = passed ? new Date() : null;
  req.user.teacherProfile.assessmentCooldownUntil = passed
    ? null
    : new Date(Date.now() + TEACHER_ASSESSMENT_COOLDOWN_MS);
  await req.user.save();

  const onboarding = await syncTeacherDashboardUnlock(req.user);

  return res.status(200).json({
    message: passed
      ? 'Assessment passed. Complete your profile to unlock the teacher dashboard.'
      : 'Assessment not passed. Score at least 8/10 to proceed to profile completion.',
    passCriteria: {
      minimumCorrectAnswers: TEACHER_ASSESSMENT_PASS_MIN_CORRECT,
      totalQuestions: TEACHER_ASSESSMENT_TOTAL_QUESTIONS,
    },
    user: serializeUser(req.user),
    onboarding,
  });
}

async function switchAccountMode(req, res) {
  const { error, value } = switchAccountModeSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      message: 'Invalid account switch data.',
      errors: buildValidationError(error.details),
    });
  }

  if (req.user.profession === value.profession) {
    return res.status(200).json({
      message: `You are already using the ${value.profession} account.`,
      token: signAccessToken(req.user),
      user: serializeUser(req.user),
    });
  }

  const targetMode = normalizeRole(value.profession);
  const currentRoles = getUserRoles(req.user);

  if (targetMode === 'teacher' && !hasRole(req.user, 'teacher')) {
    req.user.roles = Array.from(new Set([...currentRoles, 'teacher']));
  }

  req.user.profession = value.profession;
  await req.user.save();

  const onboarding = value.profession === 'teacher'
    ? await syncTeacherDashboardUnlock(req.user)
    : null;

  const token = signAccessToken(req.user);

  return res.status(200).json({
    message: value.profession === 'teacher' && onboarding && !onboarding.dashboardUnlocked
      ? 'Switched to teacher mode. Complete CNIC verification, subject selection, score at least 8/10, and finish your profile to unlock the teacher dashboard.'
      : `Switched to ${value.profession} account successfully.`,
    token,
    user: serializeUser(req.user),
    onboarding,
  });
}

module.exports = {
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
};

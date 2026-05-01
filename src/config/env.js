const REQUIRED_ENV_VARS = ['MONGODB_URI', 'JWT_SECRET'];

function getEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key] || !process.env[key].trim());

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  return {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: Number(process.env.PORT) || 5000,
    CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
    CNIC_OCR_SERVICE_URL: process.env.CNIC_OCR_SERVICE_URL || 'http://127.0.0.1:8001/ocr',
    CNIC_OCR_TIMEOUT_MS: Number(process.env.CNIC_OCR_TIMEOUT_MS) || 90000,
    MONGODB_URI: process.env.MONGODB_URI.trim(),
    MONGODB_DB_NAME: process.env.MONGODB_DB_NAME || 'verilearn',
    JWT_SECRET: process.env.JWT_SECRET.trim(),
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
    MAILERSEND_API_KEY: process.env.MAILERSEND_API_KEY || '',
    MAILERSEND_FROM_EMAIL: process.env.MAILERSEND_FROM_EMAIL || 'info@domain.com',
    MAILERSEND_FROM_NAME: process.env.MAILERSEND_FROM_NAME || 'Verilearn',
    EMAIL_VERIFICATION_CODE_TTL_MINUTES: Number(process.env.EMAIL_VERIFICATION_CODE_TTL_MINUTES) || 15,
    PASSWORD_RESET_CODE_TTL_MINUTES: Number(process.env.PASSWORD_RESET_CODE_TTL_MINUTES) || 10,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    GEMINI_TIMEOUT_MS: Number(process.env.GEMINI_TIMEOUT_MS) || 30000,
    CNIC_FALLBACK_TO_OCR: (process.env.CNIC_FALLBACK_TO_OCR || 'true').toLowerCase() !== 'false',
    CNIC_STOP_OCR_MODEL_ON_GEMINI_SUCCESS:
      (process.env.CNIC_STOP_OCR_MODEL_ON_GEMINI_SUCCESS || 'true').toLowerCase() !== 'false',
    SUPABASE_URL: process.env.SUPABASE_URL || '',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET || 'profile-images',
    SUPABASE_STORAGE_FOLDER: process.env.SUPABASE_STORAGE_FOLDER || 'avatars',
  };
}

module.exports = {
  getEnv,
};

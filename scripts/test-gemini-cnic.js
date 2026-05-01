const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const { verifyCnicWithGemini } = require('../src/services/cnicVerification.service');

const MIME_BY_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

function resolveImagePath() {
  const userProvidedPath = process.argv[2];

  if (userProvidedPath && userProvidedPath.trim()) {
    return path.resolve(process.cwd(), userProvidedPath.trim());
  }

  return path.resolve(__dirname, '../../REAL CNIC.jpg');
}

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_BY_EXTENSION[extension] || 'image/jpeg';
}

async function main() {
  const imagePath = resolveImagePath();

  if (!fs.existsSync(imagePath)) {
    console.error(`[Gemini Test] Image file not found: ${imagePath}`);
    process.exitCode = 1;
    return;
  }

  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_API_KEY.trim()) {
    console.error('[Gemini Test] GEMINI_API_KEY is missing in backend/.env');
    process.exitCode = 1;
    return;
  }

  const fileBuffer = fs.readFileSync(imagePath);
  const file = {
    buffer: fileBuffer,
    originalname: path.basename(imagePath),
    mimetype: getMimeType(imagePath),
    size: fileBuffer.length,
  };

  console.log('[Gemini Test] Starting CNIC extraction...');
  console.log(`[Gemini Test] Image: ${imagePath}`);
  console.log(`[Gemini Test] Model: ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}`);

  const startTime = Date.now();

  try {
    console.log('[Gemini Test] Calling verifyCnicWithGemini...');
    const result = await verifyCnicWithGemini(file);
    const elapsedMs = Date.now() - startTime;

    console.log(`[Gemini Test] ✓ Success! Completed in ${elapsedMs}ms`);
    console.log('[Gemini Test] Extracted Result:');
    console.log(JSON.stringify(result, null, 2));
    
    // Verify confidence gate
    if (result.confidence != null) {
      const passesGate = result.confidence > 0.5;
      console.log(`[Gemini Test] Confidence: ${result.confidence} - ${passesGate ? '✓ PASSES gate' : '✗ FAILS gate (< 0.5)'}`);
    }

    if (!result || typeof result !== 'object') {
      throw new Error('Unexpected empty response object from Gemini verification service.');
    }

    const hasAnyCoreField = Boolean(result.cnic || result.dob || result.text);

    if (!hasAnyCoreField) {
      console.warn('[Gemini Test] Warning: No core CNIC fields were extracted (cnic/dob/text).');
      process.exitCode = 2;
      return;
    }

    console.log('[Gemini Test] Success: Gemini API returned structured OCR data.');
  } catch (error) {
    const statusCode = error?.statusCode ? ` (statusCode=${error.statusCode})` : '';
    console.error(`[Gemini Test] Failed${statusCode}: ${error.message}`);

    if (error?.details) {
      console.error('[Gemini Test] Error details:');
      console.error(JSON.stringify(error.details, null, 2));
    }

    process.exitCode = 1;
  }
}

void main();

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const GEMINI_PROMPT_FILE_PATH = path.resolve(__dirname, '../config/gemini-cnic-ocr-prompt.json');

const DEFAULT_GEMINI_PROMPT = [
  'You are an OCR extractor for Pakistani CNIC cards.',
  'Inspect only the front image and determine whether a CNIC is visible.',
  'Return ONLY valid JSON.',
  'Do not include markdown, comments, code fences, or extra text.',
  'If no CNIC is visible, return cnic_available false and the rest of the fields as null or empty.',
  'If a CNIC is visible, return cnic_available true and extract the full structured identity payload.',
  'Normalize CNIC as XXXXX-XXXXXXX-X and date fields as DD-MM-YYYY when possible.',
  'Return this exact JSON shape:',
  '{"cnic_available": boolean, "cnic": string|null, "dob": string|null, "name": string|null,',
  '"father_or_husband_name": string|null, "gender": string|null, "nationality": string|null,',
  '"issue_date": string|null, "expiry_date": string|null, "address": string|null,',
  '"confidence": number, "raw_text": string, "ocr_backend": "gemini", "warnings": string[] }.',
  'Confidence must be between 0 and 1.',
].join(' ');

let cachedGeminiPromptText = null;

function parseBoolean(value, defaultValue) {
  if (typeof value !== 'string') {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  return defaultValue;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeWarnings(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function normalizeBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (['true', 'yes', '1'].includes(normalized)) {
      return true;
    }

    if (['false', 'no', '0'].includes(normalized)) {
      return false;
    }
  }

  return defaultValue;
}

function normalizeConfidence(value) {
  const confidenceNumber = Number(value);

  if (!Number.isFinite(confidenceNumber)) {
    return null;
  }

  return Math.max(0, Math.min(1, confidenceNumber));
}

function getVerificationConfig() {
  return {
    serviceUrl: process.env.CNIC_OCR_SERVICE_URL || 'http://127.0.0.1:8001/ocr',
    timeoutMs: Number(process.env.CNIC_OCR_TIMEOUT_MS) || 15000,
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 30000,
    fallbackToOcr: parseBoolean(process.env.CNIC_FALLBACK_TO_OCR, true),
    stopOcrModelOnGeminiSuccess: parseBoolean(
      process.env.CNIC_STOP_OCR_MODEL_ON_GEMINI_SUCCESS,
      true,
    ),
  };
}

function extractPromptTextFromConfig(configPayload) {
  const parts = configPayload?.backend_to_gemini_request?.body?.contents?.[0]?.parts;

  if (!Array.isArray(parts)) {
    return '';
  }

  const promptPart = parts.find((part) => typeof part?.text === 'string' && part.text.trim());
  return promptPart?.text?.trim() || '';
}

function getGeminiPromptText() {
  if (cachedGeminiPromptText) {
    return cachedGeminiPromptText;
  }

  try {
    const raw = fs.readFileSync(GEMINI_PROMPT_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const promptText = extractPromptTextFromConfig(parsed);

    if (promptText) {
      cachedGeminiPromptText = promptText;
      return cachedGeminiPromptText;
    }
  } catch (error) {
    console.warn(`[CNIC] Failed to load Gemini prompt config: ${error.message}`);
  }

  cachedGeminiPromptText = DEFAULT_GEMINI_PROMPT;
  return cachedGeminiPromptText;
}

function buildOcrUpstreamError(status, payload) {
  const error = new Error(payload?.message || 'CNIC OCR service returned an error.');

  if (status === 400 || status === 413 || status === 415 || status === 422 || status === 503) {
    error.statusCode = status;
  } else if (status === 504) {
    error.statusCode = 504;
  } else {
    error.statusCode = 502;
  }

  if (payload && typeof payload === 'object') {
    error.details = payload;
  }

  return error;
}

function buildGeminiUpstreamError(status, payload) {
  const message = payload?.error?.message || payload?.message || 'Gemini service returned an error.';
  const error = new Error(message);

  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 413 || status === 422) {
    error.statusCode = status;
  } else if (status === 429) {
    error.statusCode = 429;
  } else if (status === 504) {
    error.statusCode = 504;
  } else {
    error.statusCode = 502;
  }

  if (payload && typeof payload === 'object') {
    error.details = payload;
  }

  return error;
}

function buildOcrTransportError(error, timeoutMs) {
  if (error.code === 'ECONNABORTED') {
    const timeoutError = new Error(
      `CNIC OCR service timed out after ${timeoutMs}ms. If this is the first run, wait for OCR model initialization and retry.`,
    );
    timeoutError.statusCode = 504;
    return timeoutError;
  }

  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
    const unavailableError = new Error(
      'CNIC OCR service is unavailable. Make sure the OCR microservice is running.',
    );
    unavailableError.statusCode = 503;
    return unavailableError;
  }

  const serviceError = new Error('CNIC OCR service is unavailable.');
  serviceError.statusCode = 503;
  return serviceError;
}

function buildGeminiTransportError(error, timeoutMs) {
  if (error.code === 'ECONNABORTED') {
    const timeoutError = new Error(`Gemini request timed out after ${timeoutMs}ms.`);
    timeoutError.statusCode = 504;
    return timeoutError;
  }

  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
    const unavailableError = new Error('Gemini service is unavailable. Please try again.');
    unavailableError.statusCode = 503;
    return unavailableError;
  }

  const serviceError = new Error('Gemini service is unavailable.');
  serviceError.statusCode = 503;
  return serviceError;
}

function buildGeminiRequestPayload(file) {
  return {
    generationConfig: {
      temperature: 0,
      topP: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
    contents: [
      {
        role: 'user',
        parts: [
          { text: getGeminiPromptText() },
          {
            inline_data: {
              mime_type: file.mimetype || 'image/jpeg',
              data: file.buffer.toString('base64'),
            },
          },
        ],
      },
    ],
  };
}

function extractGeminiTextResponse(responsePayload) {
  const parts = responsePayload?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return '';
  }

  const textPart = parts.find((part) => typeof part?.text === 'string' && part.text.trim());
  return textPart?.text?.trim() || '';
}

function parseGeminiJsonResponse(responsePayload) {
  const textResponse = extractGeminiTextResponse(responsePayload);

  if (!textResponse) {
    const error = new Error('Gemini response did not include JSON text.');
    error.statusCode = 502;
    throw error;
  }

  const candidates = [textResponse];
  
  // Try to extract from code fences
  const fencedMatch = textResponse.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch?.[1]) {
    candidates.push(fencedMatch[1].trim());
  }

  // Try to extract JSON object pattern: {...}
  const jsonMatch = textResponse.match(/(\{[\s\S]*\})/);
  if (jsonMatch?.[1]) {
    candidates.push(jsonMatch[1].trim());
  }

  // Try trimmed version
  candidates.push(textResponse.trim());

  // Attempt aggressive recovery: find the last } and try parsing from { to }
  const openBrace = textResponse.lastIndexOf('{');
  const closeBrace = textResponse.lastIndexOf('}');
  if (openBrace >= 0 && closeBrace > openBrace) {
    const truncated = textResponse.substring(openBrace, closeBrace + 1);
    if (truncated !== textResponse) {
      candidates.push(truncated);
    }
  }

  let lastParseError = null;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      return {
        geminiJson: JSON.parse(candidate),
        textResponse,
      };
    } catch (err) {
      lastParseError = err;
    }
  }

  // Final fallback: try to fix common truncation issues
  // If response looks like truncated JSON, try to close it
  const trimmed = textResponse.trim();
  if (trimmed.startsWith('{')) {
    try {
      // Try adding closing braces if missing
      const fixed = trimmed.endsWith('}') ? trimmed : trimmed + '}';
      return {
        geminiJson: JSON.parse(fixed),
        textResponse,
      };
    } catch (err) {
      lastParseError = err;
    }
  }

  const error = new Error('Gemini returned invalid JSON.');
  error.statusCode = 502;
  error.details = {
    responseText: textResponse.slice(0, 2000),
    lastParseError: lastParseError?.message,
  };
  throw error;
}

function normalizeGeminiResult(geminiJson, textResponse) {
  const rawText = normalizeOptionalString(geminiJson?.raw_text) ?? textResponse;
  const backend = normalizeOptionalString(geminiJson?.ocr_backend) ?? 'gemini';
  const warnings = normalizeWarnings(geminiJson?.warnings);
  const cnicAvailable = normalizeBoolean(
    geminiJson?.cnic_available ?? geminiJson?.cnic_present ?? geminiJson?.has_cnic,
    Boolean(normalizeOptionalString(geminiJson?.cnic)),
  );

  return {
    cnic_available: cnicAvailable,
    cnic: normalizeOptionalString(geminiJson?.cnic),
    dob: normalizeOptionalString(geminiJson?.dob),
    name: normalizeOptionalString(geminiJson?.name),
    father_or_husband_name: normalizeOptionalString(geminiJson?.father_or_husband_name),
    gender: normalizeOptionalString(geminiJson?.gender),
    nationality: normalizeOptionalString(geminiJson?.nationality),
    issue_date: normalizeOptionalString(geminiJson?.issue_date),
    expiry_date: normalizeOptionalString(geminiJson?.expiry_date),
    address: normalizeOptionalString(geminiJson?.address),
    confidence: normalizeConfidence(geminiJson?.confidence),
    raw_text: rawText,
    text: rawText,
    ocr_backend: backend,
    warnings,
    gemini_json: geminiJson,
  };
}

function getOcrStopUrl(serviceUrl) {
  const trimmed = serviceUrl.trim();

  if (trimmed.endsWith('/ocr')) {
    return `${trimmed.slice(0, -4)}/pipeline/stop`;
  }

  return `${trimmed.replace(/\/$/, '')}/pipeline/stop`;
}

async function stopOcrModel(serviceUrl) {
  const stopUrl = getOcrStopUrl(serviceUrl);
  const response = await axios.post(stopUrl, null, {
    timeout: 5000,
    validateStatus: () => true,
  });

  if (response.status >= 200 && response.status < 300) {
    return;
  }

  const error = new Error(response?.data?.message || `Failed to stop OCR model at ${stopUrl}.`);
  error.statusCode = 503;
  throw error;
}

async function verifyCnicWithGemini(file) {
  const {
    geminiApiKey,
    geminiModel,
    geminiTimeoutMs,
  } = getVerificationConfig();

  if (!geminiApiKey) {
    const error = new Error('GEMINI_API_KEY is missing. Please set it in backend/.env.');
    error.statusCode = 500;
    throw error;
  }

  const requestBody = buildGeminiRequestPayload(file);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    geminiModel,
  )}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

  try {
    const response = await axios.post(endpoint, requestBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: geminiTimeoutMs,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
    });

    if (response.status >= 200 && response.status < 300) {
      const { geminiJson, textResponse } = parseGeminiJsonResponse(response.data);
      return normalizeGeminiResult(geminiJson, textResponse);
    }

    throw buildGeminiUpstreamError(response.status, response.data);
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    if (error.response) {
      throw buildGeminiUpstreamError(error.response.status, error.response.data);
    }

    throw buildGeminiTransportError(error, geminiTimeoutMs);
  }
}

async function verifyCnicWithOcr(file) {
  const { serviceUrl, timeoutMs } = getVerificationConfig();

  const formData = new FormData();
  formData.append('image', file.buffer, {
    filename: file.originalname || 'cnic-upload.jpg',
    contentType: file.mimetype || 'image/jpeg',
    knownLength: file.size,
  });

  try {
    const response = await axios.post(serviceUrl, formData, {
      headers: formData.getHeaders(),
      timeout: timeoutMs,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
    });

    if (response.status >= 200 && response.status < 300) {
      return response.data;
    }

    throw buildOcrUpstreamError(response.status, response.data);
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    if (error.response) {
      throw buildOcrUpstreamError(error.response.status, error.response.data);
    }

    throw buildOcrTransportError(error, timeoutMs);
  }
}

async function verifyCnicWithGeminiPreferred(file) {
  const {
    fallbackToOcr,
    serviceUrl,
    stopOcrModelOnGeminiSuccess,
  } = getVerificationConfig();

  try {
    const geminiResult = await verifyCnicWithGemini(file);

    if (stopOcrModelOnGeminiSuccess) {
      try {
        await stopOcrModel(serviceUrl);
      } catch (error) {
        console.warn(`[CNIC] Gemini succeeded but OCR model stop call failed: ${error.message}`);
      }
    }

    return geminiResult;
  } catch (geminiError) {
    if (!fallbackToOcr) {
      throw geminiError;
    }

    console.warn(`[CNIC] Gemini failed (${geminiError.message}). Falling back to OCR service.`);
    const ocrResult = await verifyCnicWithOcr(file);

    return {
      ...ocrResult,
      ocr_backend: ocrResult.ocr_backend || 'ocr',
      gemini_json: null,
    };
  }
}

module.exports = {
  verifyCnicWithGemini,
  verifyCnicWithGeminiPreferred,
  verifyCnicWithOcr,
  stopOcrModel,
};

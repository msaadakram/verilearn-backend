const crypto = require('crypto');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

let cachedSupabaseAdminClient = null;

function normalizeSupabaseServiceRoleKey(rawKey) {
	let key = (rawKey || '').trim();

	if (!key) {
		return '';
	}

	if (
		(key.startsWith('"') && key.endsWith('"'))
		|| (key.startsWith("'") && key.endsWith("'"))
	) {
		key = key.slice(1, -1).trim();
	}

	key = key.replace(/^Bearer\s+/i, '').trim();
	return key;
}

function getSupabaseStorageConfig() {
	const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
	const serviceRoleKeyCandidate = normalizeSupabaseServiceRoleKey(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
	const secretKeyCandidate = normalizeSupabaseServiceRoleKey(process.env.SUPABASE_SECRET_KEY || '');
	const isPlaceholder = (value) => /replace_with/i.test(value || '');
	const serviceRoleKey = (
		(serviceRoleKeyCandidate && !isPlaceholder(serviceRoleKeyCandidate) && serviceRoleKeyCandidate)
		|| (secretKeyCandidate && !isPlaceholder(secretKeyCandidate) && secretKeyCandidate)
		|| serviceRoleKeyCandidate
		|| secretKeyCandidate
		|| ''
	);
	const bucket = (process.env.SUPABASE_STORAGE_BUCKET || 'profile-images').trim();
	const folder = (process.env.SUPABASE_STORAGE_FOLDER || 'avatars').trim().replace(/^\/+|\/+$/g, '');

	if (!supabaseUrl || !serviceRoleKey || !bucket) {
		const error = new Error('Supabase storage is not configured. Please set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY), and SUPABASE_STORAGE_BUCKET.');
		error.statusCode = 500;
		error.errorCode = 'SUPABASE_STORAGE_NOT_CONFIGURED';
		throw error;
	}

	if (isPlaceholder(serviceRoleKey)) {
		const error = new Error('SUPABASE_SERVICE_ROLE_KEY appears to still be a placeholder value. Please set the real Supabase service_role JWT or SUPABASE_SECRET_KEY value.');
		error.statusCode = 500;
		error.errorCode = 'SUPABASE_STORAGE_INVALID_SERVICE_ROLE_KEY';
		throw error;
	}

	if (/^sb_publishable_/i.test(serviceRoleKey)) {
		const error = new Error('SUPABASE_SERVICE_ROLE_KEY cannot be a publishable key. Use a server key (SUPABASE_SECRET_KEY) or legacy service_role JWT.');
		error.statusCode = 500;
		error.errorCode = 'SUPABASE_STORAGE_INVALID_SERVICE_ROLE_KEY';
		throw error;
	}

	return {
		supabaseUrl,
		serviceRoleKey,
		bucket,
		folder,
	};
}

function getSupabaseAdminClient() {
	if (cachedSupabaseAdminClient) {
		return cachedSupabaseAdminClient;
	}

	const { supabaseUrl, serviceRoleKey } = getSupabaseStorageConfig();

	cachedSupabaseAdminClient = createClient(supabaseUrl, serviceRoleKey, {
		auth: {
			autoRefreshToken: false,
			persistSession: false,
		},
	});

	return cachedSupabaseAdminClient;
}

function getSafeFileExtension(file) {
	const originalName = typeof file?.originalname === 'string' ? file.originalname : '';
	const extension = path.extname(originalName).toLowerCase();

	if (extension) {
		return extension;
	}

	const mimetype = typeof file?.mimetype === 'string' ? file.mimetype.toLowerCase() : '';

	if (mimetype === 'image/png') return '.png';
	if (mimetype === 'image/webp') return '.webp';
	if (mimetype === 'image/gif') return '.gif';
	if (mimetype === 'image/bmp') return '.bmp';
	if (mimetype === 'image/tiff') return '.tiff';

	return '.jpg';
}

function buildProfileImageObjectPath({ profileType, userId, file }) {
	const { folder } = getSupabaseStorageConfig();
	const safeProfileType = profileType === 'teacher' ? 'teacher' : 'student';
	const safeUserId = String(userId || 'user');
	const extension = getSafeFileExtension(file);
	const uniqueSuffix = `${Date.now()}-${crypto.randomUUID()}${extension}`;

	return [folder, safeProfileType, safeUserId, uniqueSuffix].filter(Boolean).join('/');
}

async function uploadProfileImageToSupabase(file, { profileType, userId }) {
	if (!file?.buffer) {
		const error = new Error('A profile image file is required.');
		error.statusCode = 400;
		error.errorCode = 'PROFILE_IMAGE_FILE_MISSING';
		throw error;
	}

	const { bucket } = getSupabaseStorageConfig();
	const supabaseAdmin = getSupabaseAdminClient();
	const objectPath = buildProfileImageObjectPath({ profileType, userId, file });
	const { error: uploadError } = await supabaseAdmin.storage.from(bucket).upload(objectPath, file.buffer, {
		upsert: false,
		contentType: file.mimetype || 'application/octet-stream',
	});

	if (uploadError) {
		const error = new Error(
			`Supabase profile image upload failed${uploadError.message ? `: ${uploadError.message}` : ''}`,
		);
		error.statusCode = 502;
		error.errorCode = 'SUPABASE_PROFILE_IMAGE_UPLOAD_FAILED';
		error.details = {
			cause: uploadError,
		};
		throw error;
	}

	const { data: publicData } = supabaseAdmin.storage.from(bucket).getPublicUrl(objectPath);
	if (publicData?.publicUrl) {
		return publicData.publicUrl;
	}

	const { supabaseUrl } = getSupabaseStorageConfig();
	return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
}

module.exports = {
	uploadProfileImageToSupabase,
};
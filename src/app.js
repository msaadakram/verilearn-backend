const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const authRoutes = require('./routes/auth.routes');
const messageRoutes = require('./routes/message.routes');
const callRoutes = require('./routes/call.routes');
const bookingRoutes = require('./routes/booking.routes');
const agoraRoutes = require('./routes/agora.routes');
const { getDatabaseStatus } = require('./config/db');

const runtimeSettings = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
};

const configuredOrigins = runtimeSettings.CLIENT_ORIGIN
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function buildAllowedOrigins(origins, nodeEnv) {
  const merged = new Set(origins);

  if (nodeEnv !== 'production') {
    [3000, 3001, 5173, 4173].forEach((port) => {
      merged.add(`http://localhost:${port}`);
      merged.add(`http://127.0.0.1:${port}`);
    });
  }

  return Array.from(merged);
}

const allowedOrigins = buildAllowedOrigins(configuredOrigins, runtimeSettings.NODE_ENV);

function isLoopbackHostname(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname === '::1';
}

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  if (runtimeSettings.NODE_ENV !== 'production') {
    try {
      const parsed = new URL(origin);
      return parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname);
    } catch (_error) {
      return false;
    }
  }

  return false;
}

function corsOriginResolver(origin, callback) {
  if (isAllowedOrigin(origin)) {
    return callback(null, true);
  }

  return callback(new Error(`CORS origin not allowed: ${origin}`));
}

const app = express();

app.use(helmet());
app.use(cors({ origin: corsOriginResolver, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan('dev'));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/call', callRoutes);
app.use('/api', bookingRoutes);      // /api/book-session, /api/teacher/:id/slots, /api/bookings/*
app.use('/api/agora', agoraRoutes);  // /api/agora/token, /api/agora/validate-join
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

app.get('/', (_req, res) => {
  res.status(200).json({
    message: 'Verilearn backend is running',
    status: 'ok',
  });
});

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'verilearn-backend',
    database: getDatabaseStatus(),
    timestamp: new Date().toISOString(),
  });
});

app.use((req, res) => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, _req, res, _next) => {
  const statusCode = Number(err.statusCode) || 500;
  const errorPayload = {
    message: err.message || 'Internal server error',
  };

  if (err.errorCode) {
    errorPayload.errorCode = err.errorCode;
  }

  if (typeof err.details !== 'undefined' && err.details !== null) {
    errorPayload.details = err.details;
  }

  if (typeof err.retryable === 'boolean') {
    errorPayload.retryable = err.retryable;
  }

  if (statusCode >= 500) {
    console.error(err);
  }

  res.status(statusCode).json(errorPayload);
});

module.exports = {
  app,
  corsOriginResolver,
};
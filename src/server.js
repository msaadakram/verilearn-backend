const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { createServer } = require('http');
const { Server: SocketIOServer } = require('socket.io');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const authRoutes = require('./routes/auth.routes');
const messageRoutes = require('./routes/message.routes');
const callRoutes = require('./routes/call.routes');
const bookingRoutes = require('./routes/booking.routes');
const agoraRoutes = require('./routes/agora.routes');
const { getEnv } = require('./config/env');
const { connectDatabase, disconnectDatabase, getDatabaseStatus } = require('./config/db');
const socketAuthMiddleware = require('./middleware/socketAuth');
const setupSocketHandlers = require('./socketHandlers');

const env = getEnv();
const configuredOrigins = env.CLIENT_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);

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

const allowedOrigins = buildAllowedOrigins(configuredOrigins, env.NODE_ENV);

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

  if (env.NODE_ENV !== 'production') {
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
let httpServer;
let io;

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

const startServer = async () => {
  await connectDatabase(env);

  // Create HTTP server for socket.io
  httpServer = createServer(app);
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOriginResolver,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Socket.io middleware
  io.use(socketAuthMiddleware);

  // Setup socket event handlers
  setupSocketHandlers(io);

  httpServer.listen(env.PORT, () => {
    console.log(`Backend server running on http://localhost:${env.PORT}`);
    console.log(`Socket.io ready on ws://localhost:${env.PORT}`);
  });

  // Attach io to app for use in routes
  app.io = io;
};

const gracefulShutdown = async (signal) => {
  console.log(`${signal} received. Shutting down gracefully...`);

  if (httpServer) {
    io?.close();
    await new Promise((resolve) => httpServer.close(resolve));
  }

  await disconnectDatabase();
  process.exit(0);
};

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});

startServer().catch((error) => {
  console.error('Failed to start backend server', error);
  process.exit(1);
});

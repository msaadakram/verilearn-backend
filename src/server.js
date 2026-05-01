const path = require('path');
const { createServer } = require('http');
const { Server: SocketIOServer } = require('socket.io');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { getEnv } = require('./config/env');
const { connectDatabase, disconnectDatabase } = require('./config/db');
const socketAuthMiddleware = require('./middleware/socketAuth');
const setupSocketHandlers = require('./socketHandlers');
const { app, corsOriginResolver } = require('./app');

const env = getEnv();

let httpServer;
let io;

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

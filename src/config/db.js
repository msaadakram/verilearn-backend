const mongoose = require('mongoose');

async function connectDatabase({ MONGODB_URI, MONGODB_DB_NAME }) {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  await mongoose.connect(MONGODB_URI, {
    dbName: MONGODB_DB_NAME,
    serverSelectionTimeoutMS: 10_000,
  });

  return mongoose.connection;
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.connection.close();
}

function getDatabaseStatus() {
  switch (mongoose.connection.readyState) {
    case 0:
      return 'disconnected';
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    default:
      return 'unknown';
  }
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  getDatabaseStatus,
};

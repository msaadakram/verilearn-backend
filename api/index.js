const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { app, env } = require('../src/app');
const { connectDatabase } = require('../src/config/db');

let dbInitializationPromise;

async function ensureDatabaseConnected() {
  if (!dbInitializationPromise) {
    dbInitializationPromise = connectDatabase(env).catch((error) => {
      dbInitializationPromise = undefined;
      throw error;
    });
  }

  return dbInitializationPromise;
}

module.exports = async (req, res) => {
  try {
    await ensureDatabaseConnected();
    return app(req, res);
  } catch (error) {
    console.error('Vercel function invocation failed:', error);
    return res.status(500).json({
      message: 'Backend initialization failed',
      details: error.message,
    });
  }
};
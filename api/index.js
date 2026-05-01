const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { connectDatabase } = require('../src/config/db');

let dbInitializationPromise;
let cachedApp;
let cachedEnv;

function getApp() {
  if (!cachedApp) {
    ({ app: cachedApp } = require('../src/app'));
  }

  return cachedApp;
}

function getValidatedEnv() {
  if (!cachedEnv) {
    const { getEnv } = require('../src/config/env');
    cachedEnv = getEnv();
  }

  return cachedEnv;
}

async function ensureDatabaseConnected() {
  const env = getValidatedEnv();

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
    const app = getApp();
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
import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

/**
 * Connect to MongoDB. Retries a few times so `docker compose up` + app start
 * in any order still converges. Registers all models via the barrel import.
 */
export async function connectDB(uri = env.mongoUri, { retries = 5, delayMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
      logger.info(`MongoDB connected → ${redact(uri)}`);
      return mongoose.connection;
    } catch (err) {
      logger.warn(`MongoDB connection attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}

/**
 * Run `fn(session)` inside a MongoDB multi-document transaction.
 * Degrades gracefully on standalone mongod (dev/CI that isn't a replica set):
 * code 20 = "Transaction numbers are only allowed on a replica member" — we
 * catch it and re-run without a session so the app stays functional, just
 * without atomicity. In production you MUST use a replica set (Atlas handles
 * this automatically).
 *
 * @param {(session: import('mongoose').ClientSession|null) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    if (err.code === 20 || err.codeName === 'IllegalOperation') {
      // Standalone mongod — no replica set, transactions not available.
      return fn(null);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

function redact(uri) {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}

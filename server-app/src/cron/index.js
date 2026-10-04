import { logger } from '@yatracab/core';
import { expireBiddingWindows } from './expireBiddingWindows.js';

const BIDDING_EXPIRE_INTERVAL_MS = 60 * 1000; // 60 s

/**
 * Start all background cron jobs. Call once after the DB is connected and the
 * HTTP server is up. Returns a cleanup function that clears all intervals
 * (useful in tests and graceful shutdown).
 */
export function startCronJobs() {
  const timers = [];

  // Run once immediately so the first window is closed on startup, then every
  // minute. Errors are caught and logged — a transient DB hiccup must not
  // bring down the interval.
  const runExpiry = () =>
    expireBiddingWindows().catch((err) =>
      logger.error(`[cron] expireBiddingWindows failed: ${err.message}`, { stack: err.stack })
    );

  runExpiry();
  timers.push(setInterval(runExpiry, BIDDING_EXPIRE_INTERVAL_MS));

  logger.info('[cron] started: expireBiddingWindows every 60 s');

  return () => timers.forEach(clearInterval);
}

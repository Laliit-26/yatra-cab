import helmet from 'helmet';
import cors from 'cors';
import hpp from 'hpp';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import express from 'express';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';
import { requestId } from './requestId.js';

/**
 * Apply the shared security + parsing middleware chain to an Express app.
 * server-admin passes a tighter `rateLimit` and its own origin allowlist.
 *
 * @param {import('express').Express} app
 * @param {object} opts
 * @param {string[]} opts.allowedOrigins
 * @param {number}   [opts.rateLimitMax]  requests / 15 min / IP
 * @param {string}   [opts.jsonLimit]
 */
export function applySecurity(app, { allowedOrigins = [], rateLimitMax = 300, jsonLimit = '1mb' } = {}) {
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId); // attach req.id + echo X-Request-Id before any logging
  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        // Allow same-origin / server-to-server (no Origin header) and whitelisted origins.
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new ApiError(403, `Origin not allowed by CORS: ${origin}`));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: jsonLimit }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(mongoSanitize()); // strip $ and . → blocks NoSQL injection
  app.use(hpp()); // HTTP parameter pollution
  app.use(compression());
  if (env.nodeEnv !== 'test') {
    morgan.token('req-id', (req) => req.id);
    // Include the request ID in every access log line for end-to-end tracing.
    const fmt = env.isProd ? ':req-id :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"' : ':req-id :method :url :status :response-time ms';
    app.use(morgan(fmt));
  }

  // SCALING NOTE: express-rate-limit uses an in-memory store by default.
  // Each instance tracks its own counters, so the effective limit multiplies
  // by the number of instances (2 instances → 2× the allowed requests per IP).
  // For multi-instance deployments switch to rate-limit-redis or similar:
  //   import RedisStore from 'rate-limit-redis';
  //   store: new RedisStore({ sendCommand: (...args) => redisClient.sendCommand(args) })
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, message: 'Too many requests, please slow down.' },
    })
  );
}

// OTP limiting, in two layers.
//
// Keying on IP alone was wrong: everyone behind one office or mobile-carrier
// NAT shares a bucket, so a handful of people signing in locks out the rest —
// and in development every portal and script comes from ::1, which wedges the
// whole app. The per-phone limit is what actually stops SMS bombing; the IP
// limit is a wider net against someone enumerating numbers from one machine.
const normalisePhone = (v) => String(v || '').replace(/[^0-9]/g, '').slice(-10);

/** Stops one number being bombed with texts. */
export const otpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: env.isProd ? 5 : 50, // dev shares one machine across three portals
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => normalisePhone(req.body?.phone) || `ip:${req.ip}`,
  message: { success: false, message: 'Too many codes requested for this number. Try again in a few minutes.' },
});

/** Backstop: one machine should not be able to walk the phone-number space. */
export const otpAbuseLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: env.isProd ? 40 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many OTP requests from this device. Try again later.' },
});

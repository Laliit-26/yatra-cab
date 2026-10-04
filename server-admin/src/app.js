import './config/loadEnv.js';
import express from 'express';
import { applySecurity, notFound, errorHandler, ok } from '@yatracab/core';
import { adminConfig } from './config/loadEnv.js';

import authRoutes from './modules/auth/adminAuthRoutes.js';
import dashboardRoutes from './modules/dashboard/dashboardRoutes.js';
import driverRoutes from './modules/drivers/driverAdminRoutes.js';
import couponRoutes from './modules/coupons/couponAdminRoutes.js';
import customerRoutes from './modules/customers/customerAdminRoutes.js';
import bookingRoutes from './modules/bookings/bookingRoutes.js';
import routeRoutes from './modules/routes/routeRoutes.js';
import reportRoutes from './modules/reports/reportRoutes.js';
import safetyRoutes from './modules/safety/safetyRoutes.js';

export function createAdminApp() {
  const app = express();

  // Hardened: tighter global rate limit + strict CORS allowlist for the admin portal only.
  applySecurity(app, { allowedOrigins: adminConfig.clientUrls, rateLimitMax: 200, jsonLimit: '512kb' });

  app.get('/health', (_req, res) => ok(res, { service: 'server-admin', ts: Date.now() }));

  app.use('/api/auth', authRoutes);
  app.use('/api/admin/dashboard', dashboardRoutes);
  app.use('/api/admin/drivers', driverRoutes);
  app.use('/api/admin/customers', customerRoutes);
  app.use('/api/admin/bookings', bookingRoutes);
  app.use('/api/admin/routes', routeRoutes);
  app.use('/api/admin/reports', reportRoutes);
  app.use('/api/admin/safety', safetyRoutes);
  app.use('/api/admin/coupons', couponRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

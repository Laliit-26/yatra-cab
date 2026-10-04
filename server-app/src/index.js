import './config/loadEnv.js';
import http from 'http';
import { connectDB, disconnectDB, logger, needsSeeding, seedDatabase } from '@yatracab/core';
import { createApp } from './app.js';
import { appConfig } from './config/loadEnv.js';
import { initSockets } from './sockets/index.js';
import { startCronJobs } from './cron/index.js';

async function bootstrap() {
  await connectDB();

  // Optional one-time seed on a fresh deploy (AUTO_SEED=true) — populates
  // routes, demo accounts and an admin login when the database is empty.
  if (process.env.AUTO_SEED === 'true') {
    try {
      // Self-healing: (re)seed with a clean wipe whenever the admin account
      // is missing (fresh DB, or a previous partial seed). Once seeded
      // successfully it won't run again.
      if (await needsSeeding()) {
        logger.info('AUTO_SEED: seeding demo data (routes, accounts, admin)…');
        await seedDatabase({ demoEmail: process.env.SEED_DEMO_EMAIL || process.env.GMAIL_USER, clear: true });
      }
    } catch (err) {
      logger.warn(`AUTO_SEED failed: ${err.message}`);
    }
  }

  const app = createApp();
  const server = http.createServer(app);
  initSockets(server);
  const stopCrons = startCronJobs();

  server.listen(appConfig.port, () => {
    logger.info(`server-app (customer + driver) listening on http://localhost:${appConfig.port}`);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down server-app…`);
    stopCrons();
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    // Force-exit if it hangs.
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error(`server-app failed to start: ${err.message}`, { stack: err.stack });
  process.exit(1);
});

import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Gmail answers on 465 (implicit TLS) and 587 (STARTTLS). Hosts block these
// inconsistently — Render's free tier is the usual offender — so try both
// rather than assuming the first failure means SMTP is unavailable. The 8s
// timeouts that used to be here were also too tight: a cold free-tier
// container can take longer than that just to open the socket.
const CANDIDATES = [
  { port: 465, secure: true },
  { port: 587, secure: false, requireTLS: true },
];

const TIMEOUT_MS = 25000;

let working = null; // the transport that last succeeded

function build({ port, secure, requireTLS }) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port,
    secure,
    ...(requireTLS ? { requireTLS: true } : {}),
    auth: { user: env.otp.gmailUser, pass: env.otp.gmailAppPassword },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
}

/**
 * Send an email via Gmail SMTP, trying each port until one works and then
 * remembering it. If no port connects, the caller gets `{ delivered:false }`
 * and the reason is logged — a mail failure must never break the request.
 */
export async function sendMail({ to, subject, text, html }) {
  if (!env.otp.gmailUser || !env.otp.gmailAppPassword) {
    logger.warn(`[mailer] SMTP not configured — email to ${to} NOT sent. Subject: "${subject}"`);
    logger.info(`[mailer:dev] ${text || subject}`);
    return { delivered: false, reason: 'not_configured' };
  }

  const message = { from: `"${env.otp.fromName}" <${env.otp.gmailUser}>`, to, subject, text, html };
  const order = working ? [working, ...CANDIDATES.filter((c) => c.port !== working.port)] : CANDIDATES;
  const failures = [];

  for (const candidate of order) {
    try {
      await build(candidate).sendMail(message);
      if (working?.port !== candidate.port) logger.info(`[mailer] using smtp.gmail.com:${candidate.port}`);
      working = candidate;
      return { delivered: true, port: candidate.port };
    } catch (err) {
      // EAUTH is the credential being wrong — no other port will fix that.
      if (err.code === 'EAUTH') {
        logger.warn(`[mailer] auth rejected for ${env.otp.gmailUser}: ${err.message}`);
        return { delivered: false, reason: 'auth' };
      }
      failures.push(`${candidate.port}:${err.code || err.message}`);
    }
  }

  working = null;
  logger.warn(`[mailer] send to ${to} failed on every port (${failures.join(', ')}) — host is probably blocking outbound SMTP`);
  return { delivered: false, reason: 'blocked' };
}

import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Delivery is tried over HTTPS first, then SMTP.
//
// Render's free tier blocks outbound SMTP: Gmail times out on both 465 and 587
// no matter how generous the timeout, so a deployed service cannot send mail
// that way at all. The transactional providers below send over plain HTTPS,
// which is not blocked. SMTP is kept because it works fine locally and on hosts
// that allow it, so `npm run dev` needs no extra accounts.
//
// Set ONE of these and delivery starts working:
//   BREVO_API_KEY   — 300/day free, sends to any address once you verify a
//                     sender email. Best fit when you have no domain.
//   RESEND_API_KEY  — 3000/month free, but until you verify a domain it will
//                     only deliver to the address that owns the Resend account.
const TIMEOUT_MS = 25000;
const SMTP_PORTS = [
  { port: 465, secure: true },
  { port: 587, secure: false, requireTLS: true },
];

let workingPort = null;

const from = () => ({
  email: process.env.MAIL_FROM || env.otp.gmailUser,
  name: env.otp.fromName,
});

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

async function sendViaBrevo({ to, subject, text, html }) {
  const f = from();
  await postJson(
    'https://api.brevo.com/v3/smtp/email',
    { 'api-key': process.env.BREVO_API_KEY },
    { sender: { email: f.email, name: f.name }, to: [{ email: to }], subject, textContent: text, htmlContent: html }
  );
}

async function sendViaResend({ to, subject, text, html }) {
  const f = from();
  await postJson(
    'https://api.resend.com/emails',
    { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    { from: `${f.name} <${f.email}>`, to: [to], subject, text, html }
  );
}

function smtpTransport({ port, secure, requireTLS }) {
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

async function sendViaSmtp(message) {
  const order = workingPort
    ? [workingPort, ...SMTP_PORTS.filter((c) => c.port !== workingPort.port)]
    : SMTP_PORTS;
  const failures = [];
  for (const candidate of order) {
    try {
      await smtpTransport(candidate).sendMail({
        from: `"${env.otp.fromName}" <${env.otp.gmailUser}>`,
        ...message,
      });
      if (workingPort?.port !== candidate.port) logger.info(`[mailer] using smtp.gmail.com:${candidate.port}`);
      workingPort = candidate;
      return;
    } catch (err) {
      if (err.code === 'EAUTH') throw err; // wrong credential — another port won't help
      failures.push(`${candidate.port}:${err.code || err.message}`);
    }
  }
  workingPort = null;
  throw new Error(`every SMTP port failed (${failures.join(', ')}) — host is probably blocking outbound SMTP`);
}

/**
 * Send an email, preferring whichever HTTPS provider is configured and falling
 * back to Gmail SMTP. A mail failure must never break the calling request, so
 * this always resolves — check `delivered`.
 */
export async function sendMail({ to, subject, text, html }) {
  const message = { to, subject, text, html };

  const providers = [
    process.env.BREVO_API_KEY && ['brevo', sendViaBrevo],
    process.env.RESEND_API_KEY && ['resend', sendViaResend],
    env.otp.gmailUser && env.otp.gmailAppPassword && ['gmail-smtp', sendViaSmtp],
  ].filter(Boolean);

  if (!providers.length) {
    logger.warn(`[mailer] no provider configured — email to ${to} NOT sent. Subject: "${subject}"`);
    logger.info(`[mailer:dev] ${text || subject}`);
    return { delivered: false, reason: 'not_configured' };
  }

  for (const [name, send] of providers) {
    try {
      await send(message);
      return { delivered: true, via: name };
    } catch (err) {
      logger.warn(`[mailer] ${name} failed for ${to}: ${err.message}`);
    }
  }
  return { delivered: false, reason: 'all_providers_failed' };
}

import bcrypt from 'bcryptjs';
import { Otp } from '../models/Otp.js';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { sendMail } from './mailer.js';
import { ApiError } from '../utils/apiError.js';

const MAX_ATTEMPTS = 5;

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Issue an OTP for a phone number. The code is delivered via the configured
 * channel (Gmail email for now) to the account's email; if there is no email
 * on file or SMTP isn't configured, the code is logged and returned as
 * `devOtp` so local dev works end-to-end without credentials.
 *
 * @returns {{ devOtp?: string, delivered: boolean, channel: string }}
 */
export async function requestOtp(phone, { email, purpose = 'login' } = {}) {
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 8);
  const expiresAt = new Date(Date.now() + env.otp.ttlMs);

  // One live OTP per phone — replace any previous.
  await Otp.findOneAndUpdate(
    { phone },
    { phone, codeHash, purpose, attempts: 0, expiresAt },
    { upsert: true, new: true }
  );

  // Resolve a destination email (arg wins, else the user's stored email).
  let destEmail = email;
  if (!destEmail) {
    const user = await User.findOne({ phone }).select('email');
    destEmail = user?.email;
  }

  let delivered = false;
  // In demo mode we don't try to email at all (the host may block SMTP) — the
  // code is returned in the response and shown on screen instead.
  if (!env.otp.demoMode && destEmail) {
    const res = await sendMail({
      to: destEmail,
      subject: `${env.otp.fromName} verification code: ${code}`,
      text: `Your ${env.otp.fromName} OTP is ${code}. It expires in ${Math.round(
        env.otp.ttlMs / 60000
      )} minutes. Do not share it with anyone.`,
      html: otpEmailHtml(code),
    });
    delivered = res.delivered;
  } else if (!env.otp.demoMode) {
    logger.warn(`[otp] No email on file for ${phone}; OTP not emailed.`);
  }

  // Surface the code when in demo mode, or (in dev) when it wasn't delivered.
  const exposeDev = env.otp.demoMode || (!delivered && !env.isProd);
  if (exposeDev) logger.info(`[otp:dev] ***${String(phone).slice(-4)} → ${code}`);

  return { delivered, channel: env.otp.channel, ...(exposeDev ? { devOtp: code } : {}) };
}

/** Verify a submitted code. Throws ApiError on mismatch/expiry. */
export async function verifyOtp(phone, code) {
  // Seeded demo accounts accept the fixed DEV_OTP only in non-production demo mode.
  if (env.otp.demoMode && !env.isProd && code === env.otp.devOtp) {
    await Otp.deleteOne({ phone });
    return true;
  }

  const record = await Otp.findOne({ phone });
  if (!record) throw ApiError.badRequest('No OTP requested or it has expired');
  if (record.expiresAt < new Date()) {
    await Otp.deleteOne({ _id: record._id });
    throw ApiError.badRequest('OTP has expired');
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    await Otp.deleteOne({ _id: record._id });
    throw ApiError.badRequest('Too many attempts — request a new OTP');
  }

  const match = await bcrypt.compare(code, record.codeHash);
  if (!match) {
    record.attempts += 1;
    await record.save();
    throw ApiError.badRequest('Incorrect OTP');
  }

  await Otp.deleteOne({ _id: record._id });
  return true;
}

function otpEmailHtml(code) {
  return `
  <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:460px;margin:auto">
    <div style="background:#0f766e;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
      <h2 style="margin:0;font-size:18px">YatraCab</h2>
      <p style="margin:4px 0 0;opacity:.85;font-size:13px">Rides, your way</p>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:0;padding:24px;border-radius:0 0 12px 12px">
      <p style="color:#334155;font-size:14px">Your verification code is:</p>
      <p style="font-size:34px;letter-spacing:8px;font-weight:700;color:#0f172a;margin:12px 0">${code}</p>
      <p style="color:#64748b;font-size:13px">This code expires in 5 minutes. Never share it with anyone — YatraCab will never ask for it.</p>
    </div>
  </div>`;
}

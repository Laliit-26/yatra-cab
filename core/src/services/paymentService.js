import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Payment gateway abstraction. Defaults to a MOCK provider that requires no
 * external calls (auto-verifiable) so the advance-fee flow is fully runnable.
 * Swap PAYMENT_PROVIDER=razorpay + keys to go live later — the controller
 * code stays identical.
 */

function mockOrder(amount, receipt) {
  const orderId = `order_mock_${crypto.randomBytes(8).toString('hex')}`;
  return {
    id: orderId,
    amount: amount * 100, // paise, to mirror Razorpay
    currency: 'INR',
    receipt,
    provider: 'mock',
    // A deterministic "signature" the client echoes back so verify() can pass.
    mockToken: crypto.createHash('sha256').update(orderId).digest('hex').slice(0, 16),
  };
}

/** Create a gateway order for the fee (amount in INR). */
export async function createOrder({ amount, receipt }) {
  if (env.payment.provider === 'razorpay' && env.payment.razorpayKeySecret) {
    // Real Razorpay integration (activated when keys are present).
    const { default: Razorpay } = await import('razorpay');
    const rp = new Razorpay({ key_id: env.payment.razorpayKeyId, key_secret: env.payment.razorpayKeySecret });
    const order = await rp.orders.create({ amount: amount * 100, currency: 'INR', receipt });
    // keyId travels with the order so the client never needs a second round
    // trip to open Checkout. It is the publishable key — safe in the browser.
    return { ...order, provider: 'razorpay', keyId: env.payment.razorpayKeyId };
  }
  logger.info(`[payment:mock] created order for ₹${amount}`);
  return mockOrder(amount, receipt);
}

/** Verify a payment. Returns true when the signature/token is valid. */
export async function verifyPayment({ orderId, paymentId, signature }) {
  if (env.payment.provider === 'razorpay' && env.payment.razorpayKeySecret) {
    const expected = crypto
      .createHmac('sha256', env.payment.razorpayKeySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return expected === signature;
  }
  // Mock: signature must equal the deterministic token from createOrder.
  const expected = crypto.createHash('sha256').update(orderId).digest('hex').slice(0, 16);
  return signature === expected;
}

/**
 * Verify a Razorpay webhook. Razorpay signs the RAW body with the webhook
 * secret, so the caller must hand over the exact bytes received — a
 * re-serialised JSON object will not match.
 *
 * Compared in constant time: a fast-failing compare leaks how much of a forged
 * signature was correct, which is enough to reconstruct it byte by byte.
 */
export function verifyWebhookSignature({ rawBody, signature }) {
  if (env.payment.provider !== 'razorpay') return true; // mock mode: nothing to verify
  const secret = env.payment.razorpayWebhookSecret;
  if (!secret || !rawBody || !signature) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Issue a refund (mock returns a synthetic id). */
export async function refund({ paymentId, amount, reason }) {
  if (env.payment.provider === 'razorpay' && env.payment.razorpayKeySecret) {
    const { default: Razorpay } = await import('razorpay');
    const rp = new Razorpay({ key_id: env.payment.razorpayKeyId, key_secret: env.payment.razorpayKeySecret });
    const r = await rp.payments.refund(paymentId, { amount: amount * 100 });
    return { id: r.id, amount, reason };
  }
  logger.info(`[payment:mock] refunded ₹${amount} (${reason})`);
  return { id: `rfnd_mock_${crypto.randomBytes(6).toString('hex')}`, amount, reason };
}

export const paymentPublicConfig = () => ({
  provider: env.payment.provider,
  razorpayKeyId: env.payment.razorpayKeyId || null,
});

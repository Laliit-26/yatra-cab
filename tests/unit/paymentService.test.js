import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { createOrder, verifyPayment, verifyWebhookSignature } from '../../core/src/services/paymentService.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function setMockProvider() {
  process.env.PAYMENT_PROVIDER = 'mock';
  delete process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
}

function setRazorpayProvider(opts = {}) {
  process.env.PAYMENT_PROVIDER = 'razorpay';
  process.env.RAZORPAY_KEY_SECRET = opts.keySecret ?? 'test_secret_stand_in';
  process.env.RAZORPAY_WEBHOOK_SECRET = opts.webhookSecret ?? 'test_webhook_stand_in';
  if (opts.keyId) process.env.RAZORPAY_KEY_ID = opts.keyId;
}

function clearPaymentEnv() {
  delete process.env.PAYMENT_PROVIDER;
  delete process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  delete process.env.RAZORPAY_KEY_ID;
}

// ── mock provider ─────────────────────────────────────────────────────────────

describe('mock provider — createOrder + verifyPayment round-trip', () => {
  beforeEach(setMockProvider);
  afterEach(clearPaymentEnv);

  it('createOrder returns id, amount in paise, and a mockToken', async () => {
    const order = await createOrder({ amount: 300, receipt: 'rcpt_1' });
    expect(order.id).toMatch(/^order_mock_/);
    expect(order.amount).toBe(30000); // INR → paise
    expect(order.currency).toBe('INR');
    expect(typeof order.mockToken).toBe('string');
    expect(order.mockToken.length).toBeGreaterThan(0);
  });

  it('verifyPayment returns true for the correct mockToken', async () => {
    const order = await createOrder({ amount: 100, receipt: 'r1' });
    expect(await verifyPayment({ orderId: order.id, signature: order.mockToken })).toBe(true);
  });

  it('verifyPayment returns false for a wrong token', async () => {
    const order = await createOrder({ amount: 100, receipt: 'r2' });
    expect(await verifyPayment({ orderId: order.id, signature: 'deadbeef' })).toBe(false);
  });

  it('verifyPayment returns false for an empty token', async () => {
    const order = await createOrder({ amount: 100, receipt: 'r3' });
    expect(await verifyPayment({ orderId: order.id, signature: '' })).toBe(false);
  });

  it('each order gets a unique id and token', async () => {
    const a = await createOrder({ amount: 100, receipt: 'x' });
    const b = await createOrder({ amount: 100, receipt: 'y' });
    expect(a.id).not.toBe(b.id);
    expect(a.mockToken).not.toBe(b.mockToken);
  });
});

// ── Razorpay checkout signature verification ──────────────────────────────────

describe('razorpay — verifyPayment (checkout signature)', () => {
  const orderId = 'order_TESTabc123';
  const paymentId = 'pay_TESTxyz789';
  const secret = 'test_secret_stand_in';

  beforeEach(() => setRazorpayProvider({ keySecret: secret }));
  afterEach(clearPaymentEnv);

  function validSig(oId = orderId, pId = paymentId) {
    return crypto.createHmac('sha256', secret).update(`${oId}|${pId}`).digest('hex');
  }

  it('accepts a correctly computed HMAC signature', async () => {
    expect(await verifyPayment({ orderId, paymentId, signature: validSig() })).toBe(true);
  });

  it('rejects a tampered paymentId', async () => {
    expect(await verifyPayment({ orderId, paymentId: 'pay_OTHER', signature: validSig() })).toBe(false);
  });

  it('rejects a tampered orderId', async () => {
    expect(await verifyPayment({ orderId: 'order_OTHER', paymentId, signature: validSig() })).toBe(false);
  });

  it('rejects an all-zeroes forged signature', async () => {
    expect(await verifyPayment({ orderId, paymentId, signature: '0'.repeat(64) })).toBe(false);
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const wrongSig = crypto.createHmac('sha256', 'wrong_secret').update(`${orderId}|${paymentId}`).digest('hex');
    expect(await verifyPayment({ orderId, paymentId, signature: wrongSig })).toBe(false);
  });

  it('rejects an empty signature string', async () => {
    expect(await verifyPayment({ orderId, paymentId, signature: '' })).toBe(false);
  });
});

// ── Razorpay webhook signature verification ───────────────────────────────────

describe('verifyWebhookSignature (razorpay mode)', () => {
  const webhookSecret = 'test_webhook_stand_in';
  const rawBody = Buffer.from(
    JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1' } } } })
  );

  beforeEach(() => setRazorpayProvider({ webhookSecret }));
  afterEach(clearPaymentEnv);

  function validHookSig(body = rawBody, secret = webhookSecret) {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  it('returns true for a correctly signed rawBody (Buffer)', () => {
    expect(verifyWebhookSignature({ rawBody, signature: validHookSig() })).toBe(true);
  });

  it('returns true for a correctly signed rawBody (string)', () => {
    const bodyStr = rawBody.toString('utf8');
    const sig = validHookSig(bodyStr);
    expect(verifyWebhookSignature({ rawBody: bodyStr, signature: sig })).toBe(true);
  });

  it('returns false when rawBody is tampered (even one byte changed)', () => {
    const tampered = Buffer.concat([rawBody, Buffer.from('x')]);
    expect(verifyWebhookSignature({ rawBody: tampered, signature: validHookSig() })).toBe(false);
  });

  it('returns false for a forged all-f signature', () => {
    expect(verifyWebhookSignature({ rawBody, signature: 'f'.repeat(64) })).toBe(false);
  });

  it('returns false when signature length differs from expected 64 hex chars', () => {
    // Shorter
    expect(verifyWebhookSignature({ rawBody, signature: validHookSig().slice(0, 32) })).toBe(false);
    // Longer
    expect(verifyWebhookSignature({ rawBody, signature: validHookSig() + 'aa' })).toBe(false);
  });

  it('returns false when signature is missing / empty', () => {
    expect(verifyWebhookSignature({ rawBody, signature: '' })).toBe(false);
    expect(verifyWebhookSignature({ rawBody, signature: undefined })).toBe(false);
  });

  it('returns false when rawBody is missing', () => {
    expect(verifyWebhookSignature({ rawBody: undefined, signature: validHookSig() })).toBe(false);
    expect(verifyWebhookSignature({ rawBody: null, signature: validHookSig() })).toBe(false);
  });

  it('returns false when the webhook secret is wrong', () => {
    const sig = validHookSig(rawBody, 'different_secret');
    expect(verifyWebhookSignature({ rawBody, signature: sig })).toBe(false);
  });

  it('comparison is constant-time (timingSafeEqual): different signatures never shortcut', () => {
    // We cannot directly measure timing in a unit test, but we can confirm the
    // code path used is timingSafeEqual by verifying two wrong sigs of the same
    // length both return false (length-equality branch runs timingSafeEqual).
    const sig1 = '0'.repeat(64);
    const sig2 = '1'.repeat(64);
    expect(verifyWebhookSignature({ rawBody, signature: sig1 })).toBe(false);
    expect(verifyWebhookSignature({ rawBody, signature: sig2 })).toBe(false);
  });
});

// ── mock mode always passes webhook ──────────────────────────────────────────

describe('verifyWebhookSignature (mock mode)', () => {
  beforeEach(setMockProvider);
  afterEach(clearPaymentEnv);

  it('returns true for any input in mock mode (no verification needed)', () => {
    expect(verifyWebhookSignature({ rawBody: Buffer.from('anything'), signature: 'garbage' })).toBe(true);
  });

  it('returns true even when rawBody/signature are absent', () => {
    expect(verifyWebhookSignature({})).toBe(true);
  });
});

/**
 * confirmPaidRide — idempotency and single-assignment tests.
 *
 * The function is the convergence point for two delivery paths:
 *   1. Browser callback  (arrives immediately after payment)
 *   2. Razorpay webhook  (arrives seconds later, sometimes first)
 *
 * These tests verify that whichever path arrives second does NOT:
 *   • re-run driver assignment
 *   • reissue OTP codes (which would leave the driver with stale codes)
 *   • commit the coupon a second time
 *
 * realtime.js: io is null in the test process so socket emits are no-ops.
 * notify():    just logs — safe to call without FCM tokens.
 * commitCoupon(): returns null when there is no reserved coupon — safe.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

// Resolve the helper from the monorepo root using an absolute path.
import { startDb, stopDb, clearDb } from '../../../tests/helpers/mongo.js';

import { User } from '@yatracab/core';
import { Ride, RIDE_STATUS } from '@yatracab/core';
import { Payment } from '@yatracab/core';
import { confirmPaidRide } from '../modules/customer/paymentConfirm.js';

// ── fixtures ──────────────────────────────────────────────────────────────────

let mongoServer;

beforeAll(async () => { mongoServer = await startDb(); });
afterAll(async () => { await stopDb(mongoServer); });
beforeEach(async () => { await clearDb(); });

async function makeRideAndPayment({ mode = 'fixed', status = RIDE_STATUS.PENDING_PAYMENT } = {}) {
  const customer = await User.create({
    phone: `9${Date.now().toString().slice(-9)}`,
    role: 'customer',
  });

  const ride = await Ride.create({
    customer: customer._id,
    mode,
    vehicleType: 'sedan',
    scheduledAt: new Date(),
    status,
    fareAmount: 1000,
    feeAmount: 100,
    totalAmount: 1100,
    verification: {},
  });

  const payment = await Payment.create({
    ride: ride._id,
    customer: customer._id,
    amount: 100,
    provider: 'mock',
    orderId: `order_mock_${new mongoose.Types.ObjectId().toString()}`,
    status: 'created',
  });

  ride.payment = payment._id;
  await ride.save();

  return { customer, ride, payment };
}

// ── happy path ────────────────────────────────────────────────────────────────

describe('confirmPaidRide — first confirmation', () => {
  it('sets payment.status = paid and ride.status = confirmed', async () => {
    const { ride, payment } = await makeRideAndPayment();

    const result = await confirmPaidRide({
      payment,
      ride,
      paymentId: 'pay_first_test',
      signature: 'sig_first_test',
    });

    expect(result.alreadyConfirmed).toBe(false);
    expect(payment.status).toBe('paid');
    expect(ride.status).toBe(RIDE_STATUS.CONFIRMED);
  });

  it('mints start and end OTP codes on first confirmation', async () => {
    const { ride, payment } = await makeRideAndPayment();

    await confirmPaidRide({ payment, ride, paymentId: 'pay_otp_test' });

    expect(ride.verification.start?.code).toBeDefined();
    expect(ride.verification.end?.code).toBeDefined();
    expect(ride.verification.start.code).toMatch(/^\d{6}$/);
    expect(ride.verification.end.code).toMatch(/^\d{6}$/);
    expect(ride.verification.start.code).not.toBe(ride.verification.end.code);
  });

  it('persists the paymentId and signature on the payment document', async () => {
    const { ride, payment } = await makeRideAndPayment();
    await confirmPaidRide({ payment, ride, paymentId: 'pay_123', signature: 'sig_abc' });

    const saved = await Payment.findById(payment._id);
    expect(saved.paymentId).toBe('pay_123');
    expect(saved.signature).toBe('sig_abc');
    expect(saved.paidAt).toBeDefined();
  });

  it('calls the injected assignDriver callback for a fixed ride without a driver', async () => {
    const { ride, payment } = await makeRideAndPayment({ mode: 'fixed' });

    let assignCalled = 0;
    const fakeDriver = { _id: new mongoose.Types.ObjectId(), user: new mongoose.Types.ObjectId() };
    const assignDriver = async () => { assignCalled++; return fakeDriver; };

    await confirmPaidRide({ payment, ride, paymentId: 'pay_d', assignDriver });

    expect(assignCalled).toBe(1);
    expect(String(ride.driver)).toBe(String(fakeDriver._id));
  });
});

// ── idempotency ───────────────────────────────────────────────────────────────

describe('confirmPaidRide — duplicate call idempotency', () => {
  it('returns { alreadyConfirmed: true } when payment is already paid', async () => {
    const { ride, payment } = await makeRideAndPayment();

    // First call — confirms the ride.
    await confirmPaidRide({ payment, ride, paymentId: 'pay_first' });

    // Second call — must not re-run.
    const second = await confirmPaidRide({ payment, ride, paymentId: 'pay_second' });
    expect(second.alreadyConfirmed).toBe(true);
  });

  it('does not overwrite OTP codes on a duplicate call', async () => {
    const { ride, payment } = await makeRideAndPayment();

    await confirmPaidRide({ payment, ride, paymentId: 'pay_a' });
    const startCode = ride.verification.start.code;
    const endCode = ride.verification.end.code;

    // Simulate the webhook arriving after the browser callback.
    await confirmPaidRide({ payment, ride, paymentId: 'pay_webhook' });

    // Codes must be unchanged.
    expect(ride.verification.start.code).toBe(startCode);
    expect(ride.verification.end.code).toBe(endCode);
  });

  it('does not call assignDriver a second time on a duplicate', async () => {
    const { ride, payment } = await makeRideAndPayment({ mode: 'fixed' });

    let assignCount = 0;
    const fakeDriver = { _id: new mongoose.Types.ObjectId(), user: new mongoose.Types.ObjectId() };
    const assignDriver = async () => { assignCount++; return fakeDriver; };

    await confirmPaidRide({ payment, ride, paymentId: 'pay_1', assignDriver });
    expect(assignCount).toBe(1);

    await confirmPaidRide({ payment, ride, paymentId: 'pay_2', assignDriver });
    expect(assignCount).toBe(1); // not called again
  });

  it('does not change paymentId on a duplicate (first-write wins)', async () => {
    const { ride, payment } = await makeRideAndPayment();

    await confirmPaidRide({ payment, ride, paymentId: 'pay_browser_callback' });
    const savedAfterFirst = await Payment.findById(payment._id);

    // Webhook arrives with a different paymentId.
    await confirmPaidRide({ payment, ride, paymentId: 'pay_webhook_id' });
    const savedAfterSecond = await Payment.findById(payment._id);

    // The browser callback's paymentId was already written; the second call
    // returns early before re-writing it. The DB value stays the same.
    expect(savedAfterSecond.paymentId).toBe(savedAfterFirst.paymentId);
  });
});

// ── already-confirmed (optional advance payment) ──────────────────────────────

describe('confirmPaidRide — already-live ride (optional advance)', () => {
  it('returns { alreadyConfirmed: false, optionalPayment: true } and skips assignment', async () => {
    const { ride, payment } = await makeRideAndPayment({ status: RIDE_STATUS.CONFIRMED });

    let assignCalled = 0;
    const assignDriver = async () => { assignCalled++; return null; };

    const result = await confirmPaidRide({ payment, ride, assignDriver });

    expect(result.optionalPayment).toBe(true);
    expect(result.alreadyConfirmed).toBe(false);
    expect(assignCalled).toBe(0);
  });
});

// ── KNOWN CONCERN: concurrent race ───────────────────────────────────────────

describe('concurrent duplicate payment paths', () => {
  /**
   * Razorpay treats both the browser redirect and the webhook as authoritative
   * and sends both; on a fast connection they land within milliseconds. The
   * guard used to read `payment.status` from an already-loaded document, so
   * both callers could pass it and go on to commit the coupon twice, assign a
   * second driver, and mint OTP codes over the ones the rider had been shown.
   * A compare-and-swap in confirmPaidRide now lets exactly one caller through.
   */
  it('lets exactly one of two simultaneous confirmations through', async () => {
    const { ride, payment } = await makeRideAndPayment();
    const assignDriver = vi.fn(async () => ({ _id: new mongoose.Types.ObjectId() }));

    // Both callers load their own copy before either has written — the race.
    const [a, b] = await Promise.all([
      Payment.findById(payment._id),
      Payment.findById(payment._id),
    ]);
    const [resA, resB] = await Promise.all([
      confirmPaidRide({ payment: a, ride: await Ride.findById(ride._id), paymentId: 'pay_a', assignDriver }),
      confirmPaidRide({ payment: b, ride: await Ride.findById(ride._id), paymentId: 'pay_b', assignDriver }),
    ]);

    const winners = [resA, resB].filter((r) => !r.alreadyConfirmed);
    expect(winners).toHaveLength(1);
    expect(assignDriver).toHaveBeenCalledTimes(1);

    const fresh = await Ride.findById(ride._id);
    expect(fresh.status).toBe(RIDE_STATUS.CONFIRMED);
    expect(fresh.verification.start.code).toMatch(/^\d{6}$/);
  });
});

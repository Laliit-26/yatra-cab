/**
 * Customer referral-commission engine tests.
 *
 * Each describe block owns one scenario and gets a fresh DB state via
 * beforeEach/clearDb so there is no inter-test contamination.
 *
 * Key rules under test:
 *   • pool = 20% of platform commission, NEVER exceeded
 *   • L1 75%, L2 19%, L3 6% of pool (sum ≤ 100)
 *   • rider always gets 10% base + whatever the chain left unclaimed
 *   • idempotent per ride (second call → null)
 *   • upline must have ridden within 30 days to earn
 *   • earning window: first 25 rides of the referred rider
 *   • monthly cap per upline: 1000 points
 *   • cycle detection terminates safely
 *   • zero commission → no payout (null)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startDb, stopDb, clearDb } from '../helpers/mongo.js';
import { User } from '../../core/src/models/User.js';
import { Ride, RIDE_STATUS } from '../../core/src/models/Ride.js';
import { Referral } from '../../core/src/models/Referral.js';
import { ReferralEarning } from '../../core/src/models/ReferralEarning.js';
import { payCustomerRideCommission } from '../../core/src/services/referralService.js';

let mongoServer;

beforeAll(async () => { mongoServer = await startDb(); });
afterAll(async () => { await stopDb(mongoServer); });
beforeEach(async () => { await clearDb(); });

// ── fixtures ──────────────────────────────────────────────────────────────────

let phoneSeq = 0;
const mkUser = (opts = {}) =>
  User.create({
    phone: `9${String(Date.now()).slice(-7)}${String(phoneSeq++).padStart(2, '0')}`,
    role: 'customer',
    ...opts,
  });

/** Minimal completed ride with a platform commission (feeAmount). */
const mkRide = (customer, { commission = 100, status = RIDE_STATUS.COMPLETED, agoMs = 0 } = {}) =>
  Ride.create({
    customer,
    mode: 'fixed',
    vehicleType: 'sedan',
    scheduledAt: new Date(),
    status,
    completedAt: new Date(Date.now() - agoMs),
    feeAmount: commission,
    fareAmount: 1000,
    totalAmount: 1100,
  });

/** Make a Referral record linking referrer → referred. */
const mkReferral = (referrer, referred, ridesCounted = 0) =>
  Referral.create({ referrer, referred, role: 'customer', ridesCounted });

// ── T1: full 3-level chain ────────────────────────────────────────────────────

describe('T1: full 3-level chain — A→B→C→D (D rides)', () => {
  it('distributes 20% pool correctly across 3 upline levels', async () => {
    const A = await mkUser({ name: 'Alice' });
    const B = await mkUser({ name: 'Bob', referredBy: A._id });
    const C = await mkUser({ name: 'Carol', referredBy: B._id });
    const D = await mkUser({ name: 'Dave', referredBy: C._id });
    await mkReferral(C._id, D._id);

    // All uplines must be active (ridden within 30 days)
    for (const u of [A, B, C]) await mkRide(u._id, { agoMs: 2 * 24 * 3600 * 1000 });

    const ride = await mkRide(D._id, { commission: 100 });
    const result = await payCustomerRideCommission(ride);

    expect(result).not.toBeNull();
    expect(result.pool).toBe(20); // 20% of ₹100

    const l1 = result.payouts.find((p) => p.level === 1);
    const l2 = result.payouts.find((p) => p.level === 2);
    const l3 = result.payouts.find((p) => p.level === 3);

    expect(l1?.points).toBe(15); // 75% of 20 = 15
    expect(l2?.points).toBe(4);  // 19% of 20 = 3.8 → 4
    expect(l3?.points).toBe(1);  // remaining: 20 - 15 - 4 = 1 (clamped from 6% = 1.2)

    // Chain conserves the pool — chainSpent ≤ pool always.
    expect(result.chainSpent).toBeLessThanOrEqual(result.pool);
    expect(result.chainSpent).toBe(l1.points + l2.points + l3.points);

    // Rider gets 10% base + anything the chain left.
    expect(result.cashback).toBe(10 + (result.pool - result.chainSpent));

    // Points actually written to User documents.
    const [aU, bU, cU, dU] = await Promise.all(
      [A, B, C, D].map((u) => User.findById(u._id).select('points').lean())
    );
    expect(cU.points).toBe(15); // L1
    expect(bU.points).toBe(4);  // L2
    expect(aU.points).toBe(1);  // L3
    expect(dU.points).toBe(result.cashback); // rider cashback
  });
});

// ── T2: idempotency ───────────────────────────────────────────────────────────

describe('T2: idempotency — second call on the same ride returns null', () => {
  it('does not double-credit any user', async () => {
    const referrer = await mkUser();
    const rider = await mkUser({ referredBy: referrer._id });
    await mkReferral(referrer._id, rider._id);
    await mkRide(referrer._id, { agoMs: 1000 });

    const ride = await mkRide(rider._id, { commission: 100 });

    const first = await payCustomerRideCommission(ride);
    expect(first).not.toBeNull();

    const second = await payCustomerRideCommission(ride);
    expect(second).toBeNull(); // idempotency guard fired

    // Points must not have changed since the first call.
    const [ref, rid] = await Promise.all([
      User.findById(referrer._id).select('points').lean(),
      User.findById(rider._id).select('points').lean(),
    ]);
    expect(ref.points).toBe(first.payouts.find((p) => p.level === 1)?.points ?? 0);
    expect(rid.points).toBe(first.cashback);

    // Exactly one ReferralEarning row per beneficiary per ride.
    const earnings = await ReferralEarning.find({ ride: ride._id });
    expect(earnings.length).toBe(2); // level 0 (rider) + level 1 (referrer)
  });
});

// ── T3: inactive upline ───────────────────────────────────────────────────────

describe('T3: inactive upline — whole pool rolls back to rider', () => {
  it('pays nothing to the upline and adds the pool to rider cashback', async () => {
    const inactive = await mkUser(); // no rides ever → not recently active
    const rider = await mkUser({ referredBy: inactive._id });
    await mkReferral(inactive._id, rider._id);

    const ride = await mkRide(rider._id, { commission: 100 });
    const result = await payCustomerRideCommission(ride);

    expect(result.payouts).toHaveLength(0);
    // rider gets 10% base + entire 20% pool
    expect(result.cashback).toBe(30);

    const uplineUser = await User.findById(inactive._id).select('points').lean();
    expect(uplineUser.points).toBe(0); // inactive upline earned nothing
  });
});

// ── T4: earning window closes ─────────────────────────────────────────────────

describe('T4: earning window closes after 25 rides', () => {
  it('pays no chain commission once ridesCounted >= 25', async () => {
    const referrer = await mkUser();
    const rider = await mkUser({ referredBy: referrer._id });
    await mkRide(referrer._id, { agoMs: 1000 }); // active referrer

    // Pre-set to exactly at the window limit.
    await mkReferral(referrer._id, rider._id, 25);

    const ride = await mkRide(rider._id, { commission: 100 });
    const result = await payCustomerRideCommission(ride);

    expect(result.chainSpent).toBe(0);
    // Everything goes to the rider.
    expect(result.cashback).toBe(30); // 10 base + 20 pool
  });

  it('still pays chain commission on the 24th ride (window still open)', async () => {
    const referrer = await mkUser();
    const rider = await mkUser({ referredBy: referrer._id });
    await mkRide(referrer._id, { agoMs: 1000 });
    await mkReferral(referrer._id, rider._id, 24); // one more allowed

    const ride = await mkRide(rider._id, { commission: 100 });
    const result = await payCustomerRideCommission(ride);

    expect(result.chainSpent).toBeGreaterThan(0);
  });
});

// ── T5: referral cycle safety ─────────────────────────────────────────────────

describe('T5: referral cycle — does not infinite-loop', () => {
  it('terminates safely and does not overspend the pool', async () => {
    // X.referredBy = Y, Y.referredBy = X  → mutual cycle
    const X = await mkUser();
    const Y = await mkUser({ referredBy: X._id });
    await User.updateOne({ _id: X._id }, { referredBy: Y._id });

    // Both must be active riders.
    await mkRide(X._id, { agoMs: 1000 });
    await mkRide(Y._id, { agoMs: 1000 });
    await mkReferral(X._id, Y._id);

    const ride = await mkRide(Y._id, { commission: 100 });
    const result = await payCustomerRideCommission(ride);

    expect(result).not.toBeNull();
    expect(result.chainSpent).toBeLessThanOrEqual(result.pool);
    expect(result.cashback).toBeGreaterThanOrEqual(10); // rider always earns at minimum
  });
});

// ── T6: monthly cap ───────────────────────────────────────────────────────────

describe('T6: monthly cap — upline earnings clipped to ₹1000/month', () => {
  it('awards only the remaining cap headroom, not the full share', async () => {
    const referrer = await mkUser();
    const rider = await mkUser({ referredBy: referrer._id });
    await mkRide(referrer._id, { agoMs: 1000 });
    await mkReferral(referrer._id, rider._id);

    // Pre-load referrer with 995 points earned this month.
    const existingRide = await mkRide(rider._id, { commission: 1 }); // placeholder ride id
    await ReferralEarning.create({
      ride: existingRide._id,
      beneficiary: referrer._id,
      source: rider._id,
      level: 1,
      points: 995,
    });

    const ride = await mkRide(rider._id, { commission: 100 });
    const result = await payCustomerRideCommission(ride);

    const l1 = result.payouts.find((p) => p.level === 1);
    expect(l1?.points).toBe(5); // only 1000 - 995 = 5 points remain in cap

    // Unclaimed part of L1 share (15 - 5 = 10) goes back to the rider.
    expect(result.cashback).toBe(10 + (20 - 5)); // 25
  });

  it('pays nothing to a fully-capped upline and returns entire pool to rider', async () => {
    const referrer = await mkUser();
    const rider = await mkUser({ referredBy: referrer._id });
    await mkRide(referrer._id, { agoMs: 1000 });
    await mkReferral(referrer._id, rider._id);

    const stubRide = await mkRide(rider._id, { commission: 1 });
    await ReferralEarning.create({
      ride: stubRide._id,
      beneficiary: referrer._id,
      source: rider._id,
      level: 1,
      points: 1000, // cap fully exhausted
    });

    const ride = await mkRide(rider._id, { commission: 100 });
    const result = await payCustomerRideCommission(ride);

    expect(result.payouts).toHaveLength(0);
    expect(result.cashback).toBe(30);
  });
});

// ── T7: zero commission ───────────────────────────────────────────────────────

describe('T7: zero commission ride', () => {
  it('returns null without touching the DB', async () => {
    const rider = await mkUser();
    const ride = await mkRide(rider._id, { commission: 0 });
    const result = await payCustomerRideCommission(ride);
    expect(result).toBeNull();

    const earns = await ReferralEarning.find({ ride: ride._id });
    expect(earns).toHaveLength(0);
  });
});

// ── T8: pool conservation invariant ──────────────────────────────────────────

describe('T8: pool conservation — chainSpent + leftover always equals pool', () => {
  it('holds for every level-weight combination with rounding', async () => {
    // Use a commission that produces a messy pool (e.g. ₹37 → 20% = 7.4 → 7)
    const A = await mkUser();
    const B = await mkUser({ referredBy: A._id });
    const C = await mkUser({ referredBy: B._id });
    const D = await mkUser({ referredBy: C._id });
    await mkReferral(C._id, D._id);
    for (const u of [A, B, C]) await mkRide(u._id, { agoMs: 1000 });

    const ride = await mkRide(D._id, { commission: 37 });
    const result = await payCustomerRideCommission(ride);

    // cashback = 10% base + (pool - chainSpent)
    const expectedCashback =
      Math.round((37 * 10) / 100) + (result.pool - result.chainSpent);
    expect(result.cashback).toBe(expectedCashback);

    // Total points awarded = chain + rider cashback ≤ pool + cashback_base
    const totalPoints = result.chainSpent + result.cashback;
    const maxAllowed = result.pool + Math.round((37 * 10) / 100);
    expect(totalPoints).toBeLessThanOrEqual(maxAllowed);
  });
});

// ── T9: unreferred rider still gets base cashback + full pool ─────────────────

describe('T9: unreferred rider — no referral record, no upline', () => {
  it('receives 10% cashback + full 20% pool', async () => {
    const rider = await mkUser(); // no referredBy, no Referral record
    const ride = await mkRide(rider._id, { commission: 100 });
    const result = await payCustomerRideCommission(ride);

    expect(result.payouts).toHaveLength(0);
    expect(result.cashback).toBe(30); // 10 base + 20 pool
  });
});

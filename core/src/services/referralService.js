import { User } from '../models/User.js';
import { Driver } from '../models/Driver.js';
import { Referral } from '../models/Referral.js';
import { ReferralEarning } from '../models/ReferralEarning.js';
import { Ride, RIDE_STATUS } from '../models/Ride.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { credit as walletCredit } from './walletService.js';
import { withTransaction } from '../config/db.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(seed = '') {
  const prefix = (seed.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'YTR');
  let rand = '';
  for (let i = 0; i < 4; i += 1) rand += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `${prefix}${rand}`;
}

/** Ensure a user has a unique referral code; returns it. */
export async function ensureReferralCode(user) {
  if (user.referralCode) return user.referralCode;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = randomCode(user.name);
    // eslint-disable-next-line no-await-in-loop
    const exists = await User.exists({ referralCode: code });
    if (!exists) {
      user.referralCode = code;
      // eslint-disable-next-line no-await-in-loop
      await user.save();
      return code;
    }
  }
  return null;
}

/**
 * Apply a referral code when a NEW user signs up.
 * - Customer: both referrer and referred get signup cashback points.
 * - Driver: link referredByDriver so the referrer earns recurring commission.
 */
export async function applyReferral(newUser, code) {
  if (!code || newUser.referredBy) return null;
  const referrer = await User.findOne({ referralCode: code.toUpperCase() });
  if (!referrer || String(referrer._id) === String(newUser._id)) return null;

  newUser.referredBy = referrer._id;
  await newUser.save();

  const referral = await Referral.create({ referrer: referrer._id, referred: newUser._id, role: newUser.role, code: code.toUpperCase() });

  if (newUser.role === 'customer') {
    // Level 1: direct referrer + the new user both earn signup points.
    const pts = env.business.referralSignupPoints;
    await User.updateOne({ _id: referrer._id }, { $inc: { points: pts } });
    await User.updateOne({ _id: newUser._id }, { $inc: { points: pts } });
    referral.rewardPoints = pts;
    await referral.save();
    // Level 2: the person who referred the referrer earns a smaller reward.
    if (referrer.referredBy) {
      const l2 = Math.round(pts * 0.4);
      await User.updateOne({ _id: referrer.referredBy }, { $inc: { points: l2 } });
      logger.info(`[referral] customer L2 +${l2} pts → ${referrer.referredBy}`);
    }
    logger.info(`[referral] customer ${newUser._id} referred by ${referrer._id}: +${pts} pts each`);
  } else if (newUser.role === 'driver') {
    const [refDriver, newDriver] = await Promise.all([
      Driver.findOne({ user: referrer._id }).select('_id'),
      Driver.findOne({ user: newUser._id }).select('_id'),
    ]);
    if (refDriver && newDriver) {
      newDriver.referredByDriver = refDriver._id;
      await newDriver.save();
      logger.info(`[referral] driver ${newDriver._id} linked to referrer driver ${refDriver._id}`);
    }
  }
  return referral;
}

// Multi-level driver referral: each level up the chain earns this % of the
// ride's platform commission (total 30% reserved for the referral pool; the
// rest is the platform's profit). Funded entirely from commission → zero risk.
const REFERRAL_LEVEL_PCT = [15, 8, 4, 3]; // L1, L2, L3, L4

/**
 * Walk up to 4 levels of the driver referral chain when a driver earns, paying
 * each ancestor their share of the platform commission from that ride.
 * @returns {Array<{driver, level, reward}>}
 */
export async function payDriverRecurringCommission(driver, platformCommission, ride) {
  if (!driver || platformCommission <= 0) return [];
  const payouts = [];
  let currentId = driver.referredByDriver;

  for (let level = 0; level < REFERRAL_LEVEL_PCT.length && currentId; level += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ancestor = await Driver.findById(currentId).select('referredByDriver user');
    if (!ancestor) break;
    const reward = Math.round((platformCommission * REFERRAL_LEVEL_PCT[level]) / 100);
    if (reward > 0) {
      // eslint-disable-next-line no-await-in-loop
      await walletCredit(ancestor._id, reward, 'referral_commission', { ride: ride?._id, note: `Level ${level + 1} referral` });
      // eslint-disable-next-line no-await-in-loop
      await Driver.updateOne({ _id: ancestor._id }, { $inc: { referralEarnings: reward } });
      payouts.push({ driver: ancestor._id, level: level + 1, reward });
    }
    currentId = ancestor.referredByDriver;
  }

  if (payouts[0]) {
    await Referral.updateOne({ referred: driver.user }, { $inc: { recurringEarnings: payouts[0].reward, ridesCounted: 1 } });
  }
  if (payouts.length) logger.info(`[referral] chain payout on ride ${ride?._id}: ${payouts.map((p) => `L${p.level}:₹${p.reward}`).join(' ')}`);
  return payouts;
}

/** Redeem customer points as a discount (₹). Caps at the available amount. */
export function pointsToDiscount(points, maxDiscount) {
  const value = Math.floor(points * env.business.pointValue);
  return Math.max(0, Math.min(value, maxDiscount));
}


// ── Customer (rider) multi-level referral commission engine ─────────────────
//
// Every payout is a slice of a FIXED pool (a % of the ride's platform
// commission) — never an independent % of the fare. The cost per ride is
// therefore capped no matter how deep or wide the referral tree grows.
//
// Level weights decay faster than a realistic branching factor (k≈3), i.e.
// each weight is under 1/3 of the one above it, so a level's TOTAL payout
// shrinks as you go deeper. That keeps riding — not recruiting — the way to
// earn, which is the line between a referral programme and a pyramid.
const CUSTOMER_LEVEL_WEIGHTS = [75, 19, 6]; // L1, L2, L3 — % of the chain pool

const monthStart = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** An upline only earns while they are themselves an active rider. */
async function hasRiddenRecently(userId, days) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  return Ride.exists({ customer: userId, status: RIDE_STATUS.COMPLETED, completedAt: { $gte: since } });
}

/** Chain points already earned this calendar month (level 0 cashback is exempt). */
async function chainPointsThisMonth(userId) {
  const [row] = await ReferralEarning.aggregate([
    { $match: { beneficiary: userId, level: { $gt: 0 }, createdAt: { $gte: monthStart() } } },
    { $group: { _id: null, total: { $sum: '$points' } } },
  ]);
  return row?.total || 0;
}

/**
 * Pay the rider's own-ride cashback plus their upline chain when a ride
 * completes. Idempotent per ride.
 *
 * Unclaimed levels (no upline, inactive upline, capped upline, or a closed
 * earning window) roll into the rider's own cashback rather than evaporating —
 * so early users, who have no chain above them, still feel the full pool.
 *
 * @returns {{pool:number, cashback:number, payouts:Array}|null}
 */
export async function payCustomerRideCommission(ride) {
  if (!ride?.customer) return null;

  const commission = ride.commission?.amount || ride.feeAmount || 0;
  if (commission <= 0) return null;

  // Idempotency: a ride is only ever paid out once.
  if (await ReferralEarning.exists({ ride: ride._id })) return null;

  const {
    customerReferralPercent,
    customerCashbackPercent,
    customerReferralWindowRides,
    customerReferralActiveDays,
    customerReferralMonthlyCap,
  } = env.business;

  const pool = Math.round((commission * customerReferralPercent) / 100);
  const payouts = [];
  let chainSpent = 0;

  // The earning window is per RIDER: the chain above them is paid only during
  // their first N completed rides, which caps referral cost per acquired user.
  const riderReferral = await Referral.findOne({ referred: ride.customer, role: 'customer' });
  const windowOpen = !riderReferral || riderReferral.ridesCounted < customerReferralWindowRides;

  if (pool > 0 && windowOpen) {
    const seen = new Set([String(ride.customer)]);
    let currentId = (await User.findById(ride.customer).select('referredBy'))?.referredBy;

    for (let i = 0; i < CUSTOMER_LEVEL_WEIGHTS.length; i += 1) {
      if (!currentId || seen.has(String(currentId))) break; // end of chain, or a cycle
      seen.add(String(currentId));

      // eslint-disable-next-line no-await-in-loop
      const upline = await User.findById(currentId).select('referredBy role isBlocked');
      if (!upline) break;

      // Clamp to what's left: independent rounding of each weight can otherwise
      // overshoot the pool by a rupee or two (e.g. pool 30 → 23+6+2 = 31).
      const share = Math.min(Math.round((pool * CUSTOMER_LEVEL_WEIGHTS[i]) / 100), pool - chainSpent);
      // eslint-disable-next-line no-await-in-loop
      const eligible =
        share > 0 &&
        !upline.isBlocked &&
        upline.role === 'customer' &&
        (await hasRiddenRecently(upline._id, customerReferralActiveDays));

      if (eligible) {
        // eslint-disable-next-line no-await-in-loop
        const earnedThisMonth = await chainPointsThisMonth(upline._id);
        const award = Math.min(share, Math.max(0, customerReferralMonthlyCap - earnedThisMonth));
        if (award > 0) {
          // eslint-disable-next-line no-await-in-loop
          await withTransaction(async (session) => {
            const opts = session ? { session } : {};
            await ReferralEarning.create([{
              ride: ride._id,
              beneficiary: upline._id,
              source: ride.customer,
              level: i + 1,
              points: award,
              commissionBase: commission,
            }], opts);
            await User.updateOne({ _id: upline._id }, { $inc: { points: award } }, opts);
          });
          payouts.push({ user: upline._id, level: i + 1, points: award });
          chainSpent += award;
        }
      }

      currentId = upline.referredBy;
    }
  }

  // Pool conservation: whatever the chain did not take — an absent, inactive,
  // blocked or capped upline, a closed window, or a short chain — returns to
  // the rider. Nothing evaporates, and the pool is never exceeded.
  const cashback = Math.round((commission * customerCashbackPercent) / 100) + (pool - chainSpent);

  if (cashback > 0) {
    await withTransaction(async (session) => {
      const opts = session ? { session } : {};
      await ReferralEarning.create([{
        ride: ride._id,
        beneficiary: ride.customer,
        source: ride.customer,
        level: 0,
        points: cashback,
        commissionBase: commission,
      }], opts);
      await User.updateOne({ _id: ride.customer }, { $inc: { points: cashback } }, opts);
    });
  }

  if (riderReferral) {
    riderReferral.ridesCounted += 1;
    riderReferral.recurringEarnings += chainSpent;
    await riderReferral.save();
  }

  logger.info(
    `[referral] ride ${ride._id} (commission ₹${commission}): rider +${cashback} pts, ` +
      `chain ${payouts.map((p) => `L${p.level}:${p.points}`).join(' ') || 'none'}`
  );
  return { pool, cashback, chainSpent, payouts };
}

import { Coupon } from '../models/Coupon.js';
import { CouponRedemption } from '../models/CouponRedemption.js';
import { ApiError } from '../utils/apiError.js';
import { logger } from '../utils/logger.js';

/** What a coupon is worth on a given ride, capped so it can never exceed the fee. */
export function discountFor(coupon, { fareAmount = 0, feeAmount = 0 }) {
  const raw =
    coupon.type === 'percent'
      ? Math.round((feeAmount * coupon.value) / 100)
      : Math.round(coupon.value);
  const capped = coupon.maxDiscount > 0 ? Math.min(raw, coupon.maxDiscount) : raw;
  // Never discount below zero, and never more than the amount actually payable.
  return Math.max(0, Math.min(capped, feeAmount));
}

/**
 * Check a code without consuming it — used by the "apply coupon" preview so a
 * rider sees the saving before committing to pay.
 */
export async function validateCoupon(code, { user, ride }) {
  const coupon = await Coupon.findOne({ code: String(code || '').toUpperCase().trim() });
  if (!coupon || !coupon.active) throw ApiError.badRequest('That coupon code is not valid');

  const now = new Date();
  if (coupon.validFrom && now < coupon.validFrom) throw ApiError.badRequest('This coupon is not active yet');
  if (coupon.validUntil && now > coupon.validUntil) throw ApiError.badRequest('This coupon has expired');
  if (coupon.usedCount >= coupon.totalCoupons) throw ApiError.badRequest('This coupon is fully claimed');
  if (coupon.minFare && (ride.fareAmount || 0) < coupon.minFare) {
    throw ApiError.badRequest(`Valid on rides over ₹${coupon.minFare}`);
  }

  // Per-user limit ignores this ride's own row, so re-opening checkout on the
  // same booking is not treated as a second use.
  const mine = await CouponRedemption.countDocuments({
    coupon: coupon._id,
    user: user._id,
    ...(ride._id ? { ride: { $ne: ride._id } } : {}),
  });
  if (mine >= coupon.perUserLimit) throw ApiError.badRequest('You have already used this coupon');

  const discount = discountFor(coupon, ride);
  if (discount <= 0) throw ApiError.badRequest('This coupon gives no discount on this ride');
  return { coupon, discount };
}

/**
 * Take one from stock. The conditional update is the whole point: two riders
 * claiming the last coupon at the same moment must not both succeed, and
 * check-then-write would let them.
 */
export async function reserveCoupon(code, { user, ride }) {
  const { coupon, discount } = await validateCoupon(code, { user, ride });

  const claimed = await Coupon.findOneAndUpdate(
    { _id: coupon._id, active: true, $expr: { $lt: ['$usedCount', '$totalCoupons'] } },
    { $inc: { usedCount: 1 } },
    { new: true }
  );
  if (!claimed) throw ApiError.badRequest('This coupon was just fully claimed');

  try {
    await CouponRedemption.findOneAndUpdate(
      { coupon: coupon._id, ride: ride._id },
      { coupon: coupon._id, code: claimed.code, user: user._id, ride: ride._id, discount, status: 'reserved' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    // Never leave stock held by a row that failed to write.
    await Coupon.updateOne({ _id: coupon._id }, { $inc: { usedCount: -1 } });
    throw err;
  }

  return { coupon: claimed, discount };
}

/** Checkout abandoned or payment failed — put the coupon back on the shelf. */
export async function releaseCoupon(rideId) {
  const row = await CouponRedemption.findOneAndDelete({ ride: rideId, status: 'reserved' });
  if (!row) return null;
  await Coupon.updateOne({ _id: row.coupon }, { $inc: { usedCount: -1 } });
  logger.info(`[coupon] released ${row.code} from ride ${rideId}`);
  return row;
}

/** Payment succeeded — the reservation becomes a real redemption. */
export async function commitCoupon(rideId) {
  const row = await CouponRedemption.findOneAndUpdate(
    { ride: rideId, status: 'reserved' },
    { status: 'used' },
    { new: true }
  );
  if (row) logger.info(`[coupon] ${row.code} used on ride ${rideId} (−₹${row.discount})`);
  return row;
}

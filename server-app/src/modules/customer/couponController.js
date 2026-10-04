import { Coupon, Ride, validateCoupon, catchAsync, ok, env } from '@yatracab/core';

// POST /customer/rides/:id/coupon/check  { code }
// Preview only — shows the saving without taking one from stock, so a rider
// can try a code without burning it if they then abandon checkout.
export const checkCoupon = catchAsync(async (req, res) => {
  const ride = await Ride.findOne({ _id: req.params.id, customer: req.user._id });
  if (!ride) return ok(res, { valid: false, message: 'Ride not found' });

  // On a quoted ride the fee is only set at payment, so preview against the
  // fee the rider is about to be charged — otherwise every code reports "no
  // discount", which reads as broken rather than premature.
  const previewRide = ride.feeAmount
    ? ride
    : { ...ride.toObject(), feeAmount: Math.max(1, Math.round((ride.fareAmount || 0) * (env.business.feePercent / 100))) };

  try {
    const { coupon, discount } = await validateCoupon(req.body.code, { user: req.user, ride: previewRide });
    return ok(res, {
      valid: true,
      code: coupon.code,
      description: coupon.description,
      discount,
      payable: Math.max(0, previewRide.feeAmount - discount),
      appliesToFee: previewRide.feeAmount,
    });
  } catch (err) {
    // A bad code is an everyday outcome, not an error worth a red toast.
    return ok(res, { valid: false, message: err.message });
  }
});

// GET /customer/coupons — what this rider could actually use right now.
export const availableCoupons = catchAsync(async (req, res) => {
  const now = new Date();
  const coupons = await Coupon.find({
    active: true,
    $expr: { $lt: ['$usedCount', '$totalCoupons'] },
    $and: [
      { $or: [{ validFrom: { $exists: false } }, { validFrom: null }, { validFrom: { $lte: now } }] },
      { $or: [{ validUntil: { $exists: false } }, { validUntil: null }, { validUntil: { $gte: now } }] },
    ],
  })
    .select('code description type value maxDiscount minFare validUntil')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
  return ok(res, { coupons });
});

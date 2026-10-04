import mongoose from 'mongoose';

// One row per use. Backs the per-user limit, gives ops an audit trail, and the
// unique (coupon, ride) index makes applying a code to a ride idempotent.
const couponRedemptionSchema = new mongoose.Schema(
  {
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
    code: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ride: { type: mongoose.Schema.Types.ObjectId, ref: 'Ride', required: true },
    discount: { type: Number, required: true },
    // 'reserved' while checkout is open; 'used' once paid; released rows are deleted.
    status: { type: String, enum: ['reserved', 'used'], default: 'reserved', index: true },
  },
  { timestamps: true }
);

couponRedemptionSchema.index({ coupon: 1, ride: 1 }, { unique: true });
couponRedemptionSchema.index({ coupon: 1, user: 1 });

export const CouponRedemption =
  mongoose.models.CouponRedemption || mongoose.model('CouponRedemption', couponRedemptionSchema);

import mongoose from 'mongoose';

// A promo code the ops team issues. `totalCoupons` is the stock: how many
// redemptions exist in total, which is what stops a campaign running away.
const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    description: { type: String, trim: true },

    type: { type: String, enum: ['flat', 'percent'], default: 'flat' },
    value: { type: Number, required: true, min: 1 }, // ₹ when flat, % when percent
    maxDiscount: { type: Number, default: 0 }, // caps a percent coupon; 0 = uncapped
    minFare: { type: Number, default: 0 }, // ride fare must reach this to qualify

    totalCoupons: { type: Number, required: true, min: 1 }, // stock
    usedCount: { type: Number, default: 0 },
    perUserLimit: { type: Number, default: 1 },

    validFrom: { type: Date },
    validUntil: { type: Date },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

couponSchema.virtual('remaining').get(function remaining() {
  return Math.max(0, this.totalCoupons - this.usedCount);
});
couponSchema.set('toJSON', { virtuals: true });
couponSchema.set('toObject', { virtuals: true });

export const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema);

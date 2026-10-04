// @yatracab/core — shared backend surface for both server-app and server-admin.

// Config
export { env } from './config/env.js';
export { connectDB, disconnectDB, withTransaction } from './config/db.js';

// Models (importing here also registers them with Mongoose)
export { User } from './models/User.js';
export { Driver } from './models/Driver.js';
export { Route } from './models/Route.js';
export { Ride, RIDE_STATUS } from './models/Ride.js';
export { Bid } from './models/Bid.js';
export { Payment } from './models/Payment.js';
export { Rating } from './models/Rating.js';
export { Otp } from './models/Otp.js';
export { WalletTransaction } from './models/WalletTransaction.js';
export { DriverRoute } from './models/DriverRoute.js';
export { Referral } from './models/Referral.js';
export { ReferralEarning } from './models/ReferralEarning.js';
export { Coupon } from './models/Coupon.js';
export { CouponRedemption } from './models/CouponRedemption.js';
export { LocationShare } from './models/LocationShare.js';
export { Contact, normalizePhone } from './models/Contact.js';
export { SosAlert } from './models/SosAlert.js';

// Middleware
export { requireAuth, optionalAuth } from './middleware/auth.js';
export { allow } from './middleware/role.js';
export { validate } from './middleware/validate.js';
export { notFound, errorHandler } from './middleware/error.js';
export { applySecurity, otpRateLimiter, otpAbuseLimiter } from './middleware/security.js';
export { requestId } from './middleware/requestId.js';

// Utils
export { ApiError } from './utils/apiError.js';
export { catchAsync } from './utils/catchAsync.js';
export { logger } from './utils/logger.js';
export { ok, created, paginate, pageMeta } from './utils/response.js';
export {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  refreshCookieOptions,
} from './utils/tokens.js';

// Services
export {
  computeFee,
  priceBreakdown,
  fixedFareForRoute,
  computeRefund,
  haversineKm,
  estimateFareByDistance,
  estimatedMinutes,
  quoteByDistance,
  computeCommission,
  seatShareFare,
  FARE_RATES,
} from './services/pricingService.js';
export { getWallet, credit, debit, topup } from './services/walletService.js';
export {
  ensureReferralCode,
  applyReferral,
  payDriverRecurringCommission,
  payCustomerRideCommission,
  pointsToDiscount,
} from './services/referralService.js';
export {
  validateCoupon,
  reserveCoupon,
  releaseCoupon,
  commitCoupon,
  discountFor,
} from './services/couponService.js';
export { fetchArrivalDelay } from './services/delayService.js';
export { seedDatabase, isDatabaseEmpty, needsSeeding } from './seedData.js';
export { requestOtp, verifyOtp } from './services/otpService.js';
export {
  createOrder,
  verifyPayment,
  verifyWebhookSignature,
  refund,
  paymentPublicConfig,
} from './services/paymentService.js';
export { connectCall } from './services/maskingService.js';
export { notify, notifyMany } from './services/notificationService.js';
export { sendMail } from './services/mailer.js';

import { Router } from 'express';
import { requireAuth, allow, validate } from '@yatracab/core';
import {
  fixedBookingSchema,
  rideAlertSchema,
  quoteSchema,
  seatBookSchema,
  sosSchema,
  shareSchema,
  redeemSchema,
  couponCheckSchema,
  paymentVerifySchema,
  cancelSchema,
  rateSchema,
  profileSchema,
  contactsSchema,
} from './customerValidation.js';
import {
  getQuote,
  bookFixed,
  postAlert,
  listMyRides,
  getRide,
  getRideBids,
  acceptBid,
  createPaymentOrder,
  verifyRidePayment,
  cancelRide,
  rateRide,
  callDriver,
  updateProfile,
} from './customerController.js';
import { browseDailyRoutes, bookDailyRoute } from './discoverController.js';
import { nearbyDrivers } from './liveController.js';
import { checkCoupon, availableCoupons } from './couponController.js';
import { raiseSos, createShare } from './safetyController.js';
import { myReferral, myReferralEarnings } from './referralController.js';
import { listContacts, saveContacts, deleteContact, purgeContacts } from './contactsController.js';

const router = Router();

// All customer routes require an authenticated customer.
router.use(requireAuth, allow('customer'));

router.post('/rides/quote', validate(quoteSchema), getQuote);
router.post('/rides/fixed', validate(fixedBookingSchema), bookFixed);
router.post('/rides/alert', validate(rideAlertSchema), postAlert);
router.get('/rides', listMyRides);
router.get('/rides/:id', getRide);
router.get('/rides/:id/bids', getRideBids);
router.post('/rides/:id/accept-bid/:bidId', acceptBid);
router.get('/coupons', availableCoupons);
router.post('/rides/:id/coupon/check', validate(couponCheckSchema), checkCoupon);
router.post('/rides/:id/payment/order', validate(redeemSchema), createPaymentOrder);
router.post('/rides/:id/payment/verify', validate(paymentVerifySchema), verifyRidePayment);
router.patch('/rides/:id/cancel', validate(cancelSchema), cancelRide);
router.post('/rides/:id/rate', validate(rateSchema), rateRide);
router.post('/rides/:id/call', callDriver);
router.patch('/profile', validate(profileSchema), updateProfile);

// Daily-route discovery + seat/full-cab booking (GPS priority sorted)
router.get('/drivers/nearby', nearbyDrivers);
router.get('/daily-routes', browseDailyRoutes);
router.post('/daily-routes/:id/book', validate(seatBookSchema), bookDailyRoute);

// Safety
router.post('/safety/sos', validate(sosSchema), raiseSos);
router.post('/safety/share', validate(shareSchema), createShare);

// Referral
router.get('/referral', myReferral);
router.get('/referral/earnings', myReferralEarnings);

// Invite contacts (user-selected only)
router.get('/contacts', listContacts);
router.post('/contacts', validate(contactsSchema), saveContacts);
router.delete('/contacts/:id', deleteContact);
router.delete('/contacts', purgeContacts);

export default router;

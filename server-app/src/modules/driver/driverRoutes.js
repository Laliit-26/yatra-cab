import { Router } from 'express';
import { requireAuth, allow, validate } from '@yatracab/core';
import {
  driverProfileSchema,
  documentSchema,
  statusSchema,
  locationSchema,
  bidSchema,
  rateSchema,
  topupSchema,
  dailyRouteSchema,
} from './driverValidation.js';
import {
  getProfile,
  updateProfile,
  submitDocument,
  submitForVerification,
  setStatus,
  updateLocation,
  listAlerts,
  placeBid,
  listMyBids,
  listMyRides,
  sendRideOtp,
  startRide,
  completeRide,
  rateCustomer,
  callCustomer,
  getEarnings,
} from './driverController.js';
import { getWallet, topupWallet, settleCommission } from './walletController.js';
import { listMine as listDailyRoutes, create as createDailyRoute, update as updateDailyRoute, remove as removeDailyRoute } from './dailyRouteController.js';
import { myReferrals } from './referralController.js';

const router = Router();

router.use(requireAuth, allow('driver'));

router.get('/profile', getProfile);
router.patch('/profile', validate(driverProfileSchema), updateProfile);
router.post('/documents', validate(documentSchema), submitDocument);
router.post('/submit-verification', submitForVerification);
router.patch('/status', validate(statusSchema), setStatus);
router.patch('/location', validate(locationSchema), updateLocation);

router.get('/alerts', listAlerts);
router.post('/rides/:id/bid', validate(bidSchema), placeBid);
router.get('/bids', listMyBids);

router.get('/rides', listMyRides);
router.post('/rides/:id/otp/:phase/send', sendRideOtp);
router.patch('/rides/:id/start', startRide);
router.patch('/rides/:id/complete', completeRide);
router.post('/rides/:id/rate', validate(rateSchema), rateCustomer);
router.post('/rides/:id/call', callCustomer);

router.get('/earnings', getEarnings);

// Pay-to-Connect wallet
router.get('/wallet', getWallet);
router.post('/wallet/topup', validate(topupSchema), topupWallet);
router.post('/rides/:id/settle-commission', settleCommission);

// Daily routine routes (driver offers)
router.get('/daily-routes', listDailyRoutes);
router.post('/daily-routes', validate(dailyRouteSchema), createDailyRoute);
router.patch('/daily-routes/:id', validate(dailyRouteSchema.fork(Object.keys(dailyRouteSchema.describe().keys), (s) => s.optional())), updateDailyRoute);
router.delete('/daily-routes/:id', removeDailyRoute);

// Referrals
router.get('/referrals', myReferrals);

export default router;


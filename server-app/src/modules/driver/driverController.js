import {
  Driver,
  Route,
  Ride,
  Bid,
  Rating,
  RIDE_STATUS,
  connectCall,
  notify,
  payDriverRecurringCommission,
  payCustomerRideCommission,
  catchAsync,
  env,
  ApiError,
  ok,
  created,
  paginate,
  pageMeta,
} from '@yatracab/core';
import { emitToRide, emitToUser } from '../../realtime.js';
import { applyRatingToCustomer } from '../shared/rideHelpers.js';

// Load the Driver doc for the authenticated user.
async function myDriver(req) {
  const driver = await Driver.findOne({ user: req.user._id });
  if (!driver) throw ApiError.notFound('Driver profile not found');
  return driver;
}

function ensureApproved(driver) {
  if (driver.verificationStatus !== 'approved') {
    throw ApiError.forbidden('Your account is pending verification. An admin must approve you first.');
  }
}

// GET /driver/profile
export const getProfile = catchAsync(async (req, res) => {
  const driver = await myDriver(req);
  await driver.populate('servesRoutes', 'origin destination templeName floorPrice fairRange');
  return ok(res, { driver });
});

// PATCH /driver/profile  (onboarding: vehicle, routes, home stand)
export const updateProfile = catchAsync(async (req, res) => {
  const driver = await myDriver(req);
  const { homeStand, servesRoutes, vehicle, name, email, gender } = req.body;
  if (homeStand !== undefined) driver.homeStand = homeStand;
  if (servesRoutes !== undefined) driver.servesRoutes = servesRoutes;
  if (vehicle) driver.vehicle = { ...driver.vehicle.toObject(), ...vehicle };
  await driver.save();

  if (name !== undefined) req.user.name = name;
  if (email !== undefined) req.user.email = email;
  if (gender !== undefined) req.user.gender = gender;
  if (name !== undefined || email !== undefined || gender !== undefined) await req.user.save();

  return ok(res, { driver });
});

// POST /driver/documents  (add/replace a KYC document)
export const submitDocument = catchAsync(async (req, res) => {
  const driver = await myDriver(req);
  const { type } = req.body;
  const existing = driver.documents.find((d) => d.type === type);
  if (existing) {
    Object.assign(existing, { ...req.body, status: 'pending', rejectionReason: undefined });
  } else {
    driver.documents.push({ ...req.body, status: 'pending' });
  }
  await driver.save();
  return created(res, { driver });
});

// POST /driver/submit-verification  (move to the admin queue)
export const submitForVerification = catchAsync(async (req, res) => {
  const driver = await myDriver(req);
  const required = ['driving_licence', 'vehicle_rc', 'aadhaar', 'permit', 'insurance'];
  const have = new Set(driver.documents.map((d) => d.type));
  const missing = required.filter((r) => !have.has(r));
  if (missing.length) throw ApiError.badRequest(`Missing documents: ${missing.join(', ')}`);

  driver.verificationStatus = 'pending';
  driver.rejectionReason = undefined;
  await driver.save();
  return ok(res, { driver, message: 'Submitted for verification' });
});

// PATCH /driver/status  (go online/offline)
export const setStatus = catchAsync(async (req, res) => {
  const driver = await myDriver(req);
  if (req.body.isOnline) ensureApproved(driver);
  driver.isOnline = req.body.isOnline;
  await driver.save();
  return ok(res, { isOnline: driver.isOnline });
});

// PATCH /driver/location
export const updateLocation = catchAsync(async (req, res) => {
  const driver = await myDriver(req);
  const { lat, lng, rideId } = req.body;
  driver.currentLocation = { type: 'Point', coordinates: [lng, lat] };
  await driver.save();
  if (rideId) {
    await Ride.updateOne({ _id: rideId, driver: driver._id }, { driverLocation: { lat, lng, updatedAt: new Date() } });
    emitToRide(rideId, 'ride:driver_location', { rideId, lat, lng, at: Date.now() });
  }
  return ok(res, { ok: true });
});

// GET /driver/alerts  (open Ride Alerts this driver can bid on)
// A driver already on a trip must not be shown or allowed to take new work —
// they can't serve it, and bidding mid-ride is how riders get stranded.
async function activeRideFor(driverId) {
  return Ride.findOne({
    driver: driverId,
    status: { $in: [RIDE_STATUS.CONFIRMED, RIDE_STATUS.ONGOING] },
  })
    .select('_id status pickup drop scheduledAt')
    .lean();
}

export const listAlerts = catchAsync(async (req, res) => {
  const driver = await myDriver(req);
  ensureApproved(driver);

  // On a trip? Return nothing, and tell the app why so it can show a banner.
  const onTrip = await activeRideFor(driver._id);
  if (onTrip) return ok(res, { alerts: [], blocked: true, activeRide: onTrip });

  const myActiveBids = await Bid.find({ driver: driver._id, status: 'active' }).distinct('ride');
  const routeFilter = driver.servesRoutes?.length
    ? { $or: [{ route: { $in: driver.servesRoutes } }, { route: { $exists: false } }] }
    : {};

  const alerts = await Ride.find({
    mode: 'bidding',
    status: RIDE_STATUS.SEARCHING,
    // No vehicle-type gate: a Ride Alert goes to every available driver, and
    // the rider chooses from the bids by vehicle and price.
    biddingClosesAt: { $gt: new Date() },
    _id: { $nin: myActiveBids },
    ...routeFilter,
  })
    .select('-verification')
    .sort({ scheduledAt: 1 })
    .populate('route', 'origin destination templeName floorPrice fairRange')
    .lean();

  return ok(res, { alerts });
});

// POST /driver/rides/:id/bid
export const placeBid = catchAsync(async (req, res) => {
  const driver = await myDriver(req);
  ensureApproved(driver);

  const onTrip = await activeRideFor(driver._id);
  if (onTrip) throw ApiError.badRequest('Finish your current ride before bidding on a new one');

  const ride = await Ride.findById(req.params.id).populate('route', 'floorPrice destination');
  if (!ride || ride.mode !== 'bidding') throw ApiError.notFound('Ride Alert not found');
  if (ride.status !== RIDE_STATUS.SEARCHING) throw ApiError.badRequest('Bidding is closed for this ride');
  if (ride.biddingClosesAt && ride.biddingClosesAt < new Date()) throw ApiError.badRequest('The bidding window has closed');
  // Only enforce a vehicle match when the rider actually asked for one. An
  // open alert ('any') takes bids from every class — the rider picks the cab
  // they want from the quotes.
  if (ride.vehicleType !== 'any' && ride.vehicleType !== driver.vehicle.type) {
    throw ApiError.badRequest('This ride requests a different vehicle type');
  }

  const floor = ride.route?.floorPrice || 0;
  if (req.body.amount < floor) throw ApiError.badRequest(`Bid must be at least the floor price ₹${floor}`);

  let bid;
  try {
    bid = await Bid.create({ ride: ride._id, driver: driver._id, amount: req.body.amount, note: req.body.note });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('You have already bid on this ride');
    throw err;
  }

  // Live-push the blind bid to the customer viewing this ride.
  emitToRide(String(ride._id), 'ride:bid_new', {
    rideId: String(ride._id),
    bid: {
      id: bid._id,
      amount: bid.amount,
      note: bid.note,
      driver: { name: req.user.name || 'YatraCab Driver', rating: driver.rating, completedRides: driver.completedRides, vehicle: driver.vehicle },
    },
  });
  emitToUser(String(ride.customer), 'ride:bid_new', { rideId: String(ride._id) });
  notify(ride.customer, { title: 'New quote received', body: `A driver quoted ₹${bid.amount} for your trip.` });

  return created(res, { bid });
});

// GET /driver/bids
export const listMyBids = catchAsync(async (req, res) => {
  const driver = await myDriver(req);
  const bids = await Bid.find({ driver: driver._id })
    .sort({ createdAt: -1 })
    .populate({ path: 'ride', select: 'destination scheduledAt status vehicleType mode' })
    .lean();
  return ok(res, { bids });
});

// GET /driver/rides  (assignments)
export const listMyRides = catchAsync(async (req, res) => {
  const driver = await myDriver(req);
  const { page, limit, skip } = paginate(req.query);
  const filter = { driver: driver._id };
  if (req.query.status) filter.status = req.query.status;

  const [rides, total] = await Promise.all([
    Ride.find(filter)
      .select('-verification') // the rider's OTP codes must never reach the driver
      .sort({ scheduledAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate('route', 'origin destination templeName')
      .populate({ path: 'customer', select: 'name rating' })
      .lean(),
    Ride.countDocuments(filter),
  ]);
  return ok(res, { rides, meta: pageMeta(page, limit, total) });
});

// POST /driver/rides/:id/otp/:phase/send
//
// The driver asks for the checkpoint code; the rider receives it and reads it
// back. Codes are normally minted when payment confirms, but a ride confirmed
// off a bid never goes through that path, so mint on first send instead of
// leaving the checkpoint silently disabled.
const OTP_RESEND_MS = 60 * 1000;
const sixDigits = () => String(Math.floor(100000 + Math.random() * 900000));

export const sendRideOtp = catchAsync(async (req, res) => {
  const phase = req.params.phase;
  if (!['start', 'end'].includes(phase)) throw ApiError.badRequest('Unknown verification step');

  const driver = await myDriver(req);
  const ride = await Ride.findOne({ _id: req.params.id, driver: driver._id });
  if (!ride) throw ApiError.notFound('Ride not found');

  const allowed = phase === 'start' ? [RIDE_STATUS.CONFIRMED] : [RIDE_STATUS.ONGOING, RIDE_STATUS.CONFIRMED];
  if (!allowed.includes(ride.status)) throw ApiError.badRequest('This ride is not at that step');

  ride.verification = ride.verification || {};
  const slot = ride.verification[phase] || (ride.verification[phase] = {});

  // Enforced here, not just in the UI: a countdown in the driver's app stops
  // nobody who can call the endpoint directly, and every send pings the rider.
  const since = slot.sentAt ? Date.now() - new Date(slot.sentAt).getTime() : Infinity;
  if (since < OTP_RESEND_MS) {
    const retryAfter = Math.ceil((OTP_RESEND_MS - since) / 1000);
    throw ApiError.tooMany(`Please wait ${retryAfter}s before asking again`, { retryAfter });
  }

  if (!slot.code) slot.code = sixDigits();
  slot.sentAt = new Date();
  ride.markModified('verification');
  await ride.save();

  const label = phase === 'start' ? 'start' : 'drop-off';
  await notify(ride.customer, {
    title: `Your ${label} code`,
    body: `Share ${slot.code} with your driver to ${phase === 'start' ? 'begin' : 'close'} this trip.`,
    data: { rideId: String(ride._id), phase },
  });
  emitToUser(String(ride.customer), 'ride:otp', { rideId: String(ride._id), phase, code: slot.code });

  // Same bargain otpService strikes for login: with no SMS transport wired up,
  // dev and demo builds hand the code back so the flow is testable end to end.
  const expose = env.otp.demoMode || !env.isProd;
  return ok(res, {
    sentAt: slot.sentAt,
    retryAfter: Math.ceil(OTP_RESEND_MS / 1000),
    ...(expose ? { devCode: slot.code } : {}),
  });
});

// PATCH /driver/rides/:id/start
export const startRide = catchAsync(async (req, res) => {
  const driver = await myDriver(req);
  const ride = await Ride.findOne({ _id: req.params.id, driver: driver._id });
  if (!ride) throw ApiError.notFound('Ride not found');
  if (ride.status !== RIDE_STATUS.CONFIRMED) throw ApiError.badRequest('Only a confirmed ride can be started');

  // Checkpoint 2 — the rider reads their start code to the driver. Proves the
  // right rider is in the right cab before the trip begins.
  const startCode = ride.verification?.start?.code;
  if (startCode && String(req.body?.otp || '') !== startCode) {
    throw ApiError.badRequest('Ask the rider for their 6-digit start code');
  }
  if (ride.verification?.start) ride.verification.start.verifiedAt = new Date();

  ride.status = RIDE_STATUS.ONGOING;
  ride.startedAt = new Date();
  await ride.save();
  emitToRide(String(ride._id), 'ride:updated', { rideId: String(ride._id), status: ride.status });
  emitToUser(String(ride.customer), 'ride:started', { rideId: String(ride._id) });
  return ok(res, { ride });
});

// PATCH /driver/rides/:id/complete
export const completeRide = catchAsync(async (req, res) => {
  const driver = await myDriver(req);
  const ride = await Ride.findOne({ _id: req.params.id, driver: driver._id });
  if (!ride) throw ApiError.notFound('Ride not found');
  if (![RIDE_STATUS.ONGOING, RIDE_STATUS.CONFIRMED].includes(ride.status)) {
    throw ApiError.badRequest('Ride is not in progress');
  }

  // Checkpoint 3 — the rider only shares this code once the fare matches what
  // was agreed. Without it the ride cannot be closed, so demanding extra cash
  // gets the driver nowhere.
  const endCode = ride.verification?.end?.code;
  if (endCode && String(req.body?.otp || '') !== endCode) {
    throw ApiError.badRequest('Ask the rider for their 6-digit drop-off code to close this ride');
  }
  if (ride.verification?.end) ride.verification.end.verifiedAt = new Date();

  ride.status = RIDE_STATUS.COMPLETED;
  ride.completedAt = new Date();
  await ride.save();

  driver.completedRides += 1;
  driver.loyaltyPoints += 10; // reward app-completed rides
  driver.totalEarnings += ride.fareAmount;
  await driver.save();

  // Driver-to-driver recurring commission (funded by the platform's share).
  const platformCommission = ride.commission?.amount || ride.feeAmount || 0;
  await payDriverRecurringCommission(driver, platformCommission, ride);
  // Rider cashback + rider-to-rider referral chain (same commission pool).
  await payCustomerRideCommission(ride);

  emitToRide(String(ride._id), 'ride:updated', { rideId: String(ride._id), status: ride.status });
  notify(ride.customer, { title: 'Ride completed', body: 'Thanks for travelling with YatraCab. Please rate your driver.' });
  return ok(res, { ride });
});

// POST /driver/rides/:id/rate  (driver rates customer)
export const rateCustomer = catchAsync(async (req, res) => {
  const driver = await myDriver(req);
  const ride = await Ride.findOne({ _id: req.params.id, driver: driver._id });
  if (!ride) throw ApiError.notFound('Ride not found');
  if (ride.status !== RIDE_STATUS.COMPLETED) throw ApiError.badRequest('You can only rate a completed ride');
  if (ride.ratedByDriver) throw ApiError.conflict('You already rated this ride');

  const rating = await Rating.create({
    ride: ride._id,
    direction: 'driver_to_customer',
    from: req.user._id,
    toUser: ride.customer,
    stars: req.body.stars,
    comment: req.body.comment,
  });
  await applyRatingToCustomer(ride.customer, req.body.stars);
  ride.ratedByDriver = true;
  await ride.save();
  return created(res, { rating });
});

// POST /driver/rides/:id/call  (masked call to customer)
export const callCustomer = catchAsync(async (req, res) => {
  const driver = await myDriver(req);
  const ride = await Ride.findOne({ _id: req.params.id, driver: driver._id });
  if (!ride) throw ApiError.notFound('Ride not found');
  if (![RIDE_STATUS.CONFIRMED, RIDE_STATUS.ONGOING].includes(ride.status)) {
    throw ApiError.badRequest('Calling is enabled only for active rides');
  }
  const result = await connectCall({ fromUserId: req.user._id, toUserId: ride.customer });
  return ok(res, result);
});

// GET /driver/earnings
export const getEarnings = catchAsync(async (req, res) => {
  const driver = await myDriver(req);
  const completed = await Ride.find({ driver: driver._id, status: RIDE_STATUS.COMPLETED })
    .select('fareAmount completedAt destination')
    .sort({ completedAt: -1 })
    .lean();

  const totalCash = completed.reduce((sum, r) => sum + (r.fareAmount || 0), 0);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thisWeek = completed
    .filter((r) => r.completedAt && new Date(r.completedAt) >= weekAgo)
    .reduce((sum, r) => sum + (r.fareAmount || 0), 0);

  return ok(res, {
    earnings: {
      totalCash,
      thisWeek,
      completedRides: driver.completedRides,
      loyaltyPoints: driver.loyaltyPoints,
      rating: driver.rating,
      ratingCount: driver.ratingCount,
      recent: completed.slice(0, 10),
    },
  });
});

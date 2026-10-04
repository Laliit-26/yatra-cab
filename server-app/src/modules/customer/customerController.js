import {
  Route,
  Ride,
  Bid,
  Payment,
  Driver,
  Rating,
  DriverRoute,
  RIDE_STATUS,
  env,
  fixedFareForRoute,
  priceBreakdown,
  quoteByDistance,
  computeCommission,
  seatShareFare,
  debit as walletDebit,
  fetchArrivalDelay,
  pointsToDiscount,
  reserveCoupon,
  releaseCoupon,
  commitCoupon,
  computeRefund,
  createOrder,
  verifyPayment as gatewayVerify,
  refund as gatewayRefund,
  connectCall,
  notify,
  notifyMany,
  catchAsync,
  ApiError,
  ok,
  created,
  paginate,
  pageMeta,
} from '@yatracab/core';
import { emitToRoute, emitToRide, emitToUser, emitToDrivers } from '../../realtime.js';
import { confirmPaidRide } from './paymentConfirm.js';
import {
  assignDriverForFixedRide,
  applyRatingToDriver,
  shapeBidForCustomer,
} from '../shared/rideHelpers.js';

// Six-digit code for the three ride verification checkpoints.
const otp6 = () => String(Math.floor(100000 + Math.random() * 900000));

const ownRide = async (rideId, customerId) => {
  const ride = await Ride.findOne({ _id: rideId, customer: customerId });
  if (!ride) throw ApiError.notFound('Ride not found');
  return ride;
};

const VEHICLES = ['hatchback', 'sedan', 'suv', 'tempo'];

// Resolve fare + trip metrics for a booking — from a popular Route (fixed
// matrix) or from dynamic pickup→drop distance. Amounts are ALWAYS computed
// server-side, never trusted from the client.
async function resolveTrip({ routeId, pickup, drop, vehicleType, tripType }) {
  if (routeId) {
    const route = await Route.findById(routeId);
    if (!route || !route.isActive) throw ApiError.notFound('Route unavailable');
    const money = fixedFareForRoute(route, vehicleType);
    return {
      route: route._id,
      money,
      destination: route.destination,
      distanceKm: route.distanceKm,
      estimatedMins: route.estimatedMins,
      dropLocation: drop || undefined,
      supportsFixed: route.supportsFixed,
      supportsBidding: route.supportsBidding,
      fairRange: route.fairRange,
      floorPrice: route.floorPrice,
    };
  }
  if (!drop) throw ApiError.badRequest('Choose a drop location');
  if (pickup?.lat == null || pickup?.lng == null) throw ApiError.badRequest('Pickup coordinates required — pick a place or use your location');
  const q = quoteByDistance({ pickup, drop, vehicleType, tripType });
  return {
    route: undefined,
    money: { fareAmount: q.fareAmount, feeAmount: q.feeAmount, totalAmount: q.totalAmount, feePercent: q.feePercent },
    destination: drop.address,
    distanceKm: q.distanceKm,
    estimatedMins: q.estimatedMins,
    dropLocation: drop,
    supportsFixed: true,
    supportsBidding: true,
    floorPrice: Math.round(q.fareAmount * 0.85),
  };
}

// If the trip is tied to a train/flight, fetch its (mock) delay and shift the
// scheduled pickup so the driver arrives when the passenger actually lands.
async function resolveTransport(transport, scheduledAt) {
  if (!transport || transport.type === 'none' || !transport.number) {
    return { transport: { type: 'none' }, scheduledAt };
  }
  const { delayMins } = await fetchArrivalDelay({ type: transport.type, number: transport.number });
  const base = transport.scheduledAt ? new Date(transport.scheduledAt) : new Date(scheduledAt);
  return { transport: { ...transport, delayMins }, scheduledAt: new Date(base.getTime() + delayMins * 60000) };
}

// Driver Route Matching: find drivers whose daily route starts near the pickup
// and notify them of a fresh alert (in addition to the broadcast).
async function notifyMatchingDailyDrivers(pickup, ride) {
  if (pickup?.lat == null || pickup?.lng == null) return 0;
  const matches = await DriverRoute.find({
    active: true,
    originPoint: {
      $near: {
        $geometry: { type: 'Point', coordinates: [pickup.lng, pickup.lat] },
        $maxDistance: 15000, // 15 km
      },
    },
  })
    .limit(20)
    .populate('driver', 'user')
    .lean();

  const userIds = [...new Set(matches.map((m) => m.driver?.user).filter(Boolean).map(String))];
  userIds.forEach((uid) =>
    emitToUser(uid, 'ride:route_match', { rideId: String(ride._id), destination: ride.destination, pickup: pickup.address })
  );
  if (userIds.length) notifyMany(userIds, { title: 'Ride near your daily route', body: `A rider needs a trip near your route to ${ride.destination}.` });
  return userIds.length;
}

// POST /customer/rides/quote — live fare estimate per vehicle (no booking).
export const getQuote = catchAsync(async (req, res) => {
  const { routeId, pickup, drop, tripType } = req.body;
  const fares = {};
  let meta = {};
  if (routeId) {
    const route = await Route.findById(routeId);
    if (!route || !route.isActive) throw ApiError.notFound('Route unavailable');
    VEHICLES.forEach((v) => { fares[v] = fixedFareForRoute(route, v); });
    meta = { distanceKm: route.distanceKm, estimatedMins: route.estimatedMins, feePercent: route.feePercent, mode: 'route', destination: route.destination, origin: route.origin, supportsBidding: route.supportsBidding };
  } else {
    if (!drop || pickup?.lat == null || pickup?.lng == null) throw ApiError.badRequest('Pickup and drop coordinates required');
    let q;
    VEHICLES.forEach((v) => { q = quoteByDistance({ pickup, drop, vehicleType: v, tripType }); fares[v] = { fareAmount: q.fareAmount, feeAmount: q.feeAmount, totalAmount: q.totalAmount, feePercent: q.feePercent }; });
    meta = { distanceKm: q.distanceKm, estimatedMins: q.estimatedMins, feePercent: q.feePercent, mode: 'distance', destination: drop.address, supportsBidding: true };
  }
  return ok(res, { quote: { ...meta, fares } });
});

// POST /customer/rides/fixed
export const bookFixed = catchAsync(async (req, res) => {
  const { routeId, drop, vehicleType, tripType, scheduledAt, passengers, notes, pickup, bookingType, seats, womenOnly, transport } = req.body;
  const trip = await resolveTrip({ routeId, pickup, drop, vehicleType, tripType });
  if (routeId && !trip.supportsFixed) throw ApiError.badRequest('This route is bidding-only');

  const t = await resolveTransport(transport, scheduledAt);
  const isShare = bookingType === 'seat_share';
  const perSeatFare = isShare ? Math.round(trip.money.fareAmount / Math.max(1, seats)) : 0;

  const ride = await Ride.create({
    customer: req.user._id,
    route: trip.route,
    mode: 'fixed',
    bookingType: bookingType || 'full_cab',
    seatsTotal: isShare ? seats : 1,
    seatsBooked: isShare ? seats : 0,
    perSeatFare,
    womenOnly: !!womenOnly,
    vehicleType,
    tripType,
    transport: t.transport,
    scheduledAt: t.scheduledAt,
    passengers,
    notes,
    pickup,
    dropLocation: trip.dropLocation,
    destination: trip.destination,
    distanceKm: trip.distanceKm,
    estimatedMins: trip.estimatedMins,
    ...trip.money,
    status: RIDE_STATUS.PENDING_PAYMENT,
  });

  return created(res, { ride, breakdown: trip.money });
});

// POST /customer/rides/alert  (opens reverse bidding)
export const postAlert = catchAsync(async (req, res) => {
  const { routeId, drop, vehicleType, tripType, scheduledAt, passengers, notes, biddingWindowMins, pickup, bookingType, seats, womenOnly, transport } = req.body;
  const t = await resolveTransport(transport, scheduledAt);

  let route = null;
  let dropLabel;
  let dropLocation;
  let distanceKm = 0;
  let estimatedMins = 0;
  let floorPrice;
  let fairRange;

  if (routeId) {
    route = await Route.findById(routeId);
    if (!route || !route.isActive) throw ApiError.notFound('Route unavailable');
    if (!route.supportsBidding) throw ApiError.badRequest('This route is fixed-fare only');
    dropLabel = route.destination;
    distanceKm = route.distanceKm;
    estimatedMins = route.estimatedMins;
    floorPrice = route.floorPrice;
    fairRange = route.fairRange;
  } else {
    if (!drop) throw ApiError.badRequest('Choose a drop location');
    if (pickup?.lat == null || pickup?.lng == null) throw ApiError.badRequest('Pickup coordinates required');
    // With no vehicle preference, price the floor off a sedan as the reference
    // class — bids above and below it are what set the real market.
    const q = quoteByDistance({ pickup, drop, vehicleType: vehicleType || 'sedan', tripType });
    dropLabel = drop.address;
    dropLocation = drop;
    distanceKm = q.distanceKm;
    estimatedMins = q.estimatedMins;
    floorPrice = Math.round(q.fareAmount * 0.85);
    fairRange = { min: Math.round(q.fareAmount * 0.9), max: Math.round(q.fareAmount * 1.25) };
  }

  const biddingClosesAt = new Date(Date.now() + biddingWindowMins * 60 * 1000);
  const isShare = bookingType === 'seat_share';
  const ride = await Ride.create({
    customer: req.user._id,
    route: route?._id,
    mode: 'bidding',
    bookingType: bookingType || 'full_cab',
    seatsTotal: isShare ? seats : 1,
    womenOnly: !!womenOnly,
    vehicleType: vehicleType || 'any',
    tripType,
    transport: t.transport,
    scheduledAt: t.scheduledAt,
    passengers,
    notes,
    pickup,
    dropLocation,
    destination: dropLabel,
    distanceKm,
    estimatedMins,
    feePercent: route?.feePercent || undefined,
    status: RIDE_STATUS.SEARCHING,
    biddingClosesAt,
  });

  // Push to drivers: a route room for popular routes, plus the global drivers
  // room so custom point-to-point alerts reach online drivers too.
  const payload = {
    rideId: String(ride._id),
    destination: dropLabel,
    pickup: pickup?.address,
    vehicleType: vehicleType || 'any',
    distanceKm,
    scheduledAt,
    floorPrice,
    fairRange,
    biddingClosesAt,
  };
  if (route) emitToRoute(String(route._id), 'ride:new_alert', payload);
  emitToDrivers('ride:new_alert', payload);
  // Driver Route Matching — ping drivers whose daily route passes near the pickup.
  const matched = await notifyMatchingDailyDrivers(pickup, ride);

  return created(res, { ride, fairRange, floorPrice, matchedDrivers: matched });
});

// GET /customer/rides
export const listMyRides = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = { customer: req.user._id };
  if (req.query.status) filter.status = req.query.status;

  const [rides, total] = await Promise.all([
    Ride.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('route', 'origin destination templeName')
      .populate({ path: 'driver', select: 'vehicle rating user', populate: { path: 'user', select: 'name' } })
      .lean(),
    Ride.countDocuments(filter),
  ]);

  return ok(res, { rides, meta: pageMeta(page, limit, total) });
});

// GET /customer/rides/:id
export const getRide = catchAsync(async (req, res) => {
  const ride = await Ride.findOne({ _id: req.params.id, customer: req.user._id })
    .populate('route')
    .populate({ path: 'driver', select: 'vehicle rating completedRides user currentLocation', populate: { path: 'user', select: 'name phone' } })
    .populate('payment');
  if (!ride) throw ApiError.notFound('Ride not found');
  return ok(res, { ride });
});

// GET /customer/rides/:id/bids
export const getRideBids = catchAsync(async (req, res) => {
  const ride = await ownRide(req.params.id, req.user._id);
  const [bids, route] = await Promise.all([
    Bid.find({ ride: ride._id, status: { $in: ['active', 'accepted'] } })
      .populate({ path: 'driver', select: 'vehicle rating completedRides user', populate: { path: 'user', select: 'name' } })
      .sort({ amount: 1 })
      .lean(),
    ride.route ? Route.findById(ride.route).select('floorPrice fairRange').lean() : null,
  ]);
  return ok(res, {
    bids: bids.map(shapeBidForCustomer),
    floorPrice: route?.floorPrice,
    fairRange: route?.fairRange,
    biddingClosesAt: ride.biddingClosesAt,
    status: ride.status,
  });
});

// POST /customer/rides/:id/accept-bid/:bidId
export const acceptBid = catchAsync(async (req, res) => {
  const ride = await ownRide(req.params.id, req.user._id);
  if (ride.mode !== 'bidding') throw ApiError.badRequest('Not a bidding ride');
  if (ride.status !== RIDE_STATUS.SEARCHING) throw ApiError.badRequest('Bidding already closed for this ride');
  if (ride.biddingClosesAt && ride.biddingClosesAt < new Date()) {
    throw ApiError.badRequest('The bidding window has closed');
  }

  const bid = await Bid.findOne({ _id: req.params.bidId, ride: ride._id, status: 'active' });
  if (!bid) throw ApiError.notFound('Bid not available');

  // Pay-to-Connect: the platform earns a commission from the DRIVER's wallet;
  // the rider pays the agreed fare directly to the driver (cash/UPI). Amounts
  // are computed server-side from the accepted bid — never trusted.
  const commission = computeCommission(bid.amount, env.business.commissionPercent);
  ride.fareAmount = bid.amount;
  ride.feeAmount = 0;
  ride.totalAmount = bid.amount;
  ride.acceptedBid = bid._id;
  ride.driver = bid.driver;
  // The rider chose this driver's cab, so the ride now carries that vehicle.
  const winner = await Driver.findById(bid.driver).select('vehicle');
  if (winner?.vehicle?.type) ride.vehicleType = winner.vehicle.type;
  ride.commission = { percent: commission.percent, amount: commission.amount, status: 'pending' };

  // Charge the driver's wallet now; success unlocks the contact + OTP.
  const debitRes = await walletDebit(bid.driver, commission.amount, 'commission', { ride: ride._id, note: 'Pay-to-Connect commission' });
  if (debitRes.ok) {
    ride.commission.status = 'charged';
    ride.contactUnlocked = true;
    ride.connectOtp = String(Math.floor(1000 + Math.random() * 9000));
  }
  ride.status = RIDE_STATUS.CONFIRMED;
  // Checkpoints 2 and 3 — issued now, held by the rider only.
  ride.verification = ride.verification || {};
  if (ride.verification.payment) ride.verification.payment.verifiedAt = new Date();
  ride.verification.start = { code: otp6() };
  ride.verification.end = { code: otp6() };
  await ride.save();

  bid.status = 'accepted';
  await bid.save();
  await Bid.updateMany({ ride: ride._id, _id: { $ne: bid._id } }, { status: 'rejected' });

  const driver = await Driver.findById(bid.driver).select('user');
  if (driver) {
    emitToUser(String(driver.user), 'ride:bid_accepted', { rideId: String(ride._id) });
    notify(
      driver.user,
      debitRes.ok
        ? { title: 'Bid accepted 🎉', body: `₹${commission.amount} commission charged. Contact the rider now.` }
        : { title: 'Bid accepted — action needed', body: `Add ₹${debitRes.shortBy} to your wallet to unlock the rider's contact.` }
    );
  }
  emitToRide(String(ride._id), 'ride:updated', { rideId: String(ride._id), status: ride.status });

  return ok(res, { ride, commission: ride.commission, contactUnlocked: ride.contactUnlocked });
});

// POST /customer/rides/:id/payment/order  (optionally redeem cashback points)
export const createPaymentOrder = catchAsync(async (req, res) => {
  const ride = await ownRide(req.params.id, req.user._id);

  // TESTING AFFORDANCE — remove once the payment model is decided.
  // Quoted rides confirm without any online payment (the driver's wallet pays
  // the commission), so nothing in the UI reaches the gateway. Allowing an
  // OPTIONAL advance on a confirmed ride makes the Razorpay flow reachable for
  // testing without changing how bookings actually work.
  const optionalAdvance = ride.status === RIDE_STATUS.CONFIRMED;
  if (ride.status !== RIDE_STATUS.PENDING_PAYMENT && !optionalAdvance) {
    throw ApiError.badRequest('Ride is not awaiting payment');
  }
  if (!ride.feeAmount && optionalAdvance) {
    // Derive a nominal advance from the agreed fare so there is something to charge.
    ride.feeAmount = Math.max(1, Math.round((ride.fareAmount || 0) * (env.business.feePercent / 100)));
    await ride.save();
  }
  if (!ride.feeAmount) throw ApiError.badRequest('Fee not set for this ride');

  // Any coupon held from an earlier attempt at this checkout goes back on the
  // shelf first, so re-opening payment never quietly burns a second one.
  await releaseCoupon(ride._id);

  let discount = 0;
  let couponCode = null;

  // A coupon comes off the fee first, then points cover what is left. Riders
  // read a coupon as "the offer", so it should be the part that clearly applies.
  if (req.body.couponCode) {
    const claim = await reserveCoupon(req.body.couponCode, { user: req.user, ride });
    discount += claim.discount;
    couponCode = claim.coupon.code;
    ride.coupon = { code: claim.coupon.code, discount: claim.discount };
  }

  if (req.body.usePoints && req.user.points > 0) {
    const remainingFee = Math.max(0, ride.feeAmount - discount);
    const fromPoints = pointsToDiscount(req.user.points, remainingFee);
    if (fromPoints > 0) {
      req.user.points = Math.max(0, req.user.points - fromPoints); // 1 point = ₹1
      await req.user.save();
      ride.pointsRedeemed = fromPoints;
      discount += fromPoints;
    }
  }

  ride.discount = discount;
  const payable = Math.max(0, ride.feeAmount - discount);

  const order = await createOrder({ amount: payable, receipt: `ride_${ride._id}` });

  const payment = await Payment.findOneAndUpdate(
    { ride: ride._id },
    {
      ride: ride._id,
      customer: req.user._id,
      amount: payable,
      provider: order.provider,
      orderId: order.id,
      status: 'created',
    },
    { upsert: true, new: true }
  );
  ride.payment = payment._id;
  // Checkpoint 1 — the rider confirms the amount before money moves.
  ride.verification = ride.verification || {};
  ride.verification.payment = { code: otp6() };
  await ride.save();

  return ok(res, {
    order,
    feeAmount: payable,
    discount,
    pointsRedeemed: ride.pointsRedeemed,
    couponCode,
    // Dev convenience: the code is delivered out-of-band in production.
    devPaymentOtp: env.nodeEnv === 'production' ? undefined : ride.verification.payment.code,
  });
});

// POST /customer/rides/:id/payment/verify
export const verifyRidePayment = catchAsync(async (req, res) => {
  const { orderId, paymentId, signature, otp } = req.body;
  const ride = await ownRide(req.params.id, req.user._id);
  const payment = await Payment.findOne({ ride: ride._id, orderId });
  if (!payment) throw ApiError.notFound('Payment order not found');

  const expected = ride.verification?.payment?.code;
  if (expected && String(otp || '') !== expected) {
    throw ApiError.badRequest('Incorrect payment verification code');
  }

  const valid = await gatewayVerify({ orderId, paymentId, signature });
  if (!valid) {
    payment.status = 'failed';
    await releaseCoupon(ride._id); // a declined card must not consume the coupon
    await payment.save();
    throw ApiError.badRequest('Payment verification failed');
  }

  // Same path the webhook takes, so a ride confirmed by either route ends up
  // in exactly the same state — and whichever arrives second is a no-op.
  await confirmPaidRide({
    payment,
    ride,
    paymentId,
    signature,
    assignDriver: assignDriverForFixedRide,
  });

  const populated = await Ride.findById(ride._id).populate({
    path: 'driver',
    select: 'vehicle rating user',
    populate: { path: 'user', select: 'name phone' },
  });
  return ok(res, { ride: populated, message: 'Payment verified — booking confirmed' });
});

// PATCH /customer/rides/:id/cancel
export const cancelRide = catchAsync(async (req, res) => {
  const ride = await ownRide(req.params.id, req.user._id);
  const cancellable = [RIDE_STATUS.PENDING_PAYMENT, RIDE_STATUS.SEARCHING, RIDE_STATUS.CONFIRMED];
  if (!cancellable.includes(ride.status)) throw ApiError.badRequest(`Cannot cancel a ${ride.status} ride`);

  const payment = await Payment.findOne({ ride: ride._id, status: 'paid' });
  let refundInfo = { refundAmount: 0, reasonLabel: 'No online payment to refund' };

  if (payment) {
    refundInfo = computeRefund({
      feeAmount: payment.amount,
      scheduledAt: ride.scheduledAt,
      by: 'customer',
    });
    if (refundInfo.refundAmount > 0) {
      const r = await gatewayRefund({ paymentId: payment.paymentId, amount: refundInfo.refundAmount, reason: 'customer_cancel' });
      payment.status = 'refunded';
      payment.refund = { amount: refundInfo.refundAmount, id: r.id, reason: 'customer_cancel', at: new Date() };
      await payment.save();
    }
  }

  await releaseCoupon(ride._id); // cancelled bookings return the coupon to stock
  ride.status = RIDE_STATUS.CANCELLED;
  ride.cancellation = { by: 'customer', reason: req.body.reason, at: new Date(), refundAmount: refundInfo.refundAmount };
  await ride.save();
  await Bid.updateMany({ ride: ride._id, status: 'active' }, { status: 'expired' });

  if (ride.driver) {
    const driver = await Driver.findById(ride.driver).select('user');
    if (driver) emitToUser(String(driver.user), 'ride:cancelled', { rideId: String(ride._id) });
  }

  return ok(res, { ride, refund: refundInfo });
});

// POST /customer/rides/:id/rate
export const rateRide = catchAsync(async (req, res) => {
  const ride = await ownRide(req.params.id, req.user._id);
  if (ride.status !== RIDE_STATUS.COMPLETED) throw ApiError.badRequest('You can only rate a completed ride');
  if (ride.ratedByCustomer) throw ApiError.conflict('You already rated this ride');
  if (!ride.driver) throw ApiError.badRequest('No driver to rate');

  const driver = await Driver.findById(ride.driver);
  const rating = await Rating.create({
    ride: ride._id,
    direction: 'customer_to_driver',
    from: req.user._id,
    toDriver: driver._id,
    toUser: driver.user,
    stars: req.body.stars,
    comment: req.body.comment,
  });
  await applyRatingToDriver(driver._id, req.body.stars);
  ride.ratedByCustomer = true;
  await ride.save();

  return created(res, { rating });
});

// POST /customer/rides/:id/call  (masked call to driver)
export const callDriver = catchAsync(async (req, res) => {
  const ride = await ownRide(req.params.id, req.user._id);
  if (!ride.driver) throw ApiError.badRequest('No driver assigned yet');
  if (![RIDE_STATUS.CONFIRMED, RIDE_STATUS.ONGOING].includes(ride.status)) {
    throw ApiError.badRequest('Calling is enabled only after confirmation');
  }
  // Pay-to-Connect gate: contact stays locked until the driver settles commission.
  if (ride.mode === 'bidding' && ride.commission?.status === 'pending') {
    throw ApiError.badRequest('Waiting for the driver to confirm — contact unlocks shortly.');
  }
  const driver = await Driver.findById(ride.driver).select('user');
  const result = await connectCall({ fromUserId: req.user._id, toUserId: driver.user });
  return ok(res, result);
});

// PATCH /customer/profile
export const updateProfile = catchAsync(async (req, res) => {
  const { name, email, gender, vibes, emergencyContact, savedRoutes } = req.body;
  const user = req.user;
  if (name !== undefined) user.name = name;
  if (email !== undefined) user.email = email;
  if (gender !== undefined) user.gender = gender;
  if (vibes !== undefined) user.vibes = vibes;
  if (emergencyContact !== undefined) user.emergencyContact = emergencyContact;
  if (savedRoutes !== undefined) user.savedRoutes = savedRoutes;
  await user.save();
  return ok(res, { user: user.toSafeJSON() });
});

import {
  DriverRoute,
  Ride,
  Driver,
  RIDE_STATUS,
  env,
  computeCommission,
  seatShareFare,
  debit as walletDebit,
  notify,
  catchAsync,
  ApiError,
  ok,
  created,
} from '@yatracab/core';
import { emitToUser } from '../../realtime.js';

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const haversineKm = (aLat, aLng, bLat, bLng) => {
  if ([aLat, aLng, bLat, bLng].some((n) => typeof n !== 'number' || Number.isNaN(n))) return null;
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
};

/**
 * Minutes until a daily route's next departure. A route at 08:00 seen at 18:00
 * is tomorrow's, so it should rank behind one leaving in two hours — comparing
 * raw clock times would put it first.
 */
const minutesUntilDeparture = (hhmm = '', now = new Date()) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return Number.MAX_SAFE_INTEGER;
  const dep = new Date(now);
  dep.setHours(h, m, 0, 0);
  if (dep <= now) dep.setDate(dep.getDate() + 1);
  return Math.round((dep - now) / 60000);
};

const dayRange = (when) => {
  const start = new Date(when);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

/** Seats already booked on a daily route for a given departure day. */
async function seatsTakenOn(routeId, when) {
  const { start, end } = dayRange(when);
  const [row] = await Ride.aggregate([
    {
      $match: {
        dailyRoute: routeId,
        scheduledAt: { $gte: start, $lt: end },
        status: { $ne: RIDE_STATUS.CANCELLED }, // a cancelled booking frees its seats
      },
    },
    { $group: { _id: null, seats: { $sum: '$seatsBooked' } } },
  ]);
  return row?.seats || 0;
}

// GET /customer/daily-routes?lat=&lng=&type=&womenOnly=
// Driver's pre-set daily routine routes, nearest first (GPS priority sorting).
export const browseDailyRoutes = catchAsync(async (req, res) => {
  const { lat, lng, toLat, toLng, type, womenOnly, from, to, radiusKm } = req.query;
  const filter = { active: true };
  if (type) filter.bookingType = type;
  if (womenOnly === 'true') filter.womenOnly = true;

  // A shared ride is the driver's own route, so match at city level: whatever
  // the rider types, we want routes that pass near it rather than an exact hit.
  if (from?.trim()) filter['origin.address'] = new RegExp(escapeRegex(from.trim()), 'i');
  if (to?.trim()) filter['destination.address'] = new RegExp(escapeRegex(to.trim()), 'i');

  const hasPickup = lat && lng;
  const radius = Math.round((Number(radiusKm) || 60) * 1000);

  // $near imposes its own distance ordering, so use it only as a radius filter
  // — the real ranking happens below and needs more than one factor.
  if (hasPickup) {
    filter.originPoint = {
      $near: { $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] }, $maxDistance: radius },
    };
  }

  const routes = await (hasPickup ? DriverRoute.find(filter) : DriverRoute.find(filter).sort({ createdAt: -1 }))
    .limit(60)
    .populate({ path: 'driver', select: 'vehicle rating completedRides user', populate: { path: 'user', select: 'name' } })
    .lean();

  const today = new Date();
  const booked = await Promise.all(
    routes.map((r) => (r.bookingType === 'seat_share' ? seatsTakenOn(r._id, today) : 0))
  );

  const enriched = routes.map((r, i) => {
    const pickupKm = hasPickup ? haversineKm(Number(lat), Number(lng), r.origin?.lat, r.origin?.lng) : null;
    const dropKm =
      toLat && toLng ? haversineKm(Number(toLat), Number(toLng), r.destination?.lat, r.destination?.lng) : null;
    return {
      ...r,
      seatsBooked: booked[i],
      seatsLeft: Math.max(0, (r.seatsTotal || 0) - booked[i]),
      distanceFromYouKm: pickupKm,
      distanceToDropKm: dropKm,
      departsInMins: minutesUntilDeparture(r.departureTime, today),
    };
  });

  // Ranking, in the order that matters to a rider looking for a seat:
  //   1. goes near where they're going  2. starts near them  3. leaves soonest
  // Distances are banded so a few hundred metres doesn't outrank a much
  // earlier departure.
  const band = (km, size) => (km == null ? 0 : Math.floor(km / size));
  enriched.sort(
    (a, b) =>
      band(a.distanceToDropKm, 25) - band(b.distanceToDropKm, 25) ||
      band(a.distanceFromYouKm, 5) - band(b.distanceFromYouKm, 5) ||
      a.departsInMins - b.departsInMins
  );

  return ok(res, {
    routes: enriched,
    searched: Boolean(from || to || hasPickup),
  });
});

// POST /customer/daily-routes/:id/book  { seats, scheduledAt }
export const bookDailyRoute = catchAsync(async (req, res) => {
  const route = await DriverRoute.findById(req.params.id).populate('driver');
  if (!route || !route.active) throw ApiError.notFound('This route is no longer available');
  const driver = route.driver;
  if (!driver || driver.verificationStatus !== 'approved') throw ApiError.badRequest('Driver unavailable');

  // Women-only safety filter.
  if (route.womenOnly && req.user.gender !== 'female') {
    throw ApiError.forbidden('This is a women-only ride');
  }

  const isShare = route.bookingType === 'seat_share';
  const seats = isShare ? Math.min(req.body.seats || 1, route.seatsTotal) : 1;

  // Capacity is per departure day: without this a 3-seat car could be booked
  // by any number of riders, each passing the per-booking cap.
  if (isShare) {
    const taken = await seatsTakenOn(route._id, req.body.scheduledAt);
    const free = Math.max(0, route.seatsTotal - taken);
    if (free <= 0) throw ApiError.badRequest('This ride is fully booked for that day');
    if (seats > free) throw ApiError.badRequest(`Only ${free} seat${free === 1 ? '' : 's'} left on this ride`);
  }
  const fareAmount = isShare ? seatShareFare(route.perSeatFare, seats) : route.fullCabFare;
  if (!fareAmount) throw ApiError.badRequest('This route has no fare set');

  const commission = computeCommission(fareAmount, env.business.commissionPercent);

  const ride = await Ride.create({
    customer: req.user._id,
    driver: driver._id,
    mode: 'fixed',
    dailyRoute: route._id,
    bookingType: route.bookingType,
    seatsTotal: route.seatsTotal,
    seatsBooked: isShare ? seats : 0,
    perSeatFare: route.perSeatFare,
    womenOnly: route.womenOnly,
    vehicleType: route.vehicleType,
    tripType: 'one_way',
    pickup: route.origin,
    dropLocation: route.destination,
    destination: route.destination?.address,
    distanceKm: route.distanceKm,
    scheduledAt: req.body.scheduledAt,
    passengers: seats,
    fareAmount,
    feeAmount: 0,
    totalAmount: fareAmount,
    commission: { percent: commission.percent, amount: commission.amount, status: 'pending' },
    status: RIDE_STATUS.CONFIRMED,
  });

  // Pay-to-Connect: charge the driver's wallet; success unlocks contact.
  const debitRes = await walletDebit(driver._id, commission.amount, 'commission', { ride: ride._id, note: 'Daily-route booking commission' });
  if (debitRes.ok) {
    ride.commission.status = 'charged';
    ride.contactUnlocked = true;
    ride.connectOtp = String(Math.floor(1000 + Math.random() * 9000));
    await ride.save();
  }

  emitToUser(String(driver.user._id || driver.user), 'ride:assigned', { rideId: String(ride._id) });
  notify(driver.user._id || driver.user, {
    title: 'New booking on your daily route',
    body: debitRes.ok ? `₹${commission.amount} commission charged. Contact the rider.` : `Add ₹${debitRes.shortBy} to your wallet to connect.`,
  });

  return created(res, { ride });
});

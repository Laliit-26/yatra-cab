import {
  Driver,
  User,
  Ride,
  RIDE_STATUS,
  notify,
  catchAsync,
  ApiError,
  ok,
  paginate,
  pageMeta,
} from '@yatracab/core';

// GET /admin/drivers?status=&q=
export const listDrivers = catchAsync(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};
  if (req.query.status) filter.verificationStatus = req.query.status;
  if (req.query.online === 'true') filter.isOnline = true;

  let query = Driver.find(filter);
  const [drivers, total] = await Promise.all([
    query
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'name phone email rating isBlocked')
      .populate('servesRoutes', 'destination')
      .lean(),
    Driver.countDocuments(filter),
  ]);

  // Optional free-text filter on the populated user name/phone.
  const q = (req.query.q || '').toLowerCase();
  const filtered = q
    ? drivers.filter((d) => `${d.user?.name || ''} ${d.user?.phone || ''}`.toLowerCase().includes(q))
    : drivers;

  return ok(res, { drivers: filtered, meta: pageMeta(page, limit, total) });
});

// GET /admin/drivers/:id
export const getDriver = catchAsync(async (req, res) => {
  const driver = await Driver.findById(req.params.id)
    .populate('user', 'name phone email rating ratingCount isBlocked createdAt')
    .populate('servesRoutes', 'origin destination');
  if (!driver) throw ApiError.notFound('Driver not found');
  const rides = await Ride.find({ driver: driver._id }).sort({ createdAt: -1 }).limit(10).select('destination status fareAmount scheduledAt').lean();
  return ok(res, { driver, recentRides: rides });
});

// PATCH /admin/drivers/:id/approve
export const approveDriver = catchAsync(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) throw ApiError.notFound('Driver not found');
  driver.verificationStatus = 'approved';
  driver.approvedAt = new Date();
  driver.rejectionReason = undefined;
  driver.documents.forEach((d) => {
    d.status = 'approved';
  });
  await driver.save();
  notify(driver.user, { title: 'You are verified!', body: 'Your YatraCab driver account is approved. You can go online now.' });
  return ok(res, { driver });
});

// PATCH /admin/drivers/:id/reject { reason }
export const rejectDriver = catchAsync(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) throw ApiError.notFound('Driver not found');
  driver.verificationStatus = 'rejected';
  driver.rejectionReason = req.body.reason || 'Verification failed';
  driver.isOnline = false;
  await driver.save();
  notify(driver.user, { title: 'Verification update', body: driver.rejectionReason });
  return ok(res, { driver });
});

// PATCH /admin/drivers/:id/documents/:type { status, rejectionReason }
export const reviewDocument = catchAsync(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) throw ApiError.notFound('Driver not found');
  const doc = driver.documents.find((d) => d.type === req.params.type);
  if (!doc) throw ApiError.notFound('Document not found');
  doc.status = req.body.status;
  if (req.body.status === 'rejected') doc.rejectionReason = req.body.rejectionReason;
  await driver.save();
  return ok(res, { driver });
});

// PATCH /admin/drivers/:id/block { blocked }
export const setDriverBlocked = catchAsync(async (req, res) => {
  const driver = await Driver.findById(req.params.id).populate('user');
  if (!driver) throw ApiError.notFound('Driver not found');
  driver.user.isBlocked = !!req.body.blocked;
  if (req.body.blocked) driver.isOnline = false;
  await driver.user.save();
  await driver.save();
  return ok(res, { driver });
});

// POST /admin/drivers/:id/penalty { amount, reason, rideId }
export const addPenalty = catchAsync(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) throw ApiError.notFound('Driver not found');
  driver.penalties.push({ amount: req.body.amount, reason: req.body.reason, ride: req.body.rideId });
  await driver.save();
  notify(driver.user, { title: 'Penalty applied', body: `${req.body.reason} — ₹${req.body.amount}` });
  return ok(res, { driver });
});

// GET /admin/drivers/live — snapshot of everyone on the road right now.
// The socket stream ("driver:moved") keeps the map moving between polls; this
// is what the dashboard loads on open, and its fallback if the socket drops.
const LIVE_FRESH_MS = 2 * 60 * 1000;

export const liveDrivers = catchAsync(async (req, res) => {
  const since = new Date(Date.now() - LIVE_FRESH_MS);
  const drivers = await Driver.find({
    isOnline: true,
    lastLocationAt: { $gte: since },
  })
    .select('vehicle currentLocation heading speedKph rating completedRides lastLocationAt user verificationStatus')
    .populate('user', 'name phone')
    .limit(500)
    .lean();

  // Which of them are mid-trip, so ops can tell a busy car from a free one.
  const onTrip = await Ride.find({
    driver: { $in: drivers.map((d) => d._id) },
    status: { $in: [RIDE_STATUS.CONFIRMED, RIDE_STATUS.ONGOING] },
  })
    .select('driver status destination')
    .lean();
  const byDriver = new Map(onTrip.map((r) => [String(r.driver), r]));

  return ok(res, {
    drivers: drivers.map((d) => {
      const ride = byDriver.get(String(d._id));
      return {
        id: String(d._id),
        name: d.user?.name || 'Driver',
        phone: d.user?.phone,
        vehicleType: d.vehicle?.type || 'sedan',
        plate: d.vehicle?.plateNumber,
        rating: d.rating,
        lat: d.currentLocation?.coordinates?.[1],
        lng: d.currentLocation?.coordinates?.[0],
        heading: d.heading ?? null,
        speedKph: d.speedKph ?? null,
        lastLocationAt: d.lastLocationAt,
        status: ride ? ride.status : 'idle',
        headingTo: ride?.destination || null,
      };
    }),
    at: new Date(),
  });
});

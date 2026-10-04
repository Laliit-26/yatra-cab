import { Driver, catchAsync, ok } from '@yatracab/core';

// How long a fix stays trustworthy. A driver flagged online whose last ping is
// older than this is not actually visible on the road, so we drop them rather
// than draw a car that is not there.
const FRESH_MS = 2 * 60 * 1000;

// GET /customer/drivers/nearby?lat=&lng=&radiusKm=
// Ambient "cars around me" for the home map. This is polled rather than pushed:
// a rider does not need every driver's every move, and fanning the whole fleet
// out to every open app would be a lot of traffic for a decorative layer. The
// ride they are actually on is pushed over the socket instead.
export const nearbyDrivers = catchAsync(async (req, res) => {
  const { lat, lng, radiusKm } = req.query;
  if (!lat || !lng) return ok(res, { drivers: [], center: null });

  const since = new Date(Date.now() - FRESH_MS);
  const drivers = await Driver.find({
    isOnline: true,
    verificationStatus: 'approved',
    lastLocationAt: { $gte: since },
    currentLocation: {
      $near: {
        $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
        $maxDistance: Math.round((Number(radiusKm) || 8) * 1000),
      },
    },
  })
    .select('vehicle currentLocation heading rating lastLocationAt')
    .limit(40)
    .lean();

  // Coordinates only — no driver identity until a rider actually books one.
  return ok(res, {
    drivers: drivers.map((d) => ({
      id: String(d._id),
      lat: d.currentLocation?.coordinates?.[1],
      lng: d.currentLocation?.coordinates?.[0],
      heading: d.heading ?? null,
      vehicleType: d.vehicle?.type || 'sedan',
    })),
    center: { lat: Number(lat), lng: Number(lng) },
  });
});

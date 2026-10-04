import { Ride, RIDE_STATUS, logger } from '@yatracab/core';
import { emitToRide } from '../realtime.js';

/**
 * Close any ride that has been sitting in `searching` past its `biddingClosesAt`
 * deadline. Without this, expired alerts stay open forever — the status is only
 * checked on read, never enforced by a background process.
 *
 * Run on a short interval (e.g. 60 s) so the window closure is near-real-time.
 * For multi-instance deployments this should be moved to a distributed lock
 * (e.g. Redlock on Redis) so only one instance runs it at a time.
 */
export async function expireBiddingWindows() {
  const now = new Date();
  const expired = await Ride.find({
    status: RIDE_STATUS.SEARCHING,
    biddingClosesAt: { $lt: now },
  }).select('_id customer').lean();

  if (!expired.length) return;

  const ids = expired.map((r) => r._id);
  await Ride.updateMany(
    { _id: { $in: ids } },
    { $set: { status: RIDE_STATUS.CANCELLED, cancellationReason: 'No driver accepted before the bidding window closed' } }
  );

  for (const ride of expired) {
    emitToRide(String(ride._id), 'ride:bidding_expired', { rideId: ride._id });
  }

  logger.info(`[cron] expired ${expired.length} bidding window(s): ${ids.join(', ')}`);
}

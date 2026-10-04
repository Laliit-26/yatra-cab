import { Server } from 'socket.io';
import { verifyAccessToken, User, Driver, logger } from '@yatracab/core';
import { setIo, rooms, emitToRide, emitToAdmins } from '../realtime.js';
import { appConfig } from '../config/loadEnv.js';

/**
 * Socket.io server sharing the HTTP server. Connections are JWT-authenticated
 * in the handshake. Rooms scope events:
 *   - user:<id>     personal channel (assignments, refunds)
 *   - ride:<id>     live bids + driver location for one ride
 *   - route:<id>    drivers subscribed to a route receive new Ride Alerts
 *   - admins        ops dashboard — every driver ping
 *
 * Location design: the socket is the fast path (push to the people watching a
 * specific ride, and to ops), while the database holds the last known fix so a
 * late joiner, a page refresh or a reconnect still sees the car. Writes are
 * throttled per driver — a 2s GPS stream would otherwise be 1,800 writes an
 * hour per driver for data nobody reads at that resolution.
 */
const DB_WRITE_EVERY_MS = 10000;
// SCALING NOTE: `lastWriteAt` is in-process memory. On multiple instances each
// process keeps its own map, so the per-driver throttle fires once per instance
// rather than once globally. The consequence is a higher DB write rate, not
// data loss. To fix: replace this Map with a Redis hash (HSET/HGET) via
// ioredis, then also install @socket.io/redis-adapter so room broadcasts work
// across instances (a `ride:join` on instance A must reach a driver on instance B).
const lastWriteAt = new Map(); // driverId → epoch ms of last persisted fix
export function initSockets(server) {
  // SCALING NOTE: Socket.io defaults to the in-process adapter — events emitted
  // on one instance are not broadcast to sockets connected to other instances.
  // For horizontal scaling install @socket.io/redis-adapter and pass it here:
  //   io.adapter(createAdapter(pubClient, subClient));
  const io = new Server(server, {
    cors: { origin: appConfig.clientUrls, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Auth token required'));
      const claims = verifyAccessToken(token);
      const user = await User.findById(claims.sub).select('_id role isBlocked');
      if (!user || user.isBlocked) return next(new Error('Unauthorized'));
      socket.user = { id: String(user._id), role: user.role };
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const { id, role } = socket.user;
    socket.join(rooms.user(id));
    logger.info(`[socket] ${role} ${id} connected (${socket.id})`);

    // Drivers join the global drivers room (custom Ride Alerts) + their route rooms.
    let driverId = null;
    if (role === 'driver') {
      socket.join(rooms.drivers());
      const driver = await Driver.findOne({ user: id }).select('servesRoutes');
      driverId = driver ? String(driver._id) : null;
      driver?.servesRoutes?.forEach((r) => socket.join(rooms.route(String(r))));
    }

    if (role === 'admin') socket.join(rooms.admins());

    // A customer/driver opens a specific ride view.
    socket.on('ride:join', (rideId) => rideId && socket.join(rooms.ride(rideId)));
    socket.on('ride:leave', (rideId) => rideId && socket.leave(rooms.ride(rideId)));

    // Driver streams GPS while online. rideId is optional: a driver cruising
    // for work still reports position so riders and ops can see them.
    socket.on('driver:location', async ({ rideId, lat, lng, heading, speedKph } = {}) => {
      if (role !== 'driver') return;
      const la = Number(lat);
      const ln = Number(lng);
      if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return;

      const at = Date.now();
      const payload = { driverId, rideId: rideId || null, lat: la, lng: ln, heading, speedKph, at };

      // Push first — the people watching care about latency, not durability.
      if (rideId) emitToRide(rideId, 'ride:driver_location', payload);
      emitToAdmins('driver:moved', payload);

      // Then persist, throttled, so the position survives a refresh.
      if (!driverId) return;
      const since = at - (lastWriteAt.get(driverId) || 0);
      if (since < DB_WRITE_EVERY_MS) return;
      lastWriteAt.set(driverId, at);
      try {
        await Driver.updateOne(
          { _id: driverId },
          {
            currentLocation: { type: 'Point', coordinates: [ln, la] },
            lastLocationAt: new Date(at),
            ...(Number.isFinite(Number(heading)) ? { heading: Number(heading) } : {}),
            ...(Number.isFinite(Number(speedKph)) ? { speedKph: Number(speedKph) } : {}),
          }
        );
      } catch (err) {
        logger.warn(`[socket] location write failed for driver ${driverId}: ${err.message}`);
      }
    });

    socket.on('disconnect', () => {
      // Keep the last fix: a dropped connection is usually a tunnel or a lift,
      // not the end of a shift. Freshness filters handle genuinely stale data,
      // and the driver's own online toggle is the deliberate signal.
      if (driverId) lastWriteAt.delete(driverId);
      logger.info(`[socket] ${role} ${id} disconnected`);
    });
  });

  setIo(io);
  return io;
}

import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../socket.js';

/**
 * Streams the captain's real GPS to the server while they are online.
 *
 * watchPosition rather than setInterval + getCurrentPosition: the device pushes
 * a fix when the position actually changes, which is both more accurate and
 * easier on the battery than polling every N seconds while parked.
 *
 * Emits are throttled — a phone can fire several fixes a second in good
 * conditions, and nobody needs the car redrawn that often.
 */
const EMIT_EVERY_MS = 3000;

export function useLocationStream({ enabled, rideId }) {
  const [fix, setFix] = useState(null);
  const [error, setError] = useState(null);
  const lastEmit = useRef(0);
  // Held in a ref so a changing rideId doesn't tear down and re-establish the watch.
  const rideRef = useRef(rideId);
  rideRef.current = rideId;

  useEffect(() => {
    if (!enabled) return undefined;
    if (!navigator.geolocation) {
      setError('unsupported');
      return undefined;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, heading, speed } = pos.coords;
        setFix({ lat, lng, at: pos.timestamp });
        setError(null);

        const now = Date.now();
        if (now - lastEmit.current < EMIT_EVERY_MS) return;
        lastEmit.current = now;

        getSocket()?.emit('driver:location', {
          rideId: rideRef.current || null,
          lat,
          lng,
          heading: Number.isFinite(heading) ? heading : undefined,
          speedKph: Number.isFinite(speed) ? Math.round(speed * 3.6) : undefined,
        });
      },
      (err) => setError(err.code === 1 ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled]);

  return { fix, error };
}

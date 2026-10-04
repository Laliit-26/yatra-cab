import { describe, it, expect } from 'vitest';
import {
  computeFee,
  computeCommission,
  priceBreakdown,
  haversineKm,
  estimateFareByDistance,
  quoteByDistance,
  computeRefund,
  seatShareFare,
  FARE_RATES,
} from '../../core/src/services/pricingService.js';

// ── computeFee ────────────────────────────────────────────────────────────────

describe('computeFee', () => {
  it('returns 10 % of fare at the default rate', () => {
    expect(computeFee(1000)).toBe(100);
  });

  it('rounds half-rupees up (Math.round semantics)', () => {
    // 1005 * 10% = 100.5 → 101
    expect(computeFee(1005)).toBe(101);
    // 1004 * 10% = 100.4 → 100
    expect(computeFee(1004)).toBe(100);
  });

  it('accepts a custom percent', () => {
    expect(computeFee(500, 15)).toBe(75);
  });

  it('returns 0 for a zero fare', () => {
    expect(computeFee(0)).toBe(0);
  });
});

// ── computeCommission ─────────────────────────────────────────────────────────

describe('computeCommission', () => {
  it('returns { percent: 8, amount } at the default commission rate', () => {
    const { percent, amount } = computeCommission(1000);
    expect(percent).toBe(8);
    expect(amount).toBe(80);
  });

  it('rounds fractional rupees', () => {
    // 1003 * 8% = 80.24 → 80
    expect(computeCommission(1003).amount).toBe(80);
    // 1006 * 8% = 80.48 → 80
    expect(computeCommission(1006).amount).toBe(80);
    // 1007 * 8% = 80.56 → 81
    expect(computeCommission(1007).amount).toBe(81);
  });

  it('returns the supplied percent unchanged', () => {
    expect(computeCommission(1000, 12).percent).toBe(12);
  });
});

// ── priceBreakdown ────────────────────────────────────────────────────────────

describe('priceBreakdown', () => {
  it('returns fare + fee = total', () => {
    const r = priceBreakdown(1000);
    expect(r.fareAmount).toBe(1000);
    expect(r.feeAmount).toBe(100);
    expect(r.totalAmount).toBe(1100);
    expect(r.feePercent).toBe(10);
  });

  it('applies surge multiplier to fare BEFORE computing fee', () => {
    const r = priceBreakdown(1000, 10, 1.5);
    expect(r.fareAmount).toBe(1500); // 1000 * 1.5
    expect(r.feeAmount).toBe(150);   // 10% of 1500
    expect(r.totalAmount).toBe(1650);
  });

  it('surge = 0 falls back to 1 (no-surge)', () => {
    // The implementation uses `(surge || 1)` so 0 → 1.
    const r = priceBreakdown(1000, 10, 0);
    expect(r.fareAmount).toBe(1000);
  });

  it('totalAmount is always fareAmount + feeAmount', () => {
    for (const surge of [1, 1.2, 2]) {
      const r = priceBreakdown(800, 10, surge);
      expect(r.totalAmount).toBe(r.fareAmount + r.feeAmount);
    }
  });
});

// ── haversineKm ───────────────────────────────────────────────────────────────

describe('haversineKm', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineKm({ lat: 26.9124, lng: 75.7873 }, { lat: 26.9124, lng: 75.7873 })).toBe(0);
  });

  it('≈111.2 km per degree of latitude at the equator', () => {
    const km = haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(km).toBeGreaterThan(110);
    expect(km).toBeLessThan(112);
  });

  it('is symmetric (A→B === B→A)', () => {
    const a = { lat: 26.9124, lng: 75.7873 };
    const b = { lat: 28.6139, lng: 77.2090 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 5);
  });

  it('returns 0 for null/missing inputs', () => {
    expect(haversineKm(null, { lat: 0, lng: 0 })).toBe(0);
    expect(haversineKm({ lat: 0, lng: 0 }, null)).toBe(0);
    expect(haversineKm({ lat: null, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    expect(haversineKm({}, {})).toBe(0);
  });

  it('Jaipur → Delhi is roughly 237 km (direct / great-circle)', () => {
    const jaipur = { lat: 26.9124, lng: 75.7873 };
    const delhi = { lat: 28.6139, lng: 77.2090 };
    const km = haversineKm(jaipur, delhi);
    expect(km).toBeGreaterThan(230);
    expect(km).toBeLessThan(245);
  });
});

// ── estimateFareByDistance ────────────────────────────────────────────────────

describe('estimateFareByDistance', () => {
  it('result is always a whole multiple of ₹10', () => {
    for (const [dist, vt, tt] of [
      [10, 'sedan', 'one_way'],
      [100, 'suv', 'round_trip'],
      [250, 'hatchback', 'one_way'],
    ]) {
      const fare = estimateFareByDistance(dist, vt, tt);
      expect(fare % 10).toBe(0);
    }
  });

  it('never falls below the minimum fare (base × 2)', () => {
    for (const vt of ['hatchback', 'sedan', 'suv', 'tempo']) {
      const minFare = FARE_RATES[vt].base * 2;
      expect(estimateFareByDistance(0, vt, 'one_way')).toBeGreaterThanOrEqual(minFare);
      expect(estimateFareByDistance(0, vt, 'round_trip')).toBeGreaterThanOrEqual(minFare);
    }
  });

  it('round_trip costs more than one_way for the same distance', () => {
    expect(estimateFareByDistance(100, 'sedan', 'round_trip'))
      .toBeGreaterThan(estimateFareByDistance(100, 'sedan', 'one_way'));
  });

  it('suv is more expensive than sedan for the same trip', () => {
    expect(estimateFareByDistance(80, 'suv', 'one_way'))
      .toBeGreaterThan(estimateFareByDistance(80, 'sedan', 'one_way'));
  });

  it('unknown vehicleType falls back to sedan rates', () => {
    expect(estimateFareByDistance(50, 'rickshaw')).toBe(estimateFareByDistance(50, 'sedan'));
  });

  it('sedan 100 km one_way: ₹1400', () => {
    // 500 + 9*100 = 1400, max(1400, 1000) = 1400, round to 10 → 1400
    expect(estimateFareByDistance(100, 'sedan', 'one_way')).toBe(1400);
  });
});

// ── quoteByDistance ───────────────────────────────────────────────────────────

describe('quoteByDistance', () => {
  const pickup = { lat: 26.9124, lng: 75.7873 }; // Jaipur
  const drop = { lat: 27.1767, lng: 78.0081 };   // Agra-ish (~230 km)

  it('returns distanceKm, estimatedMins, fareAmount, feeAmount, totalAmount', () => {
    const q = quoteByDistance({ pickup, drop, vehicleType: 'sedan' });
    expect(q).toHaveProperty('distanceKm');
    expect(q).toHaveProperty('estimatedMins');
    expect(q).toHaveProperty('fareAmount');
    expect(q).toHaveProperty('feeAmount');
    expect(q).toHaveProperty('totalAmount');
    expect(q.totalAmount).toBe(q.fareAmount + q.feeAmount);
  });

  it('distanceKm is non-negative and makes sense for Jaipur→Agra-ish', () => {
    const { distanceKm } = quoteByDistance({ pickup, drop, vehicleType: 'sedan' });
    expect(distanceKm).toBeGreaterThan(150);
    expect(distanceKm).toBeLessThan(350);
  });

  it('round_trip quote is larger than one_way for the same route', () => {
    const rt = quoteByDistance({ pickup, drop, vehicleType: 'sedan', tripType: 'round_trip' });
    const ow = quoteByDistance({ pickup, drop, vehicleType: 'sedan', tripType: 'one_way' });
    expect(rt.fareAmount).toBeGreaterThan(ow.fareAmount);
  });
});

// ── computeRefund ─────────────────────────────────────────────────────────────

describe('computeRefund', () => {
  // Scheduled 24 hours from now — well inside the free-cancel window (default 6h).
  const futureRide = new Date(Date.now() + 24 * 60 * 60 * 1000);
  // Only 2 hours away — outside the free-cancel window.
  const soonRide = new Date(Date.now() + 2 * 60 * 60 * 1000);

  it('driver no-show: full fee refunded, nothing forfeited', () => {
    const r = computeRefund({ feeAmount: 300, scheduledAt: futureRide, reason: 'driver_no_show' });
    expect(r.refundAmount).toBe(300);
    expect(r.forfeited).toBe(0);
  });

  it('driver cancels: full fee refunded', () => {
    const r = computeRefund({ feeAmount: 300, scheduledAt: soonRide, by: 'driver' });
    expect(r.refundAmount).toBe(300);
    expect(r.forfeited).toBe(0);
  });

  it('customer cancels inside free window: fee minus ₹50 processing fee', () => {
    const r = computeRefund({ feeAmount: 300, scheduledAt: futureRide });
    expect(r.refundAmount).toBe(250); // 300 - 50
    expect(r.forfeited).toBe(50);
  });

  it('customer cancels inside free window with tiny fee: processing capped to actual fee', () => {
    // feeAmount < cancelProcessingFee (50): customer gets 0 back
    const r = computeRefund({ feeAmount: 30, scheduledAt: futureRide });
    expect(r.refundAmount).toBe(0);
    expect(r.forfeited).toBe(30); // min(50, 30) = 30
  });

  it('late customer cancellation: full fee forfeited', () => {
    const r = computeRefund({ feeAmount: 300, scheduledAt: soonRide });
    expect(r.refundAmount).toBe(0);
    expect(r.forfeited).toBe(300);
  });

  it('exactly at the free-cancel boundary (hoursBefore === 6): treated as free-cancel', () => {
    // freeCancelWindowHours default = 6; hoursBefore >= 6 → free cancel path
    const exactBoundary = new Date(Date.now() + 6 * 60 * 60 * 1000 + 500); // 6h + 500ms
    const r = computeRefund({ feeAmount: 300, scheduledAt: exactBoundary });
    expect(r.refundAmount).toBe(250);
  });

  it('refundAmount + forfeited always equals feeAmount', () => {
    for (const [fee, at, by] of [
      [300, futureRide, 'customer'],
      [300, soonRide, 'customer'],
      [100, soonRide, 'driver'],
    ]) {
      const r = computeRefund({ feeAmount: fee, scheduledAt: at, by });
      expect(r.refundAmount + r.forfeited).toBe(fee);
    }
  });

  // ── KNOWN CONCERNS ──────────────────────────────────────────────────────────

  it('CONCERN: customer-supplied reason=driver_no_show bypasses late-cancel penalty', () => {
    // computeRefund does not validate who set `reason`. If the API layer
    // passes a caller-supplied reason string directly, a customer could claim
    // a full refund on a late cancellation. Ensure the API validates this.
    const r = computeRefund({
      feeAmount: 300,
      scheduledAt: soonRide,   // late — should forfeit
      reason: 'driver_no_show', // but caller claims it was a no-show
      by: 'customer',
    });
    // Documents actual behaviour — full refund is returned:
    expect(r.refundAmount).toBe(300);
    // If you see this test: the upstream controller must own the `reason`
    // value (derive from business state, not the HTTP request body).
  });

  it('CONCERN: by=driver label reads "Driver no-show" even for ordinary driver cancellations', () => {
    // The reasonLabel is cosmetically wrong — it says "no-show" for any driver
    // path, including deliberate cancellations. Not a money bug, but misleading
    // in receipts and ops dashboards.
    const r = computeRefund({ feeAmount: 100, scheduledAt: futureRide, by: 'driver' });
    expect(r.reasonLabel).toContain('no-show'); // passes today; ideally separate labels
  });
});

// ── seatShareFare ─────────────────────────────────────────────────────────────

describe('seatShareFare', () => {
  it('multiplies per-seat fare by seat count', () => {
    expect(seatShareFare(500, 3)).toBe(1500);
  });

  it('defaults to 1 seat', () => {
    expect(seatShareFare(500)).toBe(500);
  });

  it('rounds fractional per-seat fares', () => {
    // 333.33 * 3 = 999.99 → 1000
    expect(seatShareFare(333.33, 3)).toBe(1000);
  });
});

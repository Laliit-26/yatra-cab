import mongoose from 'mongoose';

export const RIDE_STATUS = {
  PENDING_PAYMENT: 'pending_payment', // created, advance fee not yet paid
  SEARCHING: 'searching', // Ride Alert open — drivers bidding
  CONFIRMED: 'confirmed', // driver assigned + fee paid
  ONGOING: 'ongoing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
};

// A Ride covers BOTH booking modes:
//   mode 'fixed'   -> fare taken from Route.fixedFare[vehicleType]
//   mode 'bidding' -> fare = accepted Bid amount
const rideSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', index: true },
    route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route' },
    // Set when the ride came from a driver's published daily route — without
    // this link there is no way to know how many seats that route has left.
    dailyRoute: { type: mongoose.Schema.Types.ObjectId, ref: 'DriverRoute', index: true },

    mode: { type: String, enum: ['fixed', 'bidding'], required: true },
    // Full private cab vs per-seat carpooling.
    bookingType: { type: String, enum: ['full_cab', 'seat_share'], default: 'full_cab', index: true },
    seatsTotal: { type: Number, default: 1 },
    seatsBooked: { type: Number, default: 0 },
    perSeatFare: { type: Number, default: 0 },
    womenOnly: { type: Boolean, default: false }, // women-only seat sharing
    // 'any' = a Ride Alert with no vehicle preference: every driver sees it and
    // the vehicle is whatever the rider picks from the bids.
    vehicleType: { type: String, enum: ['hatchback', 'sedan', 'suv', 'tempo', 'any'], required: true },
    tripType: { type: String, enum: ['one_way', 'round_trip'], default: 'round_trip' },

    // Advance alert context — arrival delays auto-shift the ride time.
    transport: {
      type: { type: String, enum: ['none', 'train', 'flight', 'bus'], default: 'none' },
      number: String,
      scheduledAt: Date, // scheduled arrival
      delayMins: { type: Number, default: 0 },
    },

    // Pay-to-Connect: commission is charged to the DRIVER's wallet; contact
    // (masked number / OTP) unlocks only once the commission is settled.
    commission: {
      percent: { type: Number, default: 0 },
      amount: { type: Number, default: 0 },
      status: { type: String, enum: ['none', 'pending', 'charged', 'refunded'], default: 'none' },
    },
    contactUnlocked: { type: Boolean, default: false },
    connectOtp: String, // shared after commission settles
    // Three-point OTP verification. The rider holds every code; the driver
    // never sees them. The end code is what stops a driver demanding more
    // than the agreed fare — the ride cannot be closed without it.
    verification: {
      payment: { code: String, verifiedAt: Date },
      start: { code: String, verifiedAt: Date, sentAt: Date },
      end: { code: String, verifiedAt: Date, sentAt: Date },
    },

    // Snapshot of trip endpoints (denormalised for dynamic point-to-point trips).
    pickup: { address: String, lat: Number, lng: Number },
    dropLocation: { address: String, lat: Number, lng: Number },
    destination: { type: String }, // human label for the drop
    distanceKm: { type: Number, default: 0 },
    estimatedMins: { type: Number, default: 0 },
    scheduledAt: { type: Date, required: true, index: true },
    passengers: { type: Number, default: 1 },
    notes: String, // wheelchair, extra stops, etc.

    // Money (INR).
    fareAmount: { type: Number, default: 0 }, // paid in cash to driver
    feeAmount: { type: Number, default: 0 }, // Booking & Safety Fee (online → platform)
    totalAmount: { type: Number, default: 0 }, // fare + fee (shown to customer)
    feePercent: { type: Number, default: 10 },
    pointsRedeemed: { type: Number, default: 0 }, // cashback points applied
    discount: { type: Number, default: 0 },
    coupon: { code: String, discount: Number },

    status: {
      type: String,
      enum: Object.values(RIDE_STATUS),
      default: RIDE_STATUS.PENDING_PAYMENT,
      index: true,
    },

    // Bidding metadata (mode = bidding).
    biddingClosesAt: Date,
    acceptedBid: { type: mongoose.Schema.Types.ObjectId, ref: 'Bid' },

    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },

    // Live tracking during ongoing rides.
    driverLocation: {
      lat: Number,
      lng: Number,
      updatedAt: Date,
    },

    cancellation: {
      by: { type: String, enum: ['customer', 'driver', 'admin'] },
      reason: String,
      at: Date,
      refundAmount: Number,
    },
    startedAt: Date,
    completedAt: Date,
    ratedByCustomer: { type: Boolean, default: false },
    ratedByDriver: { type: Boolean, default: false },
  },
  { timestamps: true }
);

rideSchema.index({ status: 1, scheduledAt: 1 });
rideSchema.index({ customer: 1, createdAt: -1 });
rideSchema.index({ driver: 1, createdAt: -1 });

export const Ride = mongoose.models.Ride || mongoose.model('Ride', rideSchema);

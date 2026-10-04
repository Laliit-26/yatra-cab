import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['driving_licence', 'vehicle_rc', 'aadhaar', 'permit', 'insurance', 'profile_photo'],
      required: true,
    },
    url: String, // Cloudinary/S3 in prod; a placeholder string in dev.
    number: String,
    expiresAt: Date,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectionReason: String,
  },
  { _id: false }
);

// 1:1 with a driver User. Carries vehicle, KYC documents, verification gate,
// geo location, and performance stats.
const driverSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    homeStand: { type: String, default: 'Jaipur' }, // base city
    servesRoutes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Route' }],
    vehicle: {
      type: { type: String, enum: ['hatchback', 'sedan', 'suv', 'tempo'], required: true },
      make: String,
      model: String,
      plateNumber: { type: String, trim: true, uppercase: true },
      color: String,
      seats: { type: Number, default: 4 },
    },
    documents: [documentSchema],
    // Verification gate — only 'approved' drivers can go online / receive rides.
    verificationStatus: {
      type: String,
      enum: ['unsubmitted', 'pending', 'approved', 'rejected'],
      default: 'unsubmitted',
      index: true,
    },
    rejectionReason: String,
    approvedAt: Date,
    isOnline: { type: Boolean, default: false, index: true },
    currentLocation: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [75.7873, 26.9124] }, // [lng, lat] — Jaipur
    },
    // When that fix arrived. A driver flagged online whose last ping is old is
    // not actually available, so every "live" query filters on this.
    lastLocationAt: { type: Date, index: true },
    heading: { type: Number }, // degrees, for pointing the car icon
    speedKph: { type: Number },
    rating: { type: Number, default: 5, min: 1, max: 5 },
    ratingCount: { type: Number, default: 0 },
    completedRides: { type: Number, default: 0 },
    cancelledRides: { type: Number, default: 0 },
    noShows: { type: Number, default: 0 },
    loyaltyPoints: { type: Number, default: 0 },
    // Lifetime fee-exempt platform earnings context (cash collected is off-app).
    totalEarnings: { type: Number, default: 0 },
    // Pay-to-Connect wallet (commission is debited on accepted rides).
    walletBalance: { type: Number, default: 0 },
    // Driver-to-driver referral (referrer earns recurring commission).
    referredByDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
    referralEarnings: { type: Number, default: 0 },
    penalties: [
      {
        reason: String,
        amount: Number,
        ride: { type: mongoose.Schema.Types.ObjectId, ref: 'Ride' },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

driverSchema.index({ currentLocation: '2dsphere' });

export const Driver = mongoose.models.Driver || mongoose.model('Driver', driverSchema);

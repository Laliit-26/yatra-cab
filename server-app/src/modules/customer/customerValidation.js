import Joi from 'joi';

const objectId = Joi.string().hex().length(24);
const vehicleType = Joi.string().valid('hatchback', 'sedan', 'suv', 'tempo');
const tripType = Joi.string().valid('one_way', 'round_trip');

// A geocoded place. Pickup allows a coord-less address (e.g. when a popular
// route is chosen); a custom drop must carry coordinates for distance pricing.
const pickupLoc = Joi.object({
  address: Joi.string().max(200).required(),
  lat: Joi.number().min(-90).max(90).optional(),
  lng: Joi.number().min(-180).max(180).optional(),
});
const dropLoc = Joi.object({
  address: Joi.string().max(200).required(),
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
});

export const quoteSchema = Joi.object({
  routeId: objectId.optional(),
  pickup: pickupLoc.optional(),
  drop: dropLoc.optional(),
  vehicleType: vehicleType.optional(),
  tripType: tripType.default('round_trip'),
}).or('routeId', 'drop');

const bookingType = Joi.string().valid('full_cab', 'seat_share');
const transport = Joi.object({
  type: Joi.string().valid('none', 'train', 'flight', 'bus').default('none'),
  number: Joi.string().max(20).allow('').optional(),
  scheduledAt: Joi.date().optional(),
});

export const fixedBookingSchema = Joi.object({
  routeId: objectId.optional(),
  drop: dropLoc.optional(), // custom point-to-point drop (else use routeId)
  vehicleType: vehicleType.required(),
  tripType: tripType.default('round_trip'),
  bookingType: bookingType.default('full_cab'),
  seats: Joi.number().integer().min(1).max(12).default(1),
  womenOnly: Joi.boolean().default(false),
  transport: transport.optional(),
  scheduledAt: Joi.date().greater('now').required(),
  passengers: Joi.number().integer().min(1).max(12).default(1),
  notes: Joi.string().max(300).allow('').optional(),
  pickup: pickupLoc.required(),
}).or('routeId', 'drop');

export const rideAlertSchema = Joi.object({
  routeId: objectId.optional(),
  drop: dropLoc.optional(), // custom drop
  // Optional: drivers bid with their own vehicle, the rider picks from the bids.
  vehicleType: vehicleType.optional(),
  tripType: tripType.default('round_trip'),
  bookingType: bookingType.default('full_cab'),
  seats: Joi.number().integer().min(1).max(12).default(1),
  womenOnly: Joi.boolean().default(false),
  transport: transport.optional(),
  scheduledAt: Joi.date().greater('now').required(),
  passengers: Joi.number().integer().min(1).max(12).default(1),
  notes: Joi.string().max(300).allow('').optional(),
  biddingWindowMins: Joi.number().integer().min(5).max(720).default(30), // up to 12 hours
  pickup: pickupLoc.required(),
}).or('routeId', 'drop');

export const seatBookSchema = Joi.object({
  seats: Joi.number().integer().min(1).max(12).default(1),
  scheduledAt: Joi.date().greater('now').required(),
});

export const sosSchema = Joi.object({
  rideId: objectId.optional(),
  lat: Joi.number().min(-90).max(90).optional(),
  lng: Joi.number().min(-180).max(180).optional(),
  note: Joi.string().max(200).allow('').optional(),
});

export const shareSchema = Joi.object({ rideId: objectId.required() });

export const redeemSchema = Joi.object({
  usePoints: Joi.boolean().default(false),
  couponCode: Joi.string().alphanum().min(3).max(16).uppercase().optional(),
});

export const couponCheckSchema = Joi.object({
  code: Joi.string().alphanum().min(3).max(16).uppercase().required(),
});

export const paymentVerifySchema = Joi.object({
  otp: Joi.string().pattern(/^[0-9]{6}$/).optional(),
  orderId: Joi.string().required(),
  paymentId: Joi.string().required(),
  signature: Joi.string().required(),
});

export const cancelSchema = Joi.object({
  reason: Joi.string().max(200).allow('').optional(),
});

export const rateSchema = Joi.object({
  stars: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().max(300).allow('').optional(),
});

export const profileSchema = Joi.object({
  name: Joi.string().max(80).optional(),
  email: Joi.string().email().optional(),
  gender: Joi.string().valid('female', 'male', 'other', 'unspecified').optional(),
  vibes: Joi.array()
    .items(Joi.string().valid('music_lover', 'silent_zone', 'podcast_fan', 'chatty', 'work_mode', 'foodie', 'non_smoker', 'pet_friendly'))
    .max(6)
    .optional(),
  emergencyContact: Joi.string()
    .pattern(/^\+?[0-9]{10,13}$/)
    .allow('')
    .optional(),
  savedRoutes: Joi.array().items(objectId).optional(),
});

// Contacts the user hand-picked to invite. Capped at 50 per call — the
// Contact Picker returns a tapped selection, not an address book.
export const contactsSchema = Joi.object({
  contacts: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().max(80).allow('').optional(),
        phone: Joi.string()
          .pattern(/^[+0-9 ()-]{8,20}$/)
          .required(),
        source: Joi.string().valid('picker', 'manual').default('picker'),
      })
    )
    .min(1)
    .max(50)
    .required(),
});

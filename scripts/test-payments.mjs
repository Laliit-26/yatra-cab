import crypto from 'crypto';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(dir, '../.env') });

const { User, Ride, Payment, RIDE_STATUS, createOrder, verifyPayment, verifyWebhookSignature } =
  await import(path.resolve(dir, '../core/src/index.js'));

await mongoose.connect(process.env.MONGODB_URI);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${okk ? '  PASS' : '  FAIL'}  ${name}${okk ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  okk ? pass++ : fail++;
};

const TAG = 'PAYTEST';
const cleanup = async () => {
  const us = await User.find({ $or: [{ name: new RegExp(`^${TAG}`) }, { phone: '9998887771' }] }).select('_id').lean();
  const ids = us.map(u => u._id);
  const rides = await Ride.find({ customer: { $in: ids } }).select('_id').lean();
  await Promise.all([
    Payment.deleteMany({ ride: { $in: rides.map(r => r._id) } }),
    Ride.deleteMany({ customer: { $in: ids } }),
    User.deleteMany({ _id: { $in: ids } }),
  ]);
};
await cleanup();

// ── Mock provider ────────────────────────────────────────────────────────────
process.env.PAYMENT_PROVIDER = 'mock';
console.log('\nmock provider');
const mock = await createOrder({ amount: 300, receipt: 'rcpt_1' });
check('order is in paise', mock.amount, 30000);
check('order is INR', mock.currency, 'INR');
check('token verifies', await verifyPayment({ orderId: mock.id, signature: mock.mockToken }), true);
check('wrong token rejected', await verifyPayment({ orderId: mock.id, signature: 'deadbeef' }), false);

// ── Razorpay signature paths, exercised with a stand-in secret ────────────────
// This is the code that runs against real keys; only the secret differs, so a
// pass here means dropping in test keys leaves nothing else to get wrong.
process.env.PAYMENT_PROVIDER = 'razorpay';
process.env.RAZORPAY_KEY_SECRET = 'test_secret_stand_in';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_stand_in';
console.log('\nrazorpay signature verification');

const orderId = 'order_TESTabc123', paymentId = 'pay_TESTxyz789';
const sig = crypto.createHmac('sha256', 'test_secret_stand_in').update(`${orderId}|${paymentId}`).digest('hex');
check('checkout signature accepted', await verifyPayment({ orderId, paymentId, signature: sig }), true);
check('tampered payment id rejected', await verifyPayment({ orderId, paymentId: 'pay_OTHER', signature: sig }), false);

const rawBody = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: orderId } } } }));
const hookSig = crypto.createHmac('sha256', 'test_webhook_stand_in').update(rawBody).digest('hex');
check('webhook signature accepted', verifyWebhookSignature({ rawBody, signature: hookSig }), true);
check('forged webhook rejected', verifyWebhookSignature({ rawBody, signature: 'f'.repeat(64) }), false);
check('missing signature rejected', verifyWebhookSignature({ rawBody, signature: '' }), false);
// Razorpay signs bytes, not objects: re-serialising must not still validate.
const reserialised = Buffer.from(JSON.stringify(JSON.parse(rawBody.toString()), null, 2));
check('re-serialised body rejected', verifyWebhookSignature({ rawBody: reserialised, signature: hookSig }), false);

// ── Idempotency: callback and webhook both land ──────────────────────────────
console.log('\nconfirm is idempotent');
const { confirmPaidRide } = await import(path.resolve(dir, '../server-app/src/modules/customer/paymentConfirm.js'));

const user = await User.create({ name: `${TAG} Rider`, phone: '9998887771', role: 'customer' });
const ride = await Ride.create({
  customer: user._id, mode: 'bidding', vehicleType: 'any',
  scheduledAt: new Date(Date.now() + 86400000), status: RIDE_STATUS.PENDING,
});
const payment = await Payment.create({ ride: ride._id, customer: user._id, amount: 300, orderId, provider: 'razorpay' });

const first = await confirmPaidRide({ payment, ride, paymentId });
check('first confirm goes through', first.alreadyConfirmed, false);
check('ride is confirmed', first.ride.status, RIDE_STATUS.CONFIRMED);
const startCode = first.ride.verification?.start?.code;
check('start code minted', typeof startCode === 'string' && startCode.length === 6, true);

const second = await confirmPaidRide({ payment, ride, paymentId });
check('second confirm is a no-op', second.alreadyConfirmed, true);
check('start code unchanged', second.ride.verification?.start?.code, startCode);
const paidCount = await Payment.countDocuments({ orderId, status: 'paid' });
check('payment marked paid once', paidCount, 1);

await cleanup();
await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

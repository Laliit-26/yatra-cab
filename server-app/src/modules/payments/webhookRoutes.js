import express from 'express';
import { verifyWebhookSignature, logger, ok } from '@yatracab/core';
import { confirmPaidRide, findPaymentContext } from '../customer/paymentConfirm.js';
import { assignDriverForFixedRide } from '../shared/rideHelpers.js';

const router = express.Router();

/**
 * POST /api/payments/webhook/razorpay
 *
 * Server-to-server, so there is no JWT here — the HMAC over the raw body IS the
 * authentication. Mounted before the JSON body parser because Razorpay signs
 * the exact bytes it sent; parsing and re-serialising changes them and the
 * signature stops matching.
 *
 * Answers 200 once the signature checks out. A non-2xx makes Razorpay retry,
 * and retrying will not fix a payment for a ride we cannot find — that needs a
 * human, not another delivery attempt.
 */
router.post('/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.get('x-razorpay-signature');
  const rawBody = req.body; // Buffer, thanks to express.raw

  if (!verifyWebhookSignature({ rawBody, signature })) {
    logger.warn('[webhook] rejected razorpay event: bad signature');
    return res.status(400).json({ success: false, message: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ success: false, message: 'Malformed payload' });
  }

  const type = event?.event;
  const entity = event?.payload?.payment?.entity;
  const orderId = entity?.order_id;
  logger.info(`[webhook] razorpay ${type} order=${orderId || '—'}`);

  if (type !== 'payment.captured' || !orderId) {
    return ok(res, { received: true }); // acknowledged, nothing to do
  }

  const ctx = await findPaymentContext(orderId);
  if (!ctx) {
    // Acknowledge so Razorpay stops retrying, but make it loud: money moved for
    // something we cannot match, which needs manual reconciliation.
    logger.error(`[webhook] payment captured for unknown order ${orderId} — reconcile manually`);
    return ok(res, { received: true, matched: false });
  }

  try {
    const { alreadyConfirmed } = await confirmPaidRide({
      payment: ctx.payment,
      ride: ctx.ride,
      paymentId: entity.id,
      assignDriver: assignDriverForFixedRide,
    });
    return ok(res, { received: true, alreadyConfirmed });
  } catch (err) {
    logger.error(`[webhook] confirm failed for order ${orderId}: ${err.message}`);
    return res.status(500).json({ success: false }); // let Razorpay retry
  }
});

export default router;

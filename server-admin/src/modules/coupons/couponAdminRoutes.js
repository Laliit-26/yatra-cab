import { Router } from 'express';
import Joi from 'joi';
import { validate } from '@yatracab/core';
import { adminGuard } from '../../middleware/adminGuard.js';
import {
  listCoupons,
  getCoupon,
  createCoupon,
  updateCoupon,
  deactivateCoupon,
} from './couponAdminController.js';

const router = Router();
router.use(...adminGuard);

const couponSchema = Joi.object({
  code: Joi.string().alphanum().min(3).max(16).required(),
  description: Joi.string().max(160).allow('').optional(),
  type: Joi.string().valid('flat', 'percent').default('flat'),
  value: Joi.number().min(1).required(),
  maxDiscount: Joi.number().min(0).default(0),
  minFare: Joi.number().min(0).default(0),
  totalCoupons: Joi.number().integer().min(1).required(),
  perUserLimit: Joi.number().integer().min(1).max(50).default(1),
  validFrom: Joi.date().optional(),
  validUntil: Joi.date().optional(),
  active: Joi.boolean().default(true),
});

router.get('/', listCoupons);
router.post('/', validate(couponSchema), createCoupon);
router.get('/:id', getCoupon);
router.patch(
  '/:id',
  validate(couponSchema.fork(Object.keys(couponSchema.describe().keys), (s) => s.optional())),
  updateCoupon
);
router.delete('/:id', deactivateCoupon);

export default router;

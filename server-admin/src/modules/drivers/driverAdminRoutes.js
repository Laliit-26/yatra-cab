import { Router } from 'express';
import Joi from 'joi';
import { validate } from '@yatracab/core';
import { adminGuard } from '../../middleware/adminGuard.js';
import {
  listDrivers,
  getDriver,
  approveDriver,
  rejectDriver,
  reviewDocument,
  setDriverBlocked,
  addPenalty, liveDrivers } from './driverAdminController.js';

const router = Router();
router.use(...adminGuard);

const rejectSchema = Joi.object({ reason: Joi.string().max(200).allow('').optional() });
const docSchema = Joi.object({
  status: Joi.string().valid('approved', 'rejected', 'pending').required(),
  rejectionReason: Joi.string().max(200).allow('').optional(),
});
const blockSchema = Joi.object({ blocked: Joi.boolean().required() });
const penaltySchema = Joi.object({
  amount: Joi.number().min(0).required(),
  reason: Joi.string().max(200).required(),
  rideId: Joi.string().hex().length(24).optional(),
});

router.get('/', listDrivers);
router.get('/live', liveDrivers); // before '/:id' — otherwise 'live' is read as an id
router.get('/:id', getDriver);
router.patch('/:id/approve', approveDriver);
router.patch('/:id/reject', validate(rejectSchema), rejectDriver);
router.patch('/:id/documents/:type', validate(docSchema), reviewDocument);
router.patch('/:id/block', validate(blockSchema), setDriverBlocked);
router.post('/:id/penalty', validate(penaltySchema), addPenalty);

export default router;

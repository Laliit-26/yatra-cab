import { Router } from 'express';
import Joi from 'joi';
import { validate, otpRateLimiter, otpAbuseLimiter } from '@yatracab/core';
import { adminGuard } from '../../middleware/adminGuard.js';
import { sendOtp, confirmOtp, refresh, logout, me } from './adminAuthController.js';

const phone = Joi.string().pattern(/^\+?[0-9]{10,13}$/);
const requestSchema = Joi.object({ phone: phone.required() });
const verifySchema = Joi.object({
  phone: phone.required(),
  code: Joi.string().pattern(/^[0-9]{6}$/).required(),
});

const router = Router();
router.post('/request-otp', otpAbuseLimiter, otpRateLimiter, validate(requestSchema), sendOtp);
router.post('/verify-otp', validate(verifySchema), confirmOtp);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', ...adminGuard, me);

export default router;

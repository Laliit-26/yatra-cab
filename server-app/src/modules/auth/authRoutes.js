import { Router } from 'express';
import { validate, requireAuth, otpRateLimiter, otpAbuseLimiter } from '@yatracab/core';
import { requestOtpSchema, verifyOtpSchema } from './authValidation.js';
import { sendOtp, confirmOtp, refresh, logout, me } from './authController.js';

const router = Router();

router.post('/request-otp', otpAbuseLimiter, otpRateLimiter, validate(requestOtpSchema), sendOtp);
router.post('/verify-otp', validate(verifyOtpSchema), confirmOtp);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', requireAuth, me);

export default router;

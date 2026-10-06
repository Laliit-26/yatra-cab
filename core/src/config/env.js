// Central, lazily-read access to environment variables shared by both
// backend services. Values are read through getters so they always reflect
// the current process.env — each service loads its own .env (via dotenv)
// BEFORE importing @yatracab/core, and these getters pick that up.

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  get nodeEnv() {
    return process.env.NODE_ENV || 'development';
  },
  get isProd() {
    return this.nodeEnv === 'production';
  },
  get mongoUri() {
    return process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/yatracab';
  },
  jwt: {
    get accessSecret() {
      return process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_me';
    },
    get refreshSecret() {
      return process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_change_me';
    },
    get accessExpires() {
      return process.env.JWT_ACCESS_EXPIRES || '15m';
    },
    get refreshExpires() {
      return process.env.JWT_REFRESH_EXPIRES || '30d';
    },
  },
  otp: {
    get channel() {
      return process.env.OTP_CHANNEL || 'email';
    },
    get gmailUser() {
      return process.env.GMAIL_USER || '';
    },
    get gmailAppPassword() {
      return process.env.GMAIL_APP_PASSWORD || '';
    },
    get fromName() {
      return process.env.OTP_FROM_NAME || 'YatraCab';
    },
    get devOtp() {
      return process.env.DEV_OTP || '123456';
    },
    // Demo mode: skip email entirely, return the code in the API response and
    // accept the fixed devOtp — used on hosts (e.g. Render free) that block
    // outbound SMTP so email OTP can't be delivered.
    // SECURITY: hard-block if someone sets DEMO_OTP=true in production — that
    // would let any caller authenticate with 123456, including seeded admins.
    get demoMode() {
      if (process.env.DEMO_OTP === 'true' && process.env.NODE_ENV === 'production') {
        throw new Error('FATAL: DEMO_OTP=true is not allowed in NODE_ENV=production. Remove it from your deployment config.');
      }
      return process.env.DEMO_OTP === 'true';
    },
    get ttlMs() {
      return num(process.env.OTP_TTL_MS, 5 * 60 * 1000);
    },
    // Phones whose OTP is returned in the API response and shown on the sign-in
    // screen, so testers need no inbox. Unlike DEMO_OTP this is allowed in
    // production, because it is an explicit list rather than a blanket switch —
    // but every number on it is publicly takeover-able: anyone who knows it can
    // read the code and sign in. Seeded demo accounts only; empty it before
    // real users exist.
    get demoPhones() {
      return (process.env.DEMO_LOGIN_PHONES || '')
        .split(',')
        .map((p) => p.replace(/[^0-9]/g, '').slice(-10))
        .filter(Boolean);
    },
  },
  payment: {
    get provider() {
      return process.env.PAYMENT_PROVIDER || 'mock';
    },
    get razorpayKeyId() {
      return process.env.RAZORPAY_KEY_ID || '';
    },
    get razorpayKeySecret() {
      return process.env.RAZORPAY_KEY_SECRET || '';
    },
    get razorpayWebhookSecret() {
      return process.env.RAZORPAY_WEBHOOK_SECRET || '';
    },
  },
  business: {
    get feePercent() {
      return num(process.env.DEFAULT_FEE_PERCENT, 10);
    },
    get freeCancelWindowHours() {
      return num(process.env.FREE_CANCEL_WINDOW_HOURS, 6);
    },
    get cancelProcessingFee() {
      return num(process.env.CANCEL_PROCESSING_FEE, 50);
    },
    // Pay-to-Connect: commission charged to the driver's wallet on accept.
    get commissionPercent() {
      return num(process.env.COMMISSION_PERCENT, 8);
    },
    // Referral rewards.
    get referralSignupPoints() {
      return num(process.env.REFERRAL_SIGNUP_POINTS, 50);
    },
    get driverReferralPercent() {
      return num(process.env.DRIVER_REFERRAL_PERCENT, 10); // % of platform commission
    },
    // Customer (rider) multi-level referral engine. All shares are a % of a
    // ride's platform commission, so payouts can never exceed what we earned.
    get customerReferralPercent() {
      return num(process.env.CUSTOMER_REFERRAL_PERCENT, 20); // chain pool
    },
    get customerCashbackPercent() {
      return num(process.env.CUSTOMER_CASHBACK_PERCENT, 10); // rider's own-ride cashback
    },
    // Chain pays only during the referred rider's first N completed rides.
    get customerReferralWindowRides() {
      return num(process.env.CUSTOMER_REFERRAL_WINDOW_RIDES, 25);
    },
    // An upline must have ridden within this many days to earn.
    get customerReferralActiveDays() {
      return num(process.env.CUSTOMER_REFERRAL_ACTIVE_DAYS, 30);
    },
    get customerReferralMonthlyCap() {
      return num(process.env.CUSTOMER_REFERRAL_MONTHLY_CAP, 1000); // points / month / user
    },
    get pointValue() {
      return num(process.env.POINT_VALUE, 1); // ₹ per point on redemption
    },
    get driverWelcomeCredit() {
      return num(process.env.DRIVER_WELCOME_CREDIT, 200); // free starter wallet credit
    },
  },
  get logLevel() {
    return process.env.LOG_LEVEL || 'info';
  },
};

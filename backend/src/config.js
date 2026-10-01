import crypto from 'node:crypto';

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

function required(name) {
  if (!env[name]) throw new Error(`Missing required environment variable ${name}`);
  return env[name];
}

let jwtSecret = env.JWT_SECRET;
if (isProd) {
  jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  required('DATABASE_URL');
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET)
    console.warn('WARNING: Razorpay keys missing - browsing works, but online payments return payments_not_configured.');
} else if (!jwtSecret) {
  jwtSecret = crypto.randomBytes(32).toString('hex'); // dev only: sessions reset on restart
}

export const config = {
  isProd,
  isTest,
  port: Number(env.PORT || 4000),
  publicUrl: env.PUBLIC_URL || 'http://localhost:5173',
  jwtSecret,
  databaseUrl: env.DATABASE_URL || null, // unset => embedded Postgres (PGlite) for dev/test
  pgliteDir: env.PGLITE_DIR || (isTest ? null : './.data/pglite'),
  // One-time secret the owner sets at deploy time to claim the First Admin Setup.
  adminSetupToken: env.ADMIN_SETUP_TOKEN || (isProd ? null : 'dev-setup-token'), // dev default only
  razorpay: {
    keyId: env.RAZORPAY_KEY_ID || null,
    keySecret: env.RAZORPAY_KEY_SECRET || null,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || null,
  },
  storage: {
    driver: env.S3_BUCKET ? 's3' : 'local',
    bucket: env.S3_BUCKET || null,
    region: env.S3_REGION || 'ap-south-1',
    endpoint: env.S3_ENDPOINT || undefined, // e.g. Supabase Storage S3 endpoint
    publicBaseUrl: env.S3_PUBLIC_BASE_URL || null, // CDN / public bucket URL
    localDir: env.UPLOAD_DIR || './uploads',
  },
  sms: { provider: env.SMS_PROVIDER || null }, // 'msg91' | 'twilio' (see services/sms.js)
  requireMobileVerification: env.REQUIRE_MOBILE_VERIFICATION
    ? env.REQUIRE_MOBILE_VERIFICATION === 'true'
    : isProd,
  paymentExpiryMinutes: Number(env.PAYMENT_EXPIRY_MINUTES || 20),
};

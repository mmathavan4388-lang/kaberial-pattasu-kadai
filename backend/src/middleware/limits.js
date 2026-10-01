import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

const mk = (windowMs, limit, extra = {}) =>
  rateLimit({
    windowMs,
    limit: config.isTest ? 10_000 : limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
    ...extra,
  });

// NOTE: in-memory store => per-instance. Use a shared store (Redis) when scaling out.
export const globalLimiter = mk(60_000, 300);
export const authLimiter = mk(15 * 60_000, 20);
export const adminLoginLimiter = mk(15 * 60_000, 5);
export const otpLimiter = mk(60 * 60_000, 5);
export const uploadLimiter = mk(60_000, 20);
export const adminSetupLimiter = mk(15 * 60_000, 5);

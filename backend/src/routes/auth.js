import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { bad, conflict, HttpError, mobileRe, parse, wrap } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { issueSession, clearSession, requireAuth } from '../middleware/auth.js';
import { authLimiter, otpLimiter } from '../middleware/limits.js';
import { checkPassword, hashPassword, DUMMY_HASH } from '../services/password.js';
import { sendOtp } from '../services/sms.js';

export const auth = Router();

export const publicUser = (u) => ({
  id: u.id, role: u.role, name: u.name, email: u.email, mobile: u.mobile,
  mobileVerified: u.mobile_verified, language: u.language, totpEnabled: u.totp_enabled,
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  mobile: z.string().regex(mobileRe),
  email: z.string().trim().toLowerCase().email().max(120).optional(),
  password: z.string().min(8).max(128),
  language: z.enum(['en', 'ta', 'hi']).default('en'),
});

export async function createUser(role, d, q = (t, p) => db.query(t, p)) {
  try {
    const { rows: [u] } = await q(
      `INSERT INTO users (role, name, email, mobile, password_hash, language) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [role, d.name, d.email || null, d.mobile || null, await hashPassword(d.password), d.language || 'en']);
    return u;
  } catch (e) {
    if (e.code === '23505') throw conflict('already_registered');
    throw e;
  }
}

auth.post('/register', authLimiter, wrap(async (req, res) => {
  const d = parse(registerSchema, req.body);
  const u = await createUser('customer', d);
  issueSession(res, u);
  res.status(201).json({ user: publicUser(u) });
}));

auth.post('/login', authLimiter, wrap(async (req, res) => {
  const d = parse(z.object({ identifier: z.string().trim().toLowerCase().max(120), password: z.string().max(128) }), req.body);
  const { rows: [u] } = await db.query(
    `SELECT * FROM users WHERE deleted_at IS NULL AND role <> 'admin' AND (lower(email) = $1 OR mobile = $1)`, [d.identifier]);
  const ok = await checkPassword(d.password, u?.password_hash || DUMMY_HASH);
  if (!u || !ok || u.status !== 'active') {
    throw new HttpError(401, 'invalid_credentials');
  }
  issueSession(res, u);
  res.json({ user: publicUser(u) });
}));

auth.post('/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

auth.post('/logout-all', requireAuth(), wrap(async (req, res) => {
  await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
  await audit(req, 'logout_all', 'user', req.user.id);
  clearSession(res);
  res.json({ ok: true });
}));

auth.get('/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

auth.patch('/me', requireAuth(), wrap(async (req, res) => {
  const d = parse(z.object({ name: z.string().trim().min(2).max(80).optional(), language: z.enum(['en', 'ta', 'hi']).optional() }), req.body);
  const { rows: [u] } = await db.query(
    `UPDATE users SET name = COALESCE($2, name), language = COALESCE($3, language), updated_at = now() WHERE id=$1 RETURNING *`,
    [req.user.id, d.name ?? null, d.language ?? null]);
  res.json({ user: publicUser(u) });
}));

auth.post('/change-password', requireAuth(), authLimiter, wrap(async (req, res) => {
  const d = parse(z.object({ current: z.string().max(128), next: z.string().min(8).max(128) }), req.body);
  const { rows: [u] } = await db.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await checkPassword(d.current, u.password_hash))) throw new HttpError(401, 'invalid_credentials');
  await db.query('UPDATE users SET password_hash=$2, token_version = token_version + 1 WHERE id=$1', [req.user.id, await hashPassword(d.next)]);
  clearSession(res);
  res.json({ ok: true });
}));

// ---- mobile verification (OTP) ----
auth.post('/otp/request', requireAuth(), otpLimiter, wrap(async (req, res) => {
  if (!req.user.mobile) throw bad('no_mobile');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await db.query(
    `INSERT INTO otps (user_id, mobile, code_hash, expires_at) VALUES ($1,$2,$3, now() + interval '10 minutes')`,
    [req.user.id, req.user.mobile, crypto.createHash('sha256').update(code + req.user.id).digest('hex')]);
  await sendOtp(req.user.mobile, code);
  res.json({ ok: true });
}));

auth.post('/otp/verify', requireAuth(), otpLimiter, wrap(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
  const { rows: [o] } = await db.query(
    `SELECT * FROM otps WHERE user_id=$1 AND mobile=$2 AND consumed_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1`,
    [req.user.id, req.user.mobile]);
  if (!o || o.attempts >= 5) throw bad('otp_invalid');
  const hash = crypto.createHash('sha256').update(code + req.user.id).digest('hex');
  if (hash !== o.code_hash) {
    await db.query('UPDATE otps SET attempts = attempts + 1 WHERE id=$1', [o.id]);
    throw bad('otp_invalid');
  }
  await db.query('UPDATE otps SET consumed_at = now() WHERE id=$1', [o.id]);
  await db.query('UPDATE users SET mobile_verified = true WHERE id=$1', [req.user.id]);
  res.json({ ok: true });
}));


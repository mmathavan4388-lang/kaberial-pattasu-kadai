import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { HttpError, wrap } from '../lib/http.js';

const COOKIE = 'mf_session';
// Admin sessions time out quickly (sliding); customers/sellers stay signed in longer.
const TTL = { admin: 30 * 60, seller: 7 * 86400, customer: 30 * 86400 };

export function issueSession(res, user) {
  const ttl = TTL[user.role];
  const token = jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, config.jwtSecret, { expiresIn: ttl });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'strict',
    maxAge: ttl * 1000,
    path: '/',
  });
}
export const clearSession = (res) => res.clearCookie(COOKIE, { path: '/' });

// Populates req.user when a valid session exists. Never trusts the role in the token
// alone: the user row (role, status, token_version) is re-read on every request.
export const loadUser = wrap(async (req, res, next) => {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  try {
    const p = jwt.verify(token, config.jwtSecret);
    const { rows } = await db.query(
      `SELECT id, role, name, email, mobile, mobile_verified, language, status, token_version, totp_enabled
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [p.sub],
    );
    const u = rows[0];
    if (u && u.status === 'active' && u.token_version === p.tv && u.role === p.role) {
      req.user = u;
      // sliding expiry for admin: re-issue once the token is older than 5 minutes
      if (u.role === 'admin' && Date.now() / 1000 - p.iat > 300) issueSession(res, u);
    }
  } catch {
    /* invalid/expired token => anonymous */
  }
  next();
});

export const requireAuth = (...roles) => (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'unauthenticated'));
  if (roles.length && !roles.includes(req.user.role)) return next(new HttpError(403, 'forbidden'));
  next();
};

// CSRF defence in depth on top of SameSite=Strict: state-changing requests must carry
// a custom header, which cross-site forms cannot set.
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/payments/webhook')) return next(); // authenticated by HMAC signature
  if (req.get('x-requested-with') !== 'mavrix') return next(new HttpError(403, 'csrf'));
  next();
}

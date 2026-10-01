import { z } from 'zod';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}
export const bad = (code, msg) => new HttpError(400, code, msg);
export const forbidden = (code = 'forbidden') => new HttpError(403, code);
export const notFound = (code = 'not_found') => new HttpError(404, code);
export const conflict = (code, msg) => new HttpError(409, code, msg);

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Parse + validate a request part with zod; throws a 400 with field details.
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const e = new HttpError(400, 'validation_error', 'Invalid input');
    e.details = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw e;
  }
  return r.data;
}

export const uuid = z.string().uuid();
export const pageParams = (q) => {
  const limit = Math.min(Math.max(parseInt(q.limit) || 20, 1), 50);
  const page = Math.max(parseInt(q.page) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
};
export const mobileRe = /^[6-9]\d{9}$/; // Indian 10-digit mobile
export const money = z.number().int().positive().max(100_000_000);

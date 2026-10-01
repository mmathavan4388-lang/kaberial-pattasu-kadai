import { Router } from 'express';
import express from 'express';
import { db } from '../db/index.js';
import { bad, HttpError, wrap } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/limits.js';
import { saveImage } from '../services/storage.js';
import { markPaid, markPaymentFailed } from '../services/orders.js';
import { razorpay } from '../services/razorpay.js';

export const shared = Router();

// ---- notifications (all roles) ----
shared.get('/notifications', requireAuth(), wrap(async (req, res) => {
  const { rows } = await db.query('SELECT id, type, data, read_at, created_at FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 100', [req.user.id]);
  const { rows: [c] } = await db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [req.user.id]);
  res.json({ notifications: rows, unread: c.n });
}));
shared.post('/notifications/read', requireAuth(), wrap(async (req, res) => {
  await db.query('UPDATE notifications SET read_at = now() WHERE user_id=$1 AND read_at IS NULL', [req.user.id]);
  res.json({ ok: true });
}));

// ---- image upload: raw bytes (image/*), validated + re-encoded server side ----
shared.post('/uploads', requireAuth(), uploadLimiter,
  express.raw({ type: 'image/*', limit: '8mb' }),
  wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('image_required');
    const folder = { seller: 'shops', admin: 'banners', customer: 'support' }[req.user.role];
    res.status(201).json({ url: await saveImage(req.body, folder) });
  }));

// ---- payments ----
// Client callback after UPI checkout. The signature is verified server-side with the secret key.
shared.post('/payments/verify', requireAuth(), wrap(async (req, res) => {
  const { razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: s } = req.body || {};
  if (!o || !p || !s || !razorpay.verifyCheckoutSignature(o, p, s)) throw new HttpError(400, 'invalid_signature');
  const r = await markPaid({ providerOrderId: o, providerPaymentId: p });
  res.json({ ok: true, already: !!r.already });
}));

// Provider webhook: authenticated ONLY by HMAC over the raw body; idempotent by event id.
export const webhook = express.raw({ type: '*/*', limit: '1mb' });
export const webhookHandler = wrap(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!razorpay.verifyWebhookSignature(raw, req.get('x-razorpay-signature'))) throw new HttpError(400, 'invalid_signature');
  const evt = JSON.parse(raw);
  const eventId = req.get('x-razorpay-event-id') || `${evt.event}:${evt.payload?.payment?.entity?.id}`;
  const ins = await db.query('INSERT INTO webhook_events (event_id, type, payload) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [eventId, evt.event, raw]);
  if (!ins.rowCount) return res.json({ ok: true, duplicate: true });
  const pay = evt.payload?.payment?.entity;
  try {
  if (evt.event === 'payment.captured' || evt.event === 'order.paid') {
    const entity = pay || {};
    await markPaid({ providerOrderId: entity.order_id || evt.payload?.order?.entity?.id, providerPaymentId: entity.id, amount: entity.amount, method: entity.method });
  } else if (evt.event === 'payment.failed') {
    await markPaymentFailed({ providerOrderId: pay?.order_id, reason: pay?.error_description });
  } else if (evt.event === 'transfer.processed' || evt.event === 'transfer.failed') {
    const t = evt.payload?.transfer?.entity;
    const id = t?.notes?.sub_order_id;
    if (id) await db.query(`UPDATE sub_orders SET transfer_id=$2, settlement_status=$3 WHERE id=$1 AND settlement_status <> 'reversed'`,
      [id, t.id, evt.event === 'transfer.processed' ? 'settled' : 'failed']);
  }
  } catch (e) {
    // Let the provider retry: forget the event so the retry is processed, not skipped as a duplicate.
    await db.query('DELETE FROM webhook_events WHERE event_id=$1', [eventId]);
    throw e;
  }
  res.json({ ok: true });
});

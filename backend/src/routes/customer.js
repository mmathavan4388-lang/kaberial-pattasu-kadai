import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { bad, conflict, HttpError, mobileRe, notFound, pageParams, parse, uuid, wrap } from '../lib/http.js';
import { notify, notifyAdmin } from '../lib/notify.js';
import { requireAuth } from '../middleware/auth.js';
import { PRODUCT_COLS, PRODUCT_LIVE } from '../lib/sql.js';
import { cancelPaidSubOrder, checkout, paymentForRetry } from '../services/orders.js';
import crypto from 'node:crypto';

export const me = Router();
me.use(requireAuth('customer'));

// ---- cart ----
me.get('/cart', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.qty, ${PRODUCT_COLS}, (${PRODUCT_LIVE}) AS purchasable
       FROM cart_items c JOIN products p ON p.id = c.product_id JOIN shops s ON s.id = p.shop_id
      WHERE c.user_id = $1 ORDER BY c.updated_at DESC`, [req.user.id]);
  res.json({ items: rows });
}));
me.put('/cart/:productId', wrap(async (req, res) => {
  const productId = parse(uuid, req.params.productId);
  const { qty } = parse(z.object({ qty: z.number().int().min(0).max(100) }), req.body);
  if (qty === 0) await db.query('DELETE FROM cart_items WHERE user_id=$1 AND product_id=$2', [req.user.id, productId]);
  else {
    const { rows: [p] } = await db.query(`SELECT p.stock, p.available FROM products p JOIN shops s ON s.id=p.shop_id WHERE p.id=$1 AND ${PRODUCT_LIVE}`, [productId]);
    if (!p) throw notFound('product_unavailable');
    if (!p.available || p.stock < 1) throw conflict('out_of_stock');
    await db.query(
      `INSERT INTO cart_items (user_id, product_id, qty) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, product_id) DO UPDATE SET qty = EXCLUDED.qty, updated_at = now()`, [req.user.id, productId, Math.min(qty, p.stock)]);
  }
  res.json({ ok: true });
}));
me.delete('/cart', wrap(async (req, res) => {
  await db.query('DELETE FROM cart_items WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
}));

// ---- wishlist ----
me.get('/wishlist', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT ${PRODUCT_COLS} FROM wishlist_items w JOIN products p ON p.id=w.product_id JOIN shops s ON s.id=p.shop_id
      WHERE w.user_id=$1 AND ${PRODUCT_LIVE} ORDER BY w.created_at DESC`, [req.user.id]);
  res.json({ products: rows });
}));
me.put('/wishlist/:productId', wrap(async (req, res) => {
  const id = parse(uuid, req.params.productId);
  await db.query('INSERT INTO wishlist_items (user_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, id]);
  res.json({ ok: true });
}));
me.delete('/wishlist/:productId', wrap(async (req, res) => {
  await db.query('DELETE FROM wishlist_items WHERE user_id=$1 AND product_id=$2', [req.user.id, parse(uuid, req.params.productId)]);
  res.json({ ok: true });
}));

// ---- checkout / orders ----
const checkoutSchema = z.object({
  items: z.array(z.object({ productId: uuid, qty: z.number().int().min(1).max(100) })).min(1).max(60),
  fulfilment: z.record(z.enum(['pickup', 'seller_delivery'])).default({}),
  contactName: z.string().trim().min(2).max(80),
  contactMobile: z.string().regex(mobileRe),
  address: z.object({
    line1: z.string().trim().min(3).max(200), city: z.string().trim().min(2).max(60), pincode: z.string().regex(/^\d{6}$/),
  }),
  ageConfirmed: z.literal(true), safetyAck: z.literal(true),
});
me.post('/checkout', wrap(async (req, res) => {
  const d = parse(checkoutSchema, req.body);
  const r = await checkout(req.user, d);
  res.status(201).json(r);
}));
me.post('/orders/:id/pay', wrap(async (req, res) => {
  res.json(await paymentForRetry(req.user, parse(uuid, req.params.id)));
}));

me.get('/orders', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const { rows } = await db.query(
    `SELECT o.id, o.order_no, o.total, o.status, o.created_at,
            (SELECT json_agg(json_build_object('id', so.id, 'status', so.status, 'shop', s.name)) FROM sub_orders so JOIN shops s ON s.id=so.shop_id WHERE so.order_id=o.id) AS parts
       FROM orders o WHERE o.customer_id=$1 AND o.status <> 'expired' ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
    [req.user.id, limit, offset]);
  res.json({ orders: rows });
}));
me.get('/orders/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows: [order] } = await db.query('SELECT * FROM orders WHERE id=$1 AND customer_id=$2', [id, req.user.id]);
  if (!order) throw notFound();
  const { rows: subs } = await db.query(
    `SELECT so.id, so.subtotal, so.fulfilment, so.status, s.id AS shop_id, s.name AS shop_name, s.address AS shop_address, s.mobile AS shop_mobile,
            (SELECT json_agg(oi ORDER BY oi.name) FROM order_items oi WHERE oi.sub_order_id=so.id) AS items,
            (SELECT json_agg(json_build_object('status', e.status, 'at', e.created_at) ORDER BY e.id) FROM order_events e WHERE e.sub_order_id=so.id) AS events
       FROM sub_orders so JOIN shops s ON s.id=so.shop_id WHERE so.order_id=$1`, [id]);
  res.json({ order, subOrders: subs });
}));
// Customer-initiated cancellation is allowed only until the seller starts preparing.
me.post('/sub-orders/:id/cancel', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows: [so] } = await db.query(
    `SELECT so.id FROM sub_orders so JOIN orders o ON o.id=so.order_id WHERE so.id=$1 AND o.customer_id=$2`, [id, req.user.id]);
  if (!so) throw notFound();
  res.json(await cancelPaidSubOrder({ subOrderId: id, actorId: req.user.id, reason: 'customer_cancelled' }));
}));

// ---- reviews ----
me.post('/reviews', wrap(async (req, res) => {
  const d = parse(z.object({
    subOrderId: uuid, productId: uuid, rating: z.number().int().min(1).max(5),
    body: z.string().trim().max(1000).optional(), imageUrl: z.string().max(500).optional(),
  }), req.body);
  // Only for completed purchases by this customer.
  const { rows: [item] } = await db.query(
    `SELECT so.shop_id FROM sub_orders so JOIN orders o ON o.id=so.order_id JOIN order_items oi ON oi.sub_order_id=so.id
      WHERE so.id=$1 AND o.customer_id=$2 AND oi.product_id=$3 AND so.status IN ('completed','delivered')`,
    [d.subOrderId, req.user.id, d.productId]);
  if (!item) throw new HttpError(403, 'review_not_allowed');
  try {
    const { rows: [r] } = await db.query(
      `INSERT INTO reviews (product_id, shop_id, customer_id, sub_order_id, rating, body, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [d.productId, item.shop_id, req.user.id, d.subOrderId, d.rating, d.body || null, d.imageUrl || null]);
    await recomputeRatings(d.productId, item.shop_id);
    res.status(201).json({ id: r.id });
  } catch (e) {
    if (e.code === '23505') throw conflict('already_reviewed');
    throw e;
  }
}));
me.post('/reviews/:id/report', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { reason } = parse(z.object({ reason: z.string().trim().max(300).optional() }), req.body);
  const r = await db.query('INSERT INTO review_reports (review_id, user_id, reason) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, req.user.id, reason || null]);
  if (r.rowCount) await db.query('UPDATE reviews SET report_count = report_count + 1 WHERE id=$1', [id]);
  res.json({ ok: true });
}));

export async function recomputeRatings(productId, shopId) {
  await db.query(
    `UPDATE products SET rating_avg = COALESCE((SELECT round(avg(rating),2) FROM reviews WHERE product_id=$1 AND status='visible'),0),
            rating_count = (SELECT count(*) FROM reviews WHERE product_id=$1 AND status='visible') WHERE id=$1`, [productId]);
  await db.query(
    `UPDATE shops SET rating_avg = COALESCE((SELECT round(avg(rating),2) FROM reviews WHERE shop_id=$1 AND status='visible'),0),
            rating_count = (SELECT count(*) FROM reviews WHERE shop_id=$1 AND status='visible') WHERE id=$1`, [shopId]);
}

// ---- customer care ----
const CATEGORIES = ['order', 'payment', 'product', 'delivery', 'refund', 'seller', 'other'];
me.post('/support/tickets', wrap(async (req, res) => {
  const d = parse(z.object({
    category: z.enum(CATEGORIES), orderNo: z.string().trim().max(30).optional(),
    message: z.string().trim().min(2).max(2000), imageUrl: z.string().max(500).optional(),
  }), req.body);
  const no = 'TK' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(1).toString('hex').toUpperCase();
  const t = await db.tx(async (q) => {
    const { rows: [t] } = await q(
      `INSERT INTO support_tickets (ticket_no, customer_id, category, order_no) VALUES ($1,$2,$3,$4) RETURNING *`,
      [no, req.user.id, d.category, d.orderNo || null]);
    await q(`INSERT INTO support_messages (ticket_id, sender_id, sender_role, body, image_url) VALUES ($1,$2,'customer',$3,$4)`,
      [t.id, req.user.id, d.message, d.imageUrl || null]);
    await notifyAdmin('support_new', { ticketId: t.id, ticketNo: t.ticket_no, category: d.category }, q);
    return t;
  });
  res.status(201).json({ ticket: t });
}));
me.get('/support/tickets', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT t.*, (SELECT body FROM support_messages m WHERE m.ticket_id=t.id ORDER BY id DESC LIMIT 1) AS last_message
       FROM support_tickets t WHERE t.customer_id=$1 ORDER BY t.updated_at DESC LIMIT 100`, [req.user.id]);
  res.json({ tickets: rows });
}));
me.get('/support/tickets/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows: [t] } = await db.query('SELECT * FROM support_tickets WHERE id=$1 AND customer_id=$2', [id, req.user.id]);
  if (!t) throw notFound();
  const { rows: messages } = await db.query('SELECT id, sender_role, body, image_url, created_at FROM support_messages WHERE ticket_id=$1 ORDER BY id', [id]);
  res.json({ ticket: t, messages });
}));
me.post('/support/tickets/:id/messages', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const d = parse(z.object({ message: z.string().trim().min(1).max(2000), imageUrl: z.string().max(500).optional() }), req.body);
  await db.tx(async (q) => {
    const { rows: [t] } = await q('SELECT * FROM support_tickets WHERE id=$1 AND customer_id=$2 FOR UPDATE', [id, req.user.id]);
    if (!t) throw notFound();
    await q(`INSERT INTO support_messages (ticket_id, sender_id, sender_role, body, image_url) VALUES ($1,$2,'customer',$3,$4)`,
      [id, req.user.id, d.message, d.imageUrl || null]);
    await q(`UPDATE support_tickets SET status='open', updated_at=now() WHERE id=$1`, [id]); // customer reply re-opens
    await notifyAdmin('support_new', { ticketId: id, ticketNo: t.ticket_no, category: t.category, reply: true }, q);
  });
  res.status(201).json({ ok: true });
}));

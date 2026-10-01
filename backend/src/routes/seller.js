import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { bad, conflict, HttpError, mobileRe, notFound, pageParams, parse, uuid, wrap } from '../lib/http.js';
import { notifyAdmin } from '../lib/notify.js';
import { issueSession, requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/limits.js';
import { createUser, publicUser } from './auth.js';
import { advanceSubOrder, cancelPaidSubOrder, subscriptionCheckout } from '../services/orders.js';

export const seller = Router();

const registerSchema = z.object({
  shopName: z.string().trim().min(2).max(100),
  ownerName: z.string().trim().min(2).max(100),
  mobile: z.string().regex(mobileRe),
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(8).max(128),
  address: z.string().trim().min(5).max(300),
  businessInfo: z.string().trim().max(2000).optional(),
  photos: z.array(z.string().max(500)).max(8).default([]),
  language: z.enum(['en', 'ta', 'hi']).default('en'),
});

// Public: seller application. No licence / document fields by design. Goes to admin review.
// Bank/settlement details are collected by the payment provider's onboarding, never by this app.
seller.post('/register', authLimiter, wrap(async (req, res) => {
  const d = parse(registerSchema, req.body);
  const shop = await db.tx(async (q) => {
    const u = await createUser('seller', { name: d.ownerName, mobile: d.mobile, email: d.email, password: d.password, language: d.language }, q);
    const { rows: [s] } = await q(
      `INSERT INTO shops (owner_id, name, owner_name, mobile, email, address, business_info, photos, logo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [u.id, d.shopName, d.ownerName, d.mobile, d.email, d.address, d.businessInfo || null, JSON.stringify(d.photos), d.photos[0] || null]);
    await notifyAdmin('seller_registered', { shop: d.shopName, shopId: s.id }, q);
    return { user: u, id: s.id };
  });
  issueSession(res, shop.user);
  res.status(201).json({ user: publicUser(shop.user), shopId: shop.id });
}));

const guard = requireAuth('seller');
const loadShop = wrap(async (req, res, next) => {
  const { rows: [s] } = await db.query('SELECT * FROM shops WHERE owner_id=$1', [req.user.id]);
  if (!s) throw notFound('shop_not_found');
  req.shop = s;
  next();
});
// Everything below is scoped to req.shop.id: a seller can never read or touch another shop's data.
const sellerApi = Router();
sellerApi.use(guard, loadShop);
seller.use(sellerApi);

const requireApproved = (req, res, next) =>
  req.shop.status === 'approved' ? next() : next(new HttpError(403, 'shop_not_approved'));

async function subscriptionOf(shopId) {
  const { rows: [s] } = await db.query(
    `SELECT * FROM shop_subscriptions WHERE shop_id=$1 ORDER BY expires_at DESC LIMIT 1`, [shopId]);
  return s || null;
}

sellerApi.get('/me', wrap(async (req, res) => {
  const sub = await subscriptionOf(req.shop.id);
  const active = !!sub && sub.status === 'active' && new Date(sub.expires_at) > new Date();
  res.json({ shop: req.shop, subscription: sub && { ...sub, active, daysLeft: Math.max(0, Math.ceil((new Date(sub.expires_at) - Date.now()) / 86400000)) } });
}));

sellerApi.patch('/shop', wrap(async (req, res) => {
  const d = parse(z.object({
    name: z.string().trim().min(2).max(100).optional(), ownerName: z.string().trim().min(2).max(100).optional(),
    mobile: z.string().regex(mobileRe).optional(), address: z.string().trim().min(5).max(300).optional(),
    businessInfo: z.string().trim().max(2000).optional(), logoUrl: z.string().max(500).optional(),
    photos: z.array(z.string().max(500)).max(8).optional(), pickupEnabled: z.boolean().optional(),
  }), req.body);
  if (['rejected', 'suspended'].includes(req.shop.status)) throw new HttpError(403, 'shop_locked');
  // A seller asked for changes goes back to review after editing.
  const status = req.shop.status === 'update_required' ? 'pending' : req.shop.status;
  const { rows: [s] } = await db.query(
    `UPDATE shops SET name=COALESCE($2,name), owner_name=COALESCE($3,owner_name), mobile=COALESCE($4,mobile),
            address=COALESCE($5,address), business_info=COALESCE($6,business_info), logo_url=COALESCE($7,logo_url),
            photos=COALESCE($8,photos), pickup_enabled=COALESCE($9,pickup_enabled), status=$10, updated_at=now()
      WHERE id=$1 RETURNING *`,
    [req.shop.id, d.name ?? null, d.ownerName ?? null, d.mobile ?? null, d.address ?? null, d.businessInfo ?? null,
      d.logoUrl ?? null, d.photos ? JSON.stringify(d.photos) : null, d.pickupEnabled ?? null, status]);
  if (status !== req.shop.status) await notifyAdmin('seller_registered', { shop: s.name, shopId: s.id, resubmitted: true });
  res.json({ shop: s });
}));

// ---- subscription (Rs 199 / 6 months) ----
sellerApi.post('/subscription/checkout', wrap(async (req, res) => {
  if (!['approved', 'pending'].includes(req.shop.status) && req.shop.status !== 'update_required') throw new HttpError(403, 'shop_locked');
  if (req.shop.status !== 'approved') throw conflict('shop_not_approved_yet');
  res.status(201).json(await subscriptionCheckout(req.shop));
}));
sellerApi.get('/subscription/history', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT ss.id, ss.amount, ss.starts_at, ss.expires_at, ss.status, p.status AS payment_status
       FROM shop_subscriptions ss LEFT JOIN payments p ON p.id=ss.payment_id WHERE ss.shop_id=$1 ORDER BY ss.starts_at DESC`, [req.shop.id]);
  res.json({ subscriptions: rows });
}));

// ---- products ----
const productSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(3000).optional(),
  categoryId: z.number().int().positive(),
  price: z.number().int().positive().max(100_000_000),
  discountPrice: z.number().int().positive().nullable().optional(),
  packQuantity: z.string().trim().max(60).optional(),
  stock: z.number().int().min(0).max(100000),
  available: z.boolean().default(true),
  images: z.array(z.string().max(500)).min(1).max(8),
  safetyNotes: z.string().trim().max(1000).optional(),
}).refine((d) => d.discountPrice == null || d.discountPrice <= d.price, { message: 'discount_exceeds_price', path: ['discountPrice'] });

const prodCols = `id, name, description, category_id, price, discount_price, pack_quantity, stock, available, status, visible, featured, images, safety_notes, rating_avg, rating_count, sales_count, created_at`;

sellerApi.get('/products', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const { rows } = await db.query(
    `SELECT ${prodCols} FROM products WHERE shop_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [req.shop.id, limit, offset]);
  res.json({ products: rows });
}));
sellerApi.post('/products', requireApproved, wrap(async (req, res) => {
  const d = parse(productSchema, req.body);
  const { rows: [p] } = await db.query(
    `INSERT INTO products (shop_id, category_id, name, description, price, discount_price, pack_quantity, stock, available, images, safety_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${prodCols}`,
    [req.shop.id, d.categoryId, d.name, d.description || null, d.price, d.discountPrice ?? null, d.packQuantity || null,
      d.stock, d.available, JSON.stringify(d.images), d.safetyNotes || null]);
  res.status(201).json({ product: p });
}));
sellerApi.put('/products/:id', requireApproved, wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const d = parse(productSchema, req.body);
  const { rows: [old] } = await db.query('SELECT * FROM products WHERE id=$1 AND shop_id=$2 AND deleted_at IS NULL', [id, req.shop.id]);
  if (!old) throw notFound();
  // Content changes go back through admin moderation; price/stock changes do not.
  const contentChanged = old.name !== d.name || (old.description || '') !== (d.description || '')
    || JSON.stringify(old.images) !== JSON.stringify(d.images) || old.category_id !== d.categoryId;
  const status = old.status === 'removed' ? 'removed' : contentChanged ? 'pending' : old.status;
  const { rows: [p] } = await db.query(
    `UPDATE products SET category_id=$3, name=$4, description=$5, price=$6, discount_price=$7, pack_quantity=$8, stock=$9,
            available=$10, images=$11, safety_notes=$12, status=$13, updated_at=now()
      WHERE id=$1 AND shop_id=$2 RETURNING ${prodCols}`,
    [id, req.shop.id, d.categoryId, d.name, d.description || null, d.price, d.discountPrice ?? null, d.packQuantity || null,
      d.stock, d.available, JSON.stringify(d.images), d.safetyNotes || null, status]);
  res.json({ product: p });
}));
// Quick +/- stock. Atomic and never below zero.
sellerApi.patch('/products/:id/stock', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const d = parse(z.union([z.object({ delta: z.number().int().min(-10000).max(10000) }), z.object({ set: z.number().int().min(0).max(100000) })]), req.body);
  const { rows: [p] } = await db.query(
    `UPDATE products SET stock = GREATEST(0, CASE WHEN $3::int IS NOT NULL THEN $3::int ELSE stock + $4::int END), updated_at = now()
      WHERE id=$1 AND shop_id=$2 AND deleted_at IS NULL RETURNING id, stock`,
    [id, req.shop.id, 'set' in d ? d.set : null, 'delta' in d ? d.delta : 0]);
  if (!p) throw notFound();
  if (p.stock <= 5) await db.query(`INSERT INTO notifications (user_id, type, data) VALUES ($1,'stock_alert',$2)`, [req.user.id, JSON.stringify({ productId: id, stock: p.stock })]);
  res.json({ product: p });
}));
sellerApi.patch('/products/:id/availability', wrap(async (req, res) => {
  const { available } = parse(z.object({ available: z.boolean() }), req.body);
  const r = await db.query('UPDATE products SET available=$3, updated_at=now() WHERE id=$1 AND shop_id=$2 AND deleted_at IS NULL', [parse(uuid, req.params.id), req.shop.id, available]);
  if (!r.rowCount) throw notFound();
  res.json({ ok: true });
}));
sellerApi.delete('/products/:id', wrap(async (req, res) => {
  const r = await db.query('UPDATE products SET deleted_at=now(), updated_at=now() WHERE id=$1 AND shop_id=$2 AND deleted_at IS NULL', [parse(uuid, req.params.id), req.shop.id]);
  if (!r.rowCount) throw notFound();
  res.json({ ok: true });
}));

// ---- orders ----
sellerApi.get('/orders', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const params = [req.shop.id, limit, offset];
  let where = `so.shop_id=$1 AND so.status <> 'pending_payment'`;
  if (req.query.status) { params.push(String(req.query.status)); where += ` AND so.status=$${params.length}`; }
  const { rows } = await db.query(
    `SELECT so.id, so.status, so.subtotal, so.commission, so.settlement, so.fulfilment, so.settlement_status, so.created_at,
            o.order_no, o.contact_name, o.contact_mobile, o.address,
            (SELECT json_agg(json_build_object('name', oi.name, 'qty', oi.qty, 'unit_price', oi.unit_price)) FROM order_items oi WHERE oi.sub_order_id=so.id) AS items
       FROM sub_orders so JOIN orders o ON o.id=so.order_id WHERE ${where} ORDER BY so.created_at DESC LIMIT $2 OFFSET $3`, params);
  res.json({ orders: rows });
}));
sellerApi.patch('/orders/:id/status', wrap(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['accepted', 'preparing', 'ready', 'dispatched', 'out_for_delivery', 'delivered', 'completed']) }), req.body);
  res.json(await advanceSubOrder({ subOrderId: parse(uuid, req.params.id), shopId: req.shop.id, status, actorId: req.user.id }));
}));
sellerApi.post('/orders/:id/cancel', wrap(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(300).optional() }), req.body);
  res.json(await cancelPaidSubOrder({ subOrderId: parse(uuid, req.params.id), shopId: req.shop.id, actorId: req.user.id, reason }));
}));

// ---- sales dashboard ----
sellerApi.get('/dashboard', wrap(async (req, res) => {
  const id = req.shop.id;
  const live = `shop_id=$1 AND status NOT IN ('pending_payment','cancelled')`;
  const [totals, daily, top, pending] = await Promise.all([
    db.query(`SELECT count(*)::int AS orders, COALESCE(sum(subtotal),0) AS gross, COALESCE(sum(commission),0) AS commission,
                     COALESCE(sum(settlement),0) AS net,
                     COALESCE(sum(settlement) FILTER (WHERE settlement_status IN ('released','settled')),0) AS paid_out,
                     COALESCE(sum(settlement) FILTER (WHERE settlement_status IN ('held','pending')),0) AS pending_payout
                FROM sub_orders WHERE ${live}`, [id]),
    db.query(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, sum(subtotal) AS gross, count(*)::int AS orders
                FROM sub_orders WHERE ${live} AND created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`, [id]),
    db.query(`SELECT oi.name, sum(oi.qty)::int AS qty, sum(oi.line_total) AS revenue FROM order_items oi
                JOIN sub_orders so ON so.id=oi.sub_order_id WHERE so.shop_id=$1 AND so.status NOT IN ('pending_payment','cancelled') GROUP BY oi.name ORDER BY revenue DESC LIMIT 5`, [id]),
    db.query(`SELECT count(*)::int AS n FROM sub_orders WHERE shop_id=$1 AND status='placed'`, [id]),
  ]);
  res.json({ totals: totals.rows[0], daily: daily.rows, topProducts: top.rows, newOrders: pending.rows[0].n });
}));
sellerApi.get('/settlements', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const { rows } = await db.query(
    `SELECT so.id, o.order_no, so.subtotal, so.commission, so.commission_bps, so.settlement, so.settlement_status, so.status, so.created_at
       FROM sub_orders so JOIN orders o ON o.id=so.order_id WHERE so.shop_id=$1 AND so.status <> 'pending_payment' ORDER BY so.created_at DESC LIMIT $2 OFFSET $3`,
    [req.shop.id, limit, offset]);
  res.json({ settlements: rows });
}));

// ---- reviews ----
sellerApi.get('/reviews', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.id, r.rating, r.body, r.image_url, r.created_at, p.name AS product_name, u.name AS customer_name
       FROM reviews r JOIN products p ON p.id=r.product_id JOIN users u ON u.id=r.customer_id
      WHERE r.shop_id=$1 AND r.status='visible' ORDER BY r.created_at DESC LIMIT 100`, [req.shop.id]);
  res.json({ reviews: rows });
}));

// ---- offers: sets a time-boxed discount price; reverted automatically on expiry ----
sellerApi.get('/offers', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT o.*, p.name AS product_name FROM offers o JOIN products p ON p.id=o.product_id WHERE o.shop_id=$1 ORDER BY o.created_at DESC LIMIT 100`, [req.shop.id]);
  res.json({ offers: rows });
}));
sellerApi.post('/offers', requireApproved, wrap(async (req, res) => {
  const d = parse(z.object({ productId: uuid, title: z.string().trim().min(2).max(100), percentOff: z.number().int().min(1).max(90),
    endsAt: z.string().datetime() }), req.body);
  if (new Date(d.endsAt) <= new Date()) throw bad('offer_end_in_past');
  const offer = await db.tx(async (q) => {
    const { rows: [p] } = await q('SELECT id, price FROM products WHERE id=$1 AND shop_id=$2 AND deleted_at IS NULL FOR UPDATE', [d.productId, req.shop.id]);
    if (!p) throw notFound();
    await q(`UPDATE offers SET status='ended' WHERE product_id=$1 AND status='active'`, [p.id]);
    await q('UPDATE products SET discount_price=$2, updated_at=now() WHERE id=$1', [p.id, Math.max(1, Math.round((p.price * (100 - d.percentOff)) / 100))]);
    const { rows: [o] } = await q(
      `INSERT INTO offers (shop_id, product_id, title, percent_off, ends_at) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.shop.id, p.id, d.title, d.percentOff, d.endsAt]);
    return o;
  });
  res.status(201).json({ offer });
}));
sellerApi.delete('/offers/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  await db.tx(async (q) => {
    const { rows: [o] } = await q(`UPDATE offers SET status='ended' WHERE id=$1 AND shop_id=$2 AND status='active' RETURNING product_id`, [id, req.shop.id]);
    if (o) await q('UPDATE products SET discount_price=NULL WHERE id=$1', [o.product_id]);
  });
  res.json({ ok: true });
}));

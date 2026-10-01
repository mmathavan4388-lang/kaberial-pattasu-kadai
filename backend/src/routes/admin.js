import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { bad, conflict, HttpError, notFound, pageParams, parse, uuid, wrap } from '../lib/http.js';
import { notify } from '../lib/notify.js';
import { getSettings } from '../lib/settings.js';
import { clearSession, issueSession, requireAuth } from '../middleware/auth.js';
import { adminLoginLimiter, adminSetupLimiter } from '../middleware/limits.js';
import { config } from '../config.js';
import { adminPasswordProblem, checkPassword, DUMMY_HASH, hashPassword } from '../services/password.js';
import * as totp from '../lib/totp.js';
import { publicUser } from './auth.js';
import { recomputeRatings } from './customer.js';
import { cancelPaidSubOrder } from '../services/orders.js';
import { razorpay } from '../services/razorpay.js';

export const admin = Router();

// ===== First Admin Setup (one-time) ==========================================================
// There is no public admin registration. The owner claims the single admin account once, using
// the ADMIN_SETUP_TOKEN secret they set on the server at deploy time. After that the endpoint is
// permanently disabled (settings.first_admin_done) AND the database enforces a single admin row.
admin.get('/setup/status', wrap(async (req, res) => {
  const s = await getSettings();
  res.json({ setupAvailable: s.first_admin_done !== true && !!config.adminSetupToken });
}));

const sameSecret = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

admin.post('/setup', adminSetupLimiter, wrap(async (req, res) => {
  const d = parse(z.object({
    email: z.string().trim().toLowerCase().email().max(120),
    password: z.string().max(128), confirmPassword: z.string().max(128), setupToken: z.string().max(200),
  }), req.body);
  const s = await getSettings();
  if (s.first_admin_done === true) throw notFound(); // permanently disabled
  if (!config.adminSetupToken) throw new HttpError(503, 'setup_token_not_configured');
  if (!sameSecret(d.setupToken, config.adminSetupToken)) throw new HttpError(403, 'invalid_setup_token');
  if (d.password !== d.confirmPassword) throw bad('passwords_do_not_match');
  const problem = adminPasswordProblem(d.password, d.email);
  if (problem) throw bad(problem);
  await db.tx(async (q) => {
    const { rows: [flag] } = await q(`SELECT value FROM settings WHERE key='first_admin_done' FOR UPDATE`);
    if (flag.value === true) throw notFound();
    try {
      await q(`INSERT INTO users (role, name, email, password_hash, mobile_verified) VALUES ('admin','Admin',$1,$2,true)`,
        [d.email, await hashPassword(d.password)]);
    } catch (e) {
      if (e.code === '23505') throw notFound(); // an admin already exists
      throw e;
    }
    await q(`UPDATE settings SET value='true', updated_at=now() WHERE key='first_admin_done'`);
    await audit(req, 'first_admin_created', 'user', null, { email: d.email }, q);
  });
  res.status(201).json({ ok: true });
}));

admin.post('/login', adminLoginLimiter, wrap(async (req, res) => {
  const d = parse(z.object({ email: z.string().trim().toLowerCase().max(120), password: z.string().max(128), otp: z.string().optional() }), req.body);
  const { rows: [u] } = await db.query(`SELECT * FROM users WHERE role='admin' AND lower(email)=$1 AND deleted_at IS NULL`, [d.email]);
  const ok = await checkPassword(d.password, u?.password_hash || DUMMY_HASH);
  if (!u || !ok) {
    await audit({ ip: req.ip }, 'admin_login_failed', 'user', null, { email: d.email });
    throw new HttpError(401, 'invalid_credentials');
  }
  if (u.totp_enabled && !(d.otp && totp.verify(u.totp_secret, d.otp))) {
    if (!d.otp) return res.status(401).json({ error: 'otp_required' });
    await audit({ ip: req.ip }, 'admin_otp_failed', 'user', u.id);
    throw new HttpError(401, 'invalid_credentials');
  }
  issueSession(res, u);
  await audit({ ...req, user: u }, 'admin_login', 'user', u.id);
  res.json({ user: publicUser(u) });
}));

// ===== Everything below: admin only, verified server-side on every request ==================
const api = Router();
api.use(requireAuth('admin'));
admin.use(api);

api.post('/2fa/setup', wrap(async (req, res) => {
  const secret = totp.newSecret();
  await db.query('UPDATE users SET totp_secret=$2, totp_enabled=false WHERE id=$1', [req.user.id, secret]);
  res.json({ secret, otpauthUrl: totp.otpauthUrl(secret, req.user.email) });
}));
api.post('/2fa/enable', wrap(async (req, res) => {
  const { code } = parse(z.object({ code: z.string() }), req.body);
  const { rows: [u] } = await db.query('SELECT totp_secret FROM users WHERE id=$1', [req.user.id]);
  if (!u.totp_secret || !totp.verify(u.totp_secret, code)) throw bad('otp_invalid');
  await db.query('UPDATE users SET totp_enabled=true WHERE id=$1', [req.user.id]);
  await audit(req, '2fa_enabled', 'user', req.user.id);
  res.json({ ok: true });
}));

// ---- analytics ----
api.get('/dashboard', wrap(async (req, res) => {
  const one = async (sql) => (await db.query(sql)).rows[0];
  const [c, s, p, o, pay, sup, subs] = await Promise.all([
    one(`SELECT count(*)::int AS n FROM users WHERE role='customer' AND deleted_at IS NULL`),
    one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='approved' AND EXISTS (SELECT 1 FROM shop_subscriptions ss WHERE ss.shop_id=shops.id AND ss.status='active' AND ss.expires_at>now()))::int AS active FROM shops`),
    one(`SELECT count(*)::int AS n FROM products WHERE deleted_at IS NULL`),
    one(`SELECT (SELECT count(*)::int FROM orders) AS total, (SELECT count(*)::int FROM orders WHERE status='paid') AS successful`),
    one(`SELECT COALESCE(sum(subtotal),0) AS sales, COALESCE(sum(commission),0) AS commission,
                COALESCE(sum(settlement) FILTER (WHERE settlement_status IN ('released','settled')),0) AS settled,
                COALESCE(sum(settlement) FILTER (WHERE settlement_status IN ('held','pending')),0) AS pending_settlement
           FROM sub_orders WHERE status NOT IN ('pending_payment','cancelled')`),
    one(`SELECT count(*) FILTER (WHERE status IN ('open','pending'))::int AS open, count(*) FILTER (WHERE status='resolved')::int AS resolved FROM support_tickets`),
    one(`SELECT COALESCE(sum(amount),0) AS revenue FROM payments WHERE purpose='subscription' AND status='paid'`),
  ]);
  const daily = (await db.query(
    `SELECT to_char(date_trunc('day', created_at),'YYYY-MM-DD') AS day, sum(subtotal) AS sales, sum(commission) AS commission
       FROM sub_orders WHERE status NOT IN ('pending_payment','cancelled') AND created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`)).rows;
  res.json({ customers: c.n, sellers: s.total, activeSellers: s.active, products: p.n, orders: o.total, successfulOrders: o.successful,
    totalSales: pay.sales, commission: pay.commission, settled: pay.settled, pendingSettlement: pay.pending_settlement,
    subscriptionRevenue: subs.revenue, openTickets: sup.open, resolvedTickets: sup.resolved, daily });
}));

// ---- sellers ----
api.get('/sellers', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const params = [limit, offset];
  let where = 'TRUE';
  if (req.query.status) { params.push(String(req.query.status)); where = `s.status=$${params.length}`; }
  const { rows } = await db.query(
    `SELECT s.*, (SELECT max(expires_at) FROM shop_subscriptions ss WHERE ss.shop_id=s.id AND ss.status='active') AS subscription_expires,
            (SELECT count(*)::int FROM products p WHERE p.shop_id=s.id AND p.deleted_at IS NULL) AS product_count
       FROM shops s WHERE ${where} ORDER BY (s.status='pending') DESC, s.created_at DESC LIMIT $1 OFFSET $2`, params);
  res.json({ sellers: rows });
}));
api.get('/sellers/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows: [shop] } = await db.query('SELECT s.*, u.email AS owner_email FROM shops s JOIN users u ON u.id=s.owner_id WHERE s.id=$1', [id]);
  if (!shop) throw notFound();
  const [products, orders, sales, subs] = await Promise.all([
    db.query(`SELECT id, name, price, stock, status, visible FROM products WHERE shop_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`, [id]),
    db.query(`SELECT so.id, o.order_no, so.status, so.subtotal, so.commission, so.settlement, so.settlement_status, so.created_at FROM sub_orders so JOIN orders o ON o.id=so.order_id WHERE so.shop_id=$1 ORDER BY so.created_at DESC LIMIT 50`, [id]),
    db.query(`SELECT COALESCE(sum(subtotal),0) AS sales, COALESCE(sum(commission),0) AS commission, COALESCE(sum(settlement),0) AS settlement FROM sub_orders WHERE shop_id=$1 AND status NOT IN ('pending_payment','cancelled')`, [id]),
    db.query(`SELECT ss.*, p.status AS payment_status FROM shop_subscriptions ss LEFT JOIN payments p ON p.id=ss.payment_id WHERE ss.shop_id=$1 ORDER BY starts_at DESC`, [id]),
  ]);
  res.json({ shop, products: products.rows, orders: orders.rows, sales: sales.rows[0], subscriptions: subs.rows });
}));
const STATUS_NOTIFY = { approved: 'seller_approved', rejected: 'seller_rejected', update_required: 'seller_update_required', suspended: 'seller_suspended' };
api.post('/sellers/:id/status', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const d = parse(z.object({ status: z.enum(['approved', 'rejected', 'update_required', 'suspended']), note: z.string().trim().max(500).optional() }), req.body);
  if (['rejected', 'update_required'].includes(d.status) && !d.note) throw bad('note_required');
  const { rows: [s] } = await db.query('UPDATE shops SET status=$2, status_note=$3, updated_at=now() WHERE id=$1 RETURNING owner_id, name', [id, d.status, d.note || null]);
  if (!s) throw notFound();
  await notify(s.owner_id, STATUS_NOTIFY[d.status], { note: d.note || null });
  await audit(req, `seller_${d.status}`, 'shop', id, { note: d.note });
  res.json({ ok: true });
}));
api.patch('/sellers/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const d = parse(z.object({ razorpayAccountId: z.string().trim().regex(/^acc_[A-Za-z0-9]+$/).nullable().optional(),
    deliveryEnabled: z.boolean().optional(), verified: z.boolean().optional() }), req.body);
  const { rows: [s] } = await db.query(
    `UPDATE shops SET razorpay_account_id = CASE WHEN $2::boolean THEN $3 ELSE razorpay_account_id END,
            delivery_enabled=COALESCE($4,delivery_enabled), verified=COALESCE($5,verified), updated_at=now() WHERE id=$1 RETURNING id`,
    [id, 'razorpayAccountId' in d, d.razorpayAccountId ?? null, d.deliveryEnabled ?? null, d.verified ?? null]);
  if (!s) throw notFound();
  await audit(req, 'seller_updated', 'shop', id, d);
  res.json({ ok: true });
}));
// Create the Razorpay Route linked account; the seller then completes bank/KYC on Razorpay's hosted onboarding.
api.post('/sellers/:id/onboard', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows: [s] } = await db.query('SELECT * FROM shops WHERE id=$1', [id]);
  if (!s) throw notFound();
  if (s.razorpay_account_id) throw conflict('already_onboarded');
  const acc = await razorpay.createLinkedAccount({
    email: s.email, phone: s.mobile, type: 'route', legal_business_name: s.name, business_type: 'individual',
    contact_name: s.owner_name, profile: { category: 'ecommerce', subcategory: 'marketplace',
      addresses: { registered: { street1: s.address.slice(0, 100), street2: '-', city: s.city, state: 'TAMIL NADU', postal_code: '626123', country: 'IN' } } },
  });
  await db.query('UPDATE shops SET razorpay_account_id=$2 WHERE id=$1', [id, acc.id]);
  await audit(req, 'seller_onboarded', 'shop', id, { account: acc.id });
  res.json({ accountId: acc.id });
}));

// ---- customers ----
api.get('/customers', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.mobile, u.status, u.mobile_verified, u.created_at,
            (SELECT count(*)::int FROM orders o WHERE o.customer_id=u.id) AS orders
       FROM users u WHERE u.role='customer' AND u.deleted_at IS NULL ORDER BY u.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  res.json({ customers: rows });
}));
api.post('/customers/:id/status', wrap(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['active', 'blocked']) }), req.body);
  const id = parse(uuid, req.params.id);
  const r = await db.query(`UPDATE users SET status=$2, token_version=token_version+1 WHERE id=$1 AND role='customer'`, [id, status]);
  if (!r.rowCount) throw notFound();
  await audit(req, `customer_${status}`, 'user', id);
  res.json({ ok: true });
}));

// ---- products & categories ----
api.get('/products', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const params = [limit, offset];
  let where = 'p.deleted_at IS NULL';
  if (req.query.status) { params.push(String(req.query.status)); where += ` AND p.status=$${params.length}`; }
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.price, p.discount_price, p.stock, p.status, p.visible, p.featured, p.images, s.name AS shop_name, c.name_en AS category
       FROM products p JOIN shops s ON s.id=p.shop_id LEFT JOIN categories c ON c.id=p.category_id
      WHERE ${where} ORDER BY (p.status='pending') DESC, p.created_at DESC LIMIT $1 OFFSET $2`, params);
  res.json({ products: rows });
}));
api.patch('/products/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const d = parse(z.object({ status: z.enum(['approved', 'removed']).optional(), visible: z.boolean().optional(), featured: z.boolean().optional() }), req.body);
  const r = await db.query(`UPDATE products SET status=COALESCE($2,status), visible=COALESCE($3,visible), featured=COALESCE($4,featured), updated_at=now() WHERE id=$1 AND deleted_at IS NULL`,
    [id, d.status ?? null, d.visible ?? null, d.featured ?? null]);
  if (!r.rowCount) throw notFound();
  await audit(req, 'product_updated', 'product', id, d);
  res.json({ ok: true });
}));

api.get('/categories', wrap(async (req, res) => {
  res.json({ categories: (await db.query('SELECT * FROM categories ORDER BY sort_order, id')).rows });
}));
const catSchema = z.object({ slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(60), nameEn: z.string().trim().min(1).max(60),
  nameTa: z.string().trim().min(1).max(60), nameHi: z.string().trim().min(1).max(60), sortOrder: z.number().int().default(0), active: z.boolean().default(true) });
api.post('/categories', wrap(async (req, res) => {
  const d = parse(catSchema, req.body);
  try {
    const { rows: [c] } = await db.query('INSERT INTO categories (slug,name_en,name_ta,name_hi,sort_order,active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [d.slug, d.nameEn, d.nameTa, d.nameHi, d.sortOrder, d.active]);
    await audit(req, 'category_created', 'category', c.id);
    res.status(201).json({ category: c });
  } catch (e) { if (e.code === '23505') throw conflict('slug_exists'); throw e; }
}));
api.put('/categories/:id', wrap(async (req, res) => {
  const d = parse(catSchema, req.body);
  const { rows: [c] } = await db.query('UPDATE categories SET slug=$2,name_en=$3,name_ta=$4,name_hi=$5,sort_order=$6,active=$7 WHERE id=$1 RETURNING *',
    [parseInt(req.params.id), d.slug, d.nameEn, d.nameTa, d.nameHi, d.sortOrder, d.active]);
  if (!c) throw notFound();
  await audit(req, 'category_updated', 'category', c.id);
  res.json({ category: c });
}));

// ---- orders / payments / commissions / subscriptions / settlements / refunds ----
api.get('/orders', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const { rows } = await db.query(
    `SELECT so.id, o.order_no, o.total, o.status AS order_status, so.status, so.subtotal, so.commission, so.settlement, so.settlement_status,
            so.fulfilment, s.name AS shop_name, u.name AS customer_name, u.mobile AS customer_mobile, so.created_at
       FROM sub_orders so JOIN orders o ON o.id=so.order_id JOIN shops s ON s.id=so.shop_id JOIN users u ON u.id=o.customer_id
      ORDER BY so.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  res.json({ orders: rows });
}));
api.get('/payments', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const { rows } = await db.query(
    `SELECT p.id, p.purpose, p.provider_order_id, p.provider_payment_id, p.amount, p.status, p.method, p.failure_reason, p.created_at, p.paid_at, o.order_no, s.name AS shop_name
       FROM payments p LEFT JOIN orders o ON o.id=p.order_id LEFT JOIN shops s ON s.id=p.shop_id ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  res.json({ payments: rows });
}));
api.get('/commissions', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.id AS shop_id, s.name AS shop_name, count(*)::int AS orders, sum(so.subtotal) AS gross, sum(so.commission) AS commission, sum(so.settlement) AS settlement
       FROM sub_orders so JOIN shops s ON s.id=so.shop_id WHERE so.status NOT IN ('pending_payment','cancelled') GROUP BY s.id, s.name ORDER BY gross DESC`);
  res.json({ commissions: rows });
}));
api.get('/subscriptions', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT ss.id, s.name AS shop_name, ss.amount, ss.starts_at, ss.expires_at, ss.status, p.status AS payment_status,
            EXISTS (SELECT 1 FROM shop_subscriptions n WHERE n.shop_id=ss.shop_id AND n.starts_at >= ss.expires_at) AS renewed
       FROM shop_subscriptions ss JOIN shops s ON s.id=ss.shop_id LEFT JOIN payments p ON p.id=ss.payment_id ORDER BY ss.expires_at DESC LIMIT 200`);
  res.json({ subscriptions: rows });
}));
api.get('/settlements', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const { rows } = await db.query(
    `SELECT so.id, o.order_no, s.name AS shop_name, so.settlement, so.commission, so.settlement_status, so.transfer_id, so.status, so.created_at
       FROM sub_orders so JOIN orders o ON o.id=so.order_id JOIN shops s ON s.id=so.shop_id WHERE so.status <> 'pending_payment' ORDER BY so.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  res.json({ settlements: rows });
}));
api.get('/refunds', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.*, o.order_no FROM refunds r JOIN sub_orders so ON so.id=r.sub_order_id JOIN orders o ON o.id=so.order_id ORDER BY r.created_at DESC LIMIT 200`);
  res.json({ refunds: rows });
}));
// Admin-initiated cancellation + refund of a paid seller sub-order (e.g. from a support case).
api.post('/sub-orders/:id/cancel', wrap(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(300).optional() }), req.body);
  const r = await cancelPaidSubOrder({ subOrderId: parse(uuid, req.params.id), actorId: req.user.id, reason });
  await audit(req, 'sub_order_cancelled_refunded', 'sub_order', req.params.id, { reason });
  res.json(r);
}));

// ---- customer support inbox ----
api.get('/support/tickets', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const params = [limit, offset];
  let where = 'TRUE';
  if (req.query.status) { params.push(String(req.query.status)); where = `t.status=$${params.length}`; }
  const { rows } = await db.query(
    `SELECT t.id, t.ticket_no, t.category, t.order_no, t.status, t.created_at, t.updated_at, u.name AS customer_name, u.mobile AS customer_mobile, u.email AS customer_email,
            (SELECT body FROM support_messages m WHERE m.ticket_id=t.id ORDER BY id DESC LIMIT 1) AS last_message
       FROM support_tickets t JOIN users u ON u.id=t.customer_id WHERE ${where} ORDER BY (t.status='open') DESC, t.updated_at DESC LIMIT $1 OFFSET $2`, params);
  res.json({ tickets: rows });
}));
api.get('/support/tickets/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows: [t] } = await db.query(
    `SELECT t.*, u.name AS customer_name, u.mobile AS customer_mobile, u.email AS customer_email FROM support_tickets t JOIN users u ON u.id=t.customer_id WHERE t.id=$1`, [id]);
  if (!t) throw notFound();
  const { rows: messages } = await db.query('SELECT id, sender_role, body, image_url, created_at FROM support_messages WHERE ticket_id=$1 ORDER BY id', [id]);
  res.json({ ticket: t, messages });
}));
api.post('/support/tickets/:id/reply', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const d = parse(z.object({ message: z.string().trim().min(1).max(2000), status: z.enum(['open', 'pending', 'resolved']).default('pending') }), req.body);
  await db.tx(async (q) => {
    const { rows: [t] } = await q('SELECT * FROM support_tickets WHERE id=$1 FOR UPDATE', [id]);
    if (!t) throw notFound();
    await q(`INSERT INTO support_messages (ticket_id, sender_id, sender_role, body) VALUES ($1,$2,'admin',$3)`, [id, req.user.id, d.message]);
    await q('UPDATE support_tickets SET status=$2, updated_at=now() WHERE id=$1', [id, d.status]);
    await notify(t.customer_id, 'support_reply', { ticketId: id, ticketNo: t.ticket_no }, q);
  });
  res.status(201).json({ ok: true });
}));
api.patch('/support/tickets/:id', wrap(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['open', 'pending', 'resolved']) }), req.body);
  const r = await db.query('UPDATE support_tickets SET status=$2, updated_at=now() WHERE id=$1', [parse(uuid, req.params.id), status]);
  if (!r.rowCount) throw notFound();
  res.json({ ok: true });
}));

// ---- reviews moderation ----
api.get('/reviews', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const { rows } = await db.query(
    `SELECT r.id, r.rating, r.body, r.status, r.report_count, r.created_at, p.name AS product_name, s.name AS shop_name, u.name AS customer_name
       FROM reviews r JOIN products p ON p.id=r.product_id JOIN shops s ON s.id=r.shop_id JOIN users u ON u.id=r.customer_id
      ORDER BY r.report_count DESC, r.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  res.json({ reviews: rows });
}));
api.post('/reviews/:id/status', wrap(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['visible', 'removed']) }), req.body);
  const { rows: [r] } = await db.query('UPDATE reviews SET status=$2 WHERE id=$1 RETURNING product_id, shop_id', [parse(uuid, req.params.id), status]);
  if (!r) throw notFound();
  await recomputeRatings(r.product_id, r.shop_id);
  await audit(req, `review_${status}`, 'review', req.params.id);
  res.json({ ok: true });
}));

// ---- offers / banners ----
api.get('/offers', wrap(async (req, res) => {
  res.json({ offers: (await db.query(`SELECT o.*, p.name AS product_name, s.name AS shop_name FROM offers o JOIN products p ON p.id=o.product_id JOIN shops s ON s.id=o.shop_id ORDER BY o.created_at DESC LIMIT 200`)).rows });
}));
api.post('/offers/:id/disable', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  await db.tx(async (q) => {
    const { rows: [o] } = await q(`UPDATE offers SET status='disabled' WHERE id=$1 AND status='active' RETURNING product_id`, [id]);
    if (o) await q('UPDATE products SET discount_price=NULL WHERE id=$1', [o.product_id]);
  });
  await audit(req, 'offer_disabled', 'offer', id);
  res.json({ ok: true });
}));
const bannerSchema = z.object({ title: z.string().trim().min(1).max(120), subtitle: z.string().trim().max(200).optional(),
  imageUrl: z.string().max(500).optional(), link: z.string().max(300).optional(), sortOrder: z.number().int().default(0), active: z.boolean().default(true) });
api.get('/banners', wrap(async (req, res) => res.json({ banners: (await db.query('SELECT * FROM banners ORDER BY sort_order, id')).rows })));
api.post('/banners', wrap(async (req, res) => {
  const d = parse(bannerSchema, req.body);
  const { rows: [b] } = await db.query('INSERT INTO banners (title,subtitle,image_url,link,sort_order,active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [d.title, d.subtitle || null, d.imageUrl || null, d.link || null, d.sortOrder, d.active]);
  await audit(req, 'banner_created', 'banner', b.id);
  res.status(201).json({ banner: b });
}));
api.put('/banners/:id', wrap(async (req, res) => {
  const d = parse(bannerSchema, req.body);
  const { rows: [b] } = await db.query('UPDATE banners SET title=$2,subtitle=$3,image_url=$4,link=$5,sort_order=$6,active=$7 WHERE id=$1 RETURNING *', [parseInt(req.params.id), d.title, d.subtitle || null, d.imageUrl || null, d.link || null, d.sortOrder, d.active]);
  if (!b) throw notFound();
  res.json({ banner: b });
}));
api.delete('/banners/:id', wrap(async (req, res) => {
  await db.query('DELETE FROM banners WHERE id=$1', [parseInt(req.params.id)]);
  await audit(req, 'banner_deleted', 'banner', req.params.id);
  res.json({ ok: true });
}));

// ---- broadcast notification ----
api.post('/notifications/broadcast', wrap(async (req, res) => {
  const d = parse(z.object({ audience: z.enum(['customers', 'sellers']), title: z.string().trim().min(1).max(100), message: z.string().trim().min(1).max(400) }), req.body);
  const role = d.audience === 'customers' ? 'customer' : 'seller';
  const r = await db.query(`INSERT INTO notifications (user_id, type, data) SELECT id, $2, $3 FROM users WHERE role=$1 AND status='active' AND deleted_at IS NULL`,
    [role, role === 'customer' ? 'offer_broadcast' : 'admin_message', JSON.stringify({ title: d.title, message: d.message })]);
  await audit(req, 'broadcast', 'notification', null, { audience: d.audience, count: r.rowCount });
  res.json({ sent: r.rowCount });
}));

// ---- settings & audit ----
api.get('/settings', wrap(async (req, res) => res.json({ settings: await getSettings() })));
api.put('/settings', wrap(async (req, res) => {
  const d = parse(z.object({
    commission_bps: z.number().int().min(0).max(5000).optional(), subscription_amount: z.number().int().min(100).max(10_000_000).optional(),
    subscription_months: z.number().int().min(1).max(36).optional(), allowed_cities: z.array(z.string().trim().min(2).max(60)).min(1).max(50).optional(),
    min_age: z.number().int().min(18).max(99).optional(),
  }), req.body);
  for (const [k, v] of Object.entries(d)) {
    await db.query(`INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [k, JSON.stringify(v)]);
  }
  await audit(req, 'settings_updated', 'settings', null, d); // applies to future orders only
  res.json({ settings: await getSettings() });
}));
api.get('/audit-logs', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  res.json({ logs: (await db.query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT $1 OFFSET $2', [limit, offset])).rows });
}));

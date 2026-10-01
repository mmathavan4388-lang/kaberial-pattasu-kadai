import { Router } from 'express';
import { db } from '../db/index.js';
import { notFound, pageParams, parse, uuid, wrap } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import { PRODUCT_COLS, PRODUCT_LIVE, SHOP_LIVE } from '../lib/sql.js';

export const pub = Router();
const cache = (s) => (req, res, next) => { res.set('Cache-Control', `public, max-age=${s}`); next(); };

pub.get('/config', cache(60), wrap(async (req, res) => {
  const s = await getSettings();
  res.json({ allowedCities: s.allowed_cities, minAge: s.min_age, subscriptionAmount: s.subscription_amount,
    subscriptionMonths: s.subscription_months, commissionBps: s.commission_bps });
}));

pub.get('/categories', cache(60), wrap(async (req, res) => {
  const { rows } = await db.query('SELECT id, slug, name_en, name_ta, name_hi FROM categories WHERE active ORDER BY sort_order, id');
  res.json({ categories: rows });
}));

const SHOP_COLS = `s.id, s.name, s.city, s.address, s.logo_url, s.photos, s.verified, s.rating_avg, s.rating_count,
  s.delivery_enabled, s.pickup_enabled`;

// One round-trip for the whole home screen.
pub.get('/home', cache(30), wrap(async (req, res) => {
  const lim = (order, where = '') => db.query(
    `SELECT ${PRODUCT_COLS} FROM products p JOIN shops s ON s.id = p.shop_id WHERE ${PRODUCT_LIVE} ${where} ORDER BY ${order} LIMIT 10`);
  const [banners, categories, shops, trending, popular, fresh, offers, verified] = await Promise.all([
    db.query('SELECT id, title, subtitle, image_url, link FROM banners WHERE active ORDER BY sort_order, id'),
    db.query('SELECT id, slug, name_en, name_ta, name_hi FROM categories WHERE active ORDER BY sort_order, id'),
    db.query(`SELECT ${SHOP_COLS} FROM shops s WHERE ${SHOP_LIVE} ORDER BY s.rating_avg DESC, s.created_at DESC LIMIT 10`),
    lim('p.sales_count DESC, p.created_at DESC', 'AND p.featured'),
    lim('p.rating_count DESC, p.sales_count DESC'),
    lim('p.created_at DESC'),
    db.query(`SELECT ${PRODUCT_COLS}, o.percent_off, o.title AS offer_title, o.ends_at FROM offers o
               JOIN products p ON p.id = o.product_id JOIN shops s ON s.id = p.shop_id
              WHERE o.status='active' AND o.ends_at > now() AND ${PRODUCT_LIVE} ORDER BY o.ends_at LIMIT 10`),
    db.query(`SELECT ${SHOP_COLS} FROM shops s WHERE ${SHOP_LIVE} AND s.verified ORDER BY s.rating_avg DESC LIMIT 10`),
  ]);
  res.json({ banners: banners.rows, categories: categories.rows, featuredShops: shops.rows, trending: trending.rows,
    popular: popular.rows, newArrivals: fresh.rows, offers: offers.rows, verifiedShops: verified.rows });
}));

const SORTS = {
  new: 'p.created_at DESC', popular: 'p.sales_count DESC, p.created_at DESC',
  price_asc: 'COALESCE(p.discount_price, p.price) ASC', price_desc: 'COALESCE(p.discount_price, p.price) DESC',
  rating: 'p.rating_avg DESC, p.rating_count DESC',
};

// Fast search: full-text prefix match on the GIN index, falling back to name ILIKE.
function searchClause(q, params) {
  const terms = (q.match(/[\p{L}\p{N}]+/gu) || []).slice(0, 6);
  if (!terms.length) return '';
  params.push(terms.map((t) => `${t}:*`).join(' & '));
  const a = params.length;
  params.push(`%${q.replace(/[%_\\]/g, '\\$&').slice(0, 60)}%`);
  return ` AND (p.search @@ to_tsquery('simple', $${a}) OR p.name ILIKE $${params.length})`;
}

pub.get('/products', cache(15), wrap(async (req, res) => {
  const { limit, offset, page } = pageParams(req.query);
  const params = [];
  let where = PRODUCT_LIVE;
  if (req.query.q) where += searchClause(String(req.query.q), params);
  if (req.query.category) { params.push(parseInt(req.query.category) || 0); where += ` AND p.category_id = $${params.length}`; }
  if (req.query.shop && /^[0-9a-f-]{36}$/.test(req.query.shop)) { params.push(req.query.shop); where += ` AND p.shop_id = $${params.length}`; }
  if (req.query.inStock === 'true') where += ' AND p.available AND p.stock > 0';
  const min = parseInt(req.query.min), max = parseInt(req.query.max);
  if (min > 0) { params.push(min); where += ` AND COALESCE(p.discount_price, p.price) >= $${params.length}`; }
  if (max > 0) { params.push(max); where += ` AND COALESCE(p.discount_price, p.price) <= $${params.length}`; }
  params.push(limit + 1, offset);
  const { rows } = await db.query(
    `SELECT ${PRODUCT_COLS} FROM products p JOIN shops s ON s.id = p.shop_id WHERE ${where}
      ORDER BY ${SORTS[req.query.sort] || SORTS.popular}, p.id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ products: rows.slice(0, limit), page, hasMore: rows.length > limit });
}));

pub.get('/products/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows: [p] } = await db.query(
    `SELECT ${PRODUCT_COLS}, p.description, p.safety_notes, p.category_id,
            s.city AS shop_city, s.address AS shop_address, s.delivery_enabled, s.pickup_enabled, s.logo_url AS shop_logo
       FROM products p JOIN shops s ON s.id = p.shop_id WHERE p.id = $1 AND ${PRODUCT_LIVE}`, [id]);
  if (!p) throw notFound();
  res.json({ product: p });
}));

// Compare the same/similar product across sellers (same category + similar name).
pub.get('/products/:id/compare', cache(30), wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows } = await db.query(
    `SELECT ${PRODUCT_COLS} FROM products p JOIN shops s ON s.id = p.shop_id,
            (SELECT category_id, name FROM products WHERE id = $1) base
      WHERE ${PRODUCT_LIVE} AND p.id <> $1 AND p.category_id = base.category_id
        AND (lower(p.name) = lower(base.name) OR p.search @@ plainto_tsquery('simple', base.name))
      ORDER BY COALESCE(p.discount_price, p.price) LIMIT 10`, [id]);
  res.json({ products: rows });
}));

pub.get('/products/:id/reviews', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { limit, offset } = pageParams(req.query);
  const { rows } = await db.query(
    `SELECT r.id, r.rating, r.body, r.image_url, r.created_at, u.name AS customer_name
       FROM reviews r JOIN users u ON u.id = r.customer_id
      WHERE r.product_id = $1 AND r.status = 'visible' ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`, [id, limit, offset]);
  res.json({ reviews: rows });
}));

pub.get('/shops', cache(30), wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const { rows } = await db.query(
    `SELECT ${SHOP_COLS} FROM shops s WHERE ${SHOP_LIVE} ORDER BY s.verified DESC, s.rating_avg DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  res.json({ shops: rows });
}));

pub.get('/shops/:id', wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows: [shop] } = await db.query(
    `SELECT ${SHOP_COLS}, s.business_info FROM shops s WHERE s.id = $1 AND ${SHOP_LIVE}`, [id]);
  if (!shop) throw notFound();
  const [offers, reviews] = await Promise.all([
    db.query(`SELECT o.id, o.title, o.percent_off, o.ends_at, o.product_id FROM offers o
               WHERE o.shop_id=$1 AND o.status='active' AND o.ends_at > now()`, [id]),
    db.query(`SELECT r.id, r.rating, r.body, r.created_at, u.name AS customer_name, p.name AS product_name
               FROM reviews r JOIN users u ON u.id=r.customer_id JOIN products p ON p.id=r.product_id
              WHERE r.shop_id=$1 AND r.status='visible' ORDER BY r.created_at DESC LIMIT 20`, [id]),
  ]);
  res.json({ shop, offers: offers.rows, reviews: reviews.rows });
}));

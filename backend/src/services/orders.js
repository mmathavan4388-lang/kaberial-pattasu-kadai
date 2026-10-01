import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { bad, conflict, HttpError } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import { notify, notifyAdmin } from '../lib/notify.js';
import { SHOP_LIVE } from '../lib/sql.js';
import { config } from '../config.js';
import { razorpay } from './razorpay.js';

// ---- money -------------------------------------------------------------------
// Commission is computed per seller sub-order, automatically, in integer paise.
// commission = round(subtotal * bps / 10000); settlement = subtotal - commission.
export function splitAmount(subtotal, bps) {
  const commission = Math.round((subtotal * bps) / 10000);
  return { commission, settlement: subtotal - commission };
}

const orderNo = () => 'MF' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();

// ---- checkout ----------------------------------------------------------------
// 1) validate + reserve stock atomically, 2) create the provider order, 3) return it
// to the client for UPI checkout. The order is only ever marked paid by markPaid(),
// which runs from the signed webhook or the signature-verified checkout callback.
export async function checkout(user, input) {
  const settings = await getSettings();
  if (config.requireMobileVerification && !user.mobile_verified) throw new HttpError(403, 'mobile_not_verified');
  if (!input.ageConfirmed || !input.safetyAck) throw bad('age_and_safety_required');

  const cities = settings.allowed_cities || [];
  const created = await db.tx(async (q) => {
    const ids = input.items.map((i) => i.productId);
    const { rows: prods } = await q(
      `SELECT p.id, p.name, p.price, p.discount_price, p.stock, p.available, p.images, p.shop_id,
              s.razorpay_account_id, s.delivery_enabled, s.pickup_enabled, s.city AS shop_city
         FROM products p JOIN shops s ON s.id = p.shop_id
        WHERE p.id = ANY($1::uuid[]) AND p.deleted_at IS NULL AND p.status = 'approved' AND p.visible
          AND ${SHOP_LIVE}
        ORDER BY p.id
        FOR UPDATE OF p`,
      [ids],
    );
    const byId = new Map(prods.map((p) => [p.id, p]));
    const merged = new Map();
    for (const i of input.items) merged.set(i.productId, (merged.get(i.productId) || 0) + i.qty);

    const groups = new Map(); // shop_id -> { shop, lines[] }
    for (const [pid, qty] of merged) {
      const p = byId.get(pid);
      if (!p) throw conflict('product_unavailable', pid);
      if (!p.available || p.stock < qty) throw conflict('out_of_stock', pid);
      if (!p.razorpay_account_id) throw conflict('seller_not_ready_for_payments', pid);
      if (!groups.has(p.shop_id)) groups.set(p.shop_id, { shop: p, lines: [] });
      const unit = p.discount_price ?? p.price;
      groups.get(p.shop_id).lines.push({ p, qty, unit, total: unit * qty });
    }

    for (const [shopId, g] of groups) {
      const mode = input.fulfilment?.[shopId] || 'pickup';
      g.mode = mode;
      if (mode === 'seller_delivery') {
        // Delivery only where the admin has enabled it for this seller AND the address is in a permitted area.
        if (!g.shop.delivery_enabled) throw conflict('delivery_not_permitted', shopId);
        if (!cities.map((c) => c.toLowerCase()).includes(String(input.address.city).toLowerCase()))
          throw conflict('delivery_area_not_permitted', shopId);
      } else if (!g.shop.pickup_enabled) throw conflict('pickup_not_available', shopId);
    }

    for (const g of groups.values())
      for (const l of g.lines) {
        const r = await q('UPDATE products SET stock = stock - $2, updated_at = now() WHERE id = $1 AND stock >= $2', [l.p.id, l.qty]);
        if (r.rowCount !== 1) throw conflict('out_of_stock', l.p.id);
      }

    const total = [...groups.values()].reduce((s, g) => s + g.lines.reduce((a, l) => a + l.total, 0), 0);
    const no = orderNo();
    const { rows: [order] } = await q(
      `INSERT INTO orders (order_no, customer_id, total, contact_name, contact_mobile, address, age_confirmed, safety_ack)
       VALUES ($1,$2,$3,$4,$5,$6,true,true) RETURNING id, order_no`,
      [no, user.id, total, input.contactName, input.contactMobile, JSON.stringify(input.address)],
    );
    const subs = [];
    for (const [shopId, g] of groups) {
      const subtotal = g.lines.reduce((a, l) => a + l.total, 0);
      const bps = Number(settings.commission_bps ?? 500);
      const { commission, settlement } = splitAmount(subtotal, bps);
      const { rows: [sub] } = await q(
        `INSERT INTO sub_orders (order_id, shop_id, subtotal, commission_bps, commission, settlement, fulfilment)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [order.id, shopId, subtotal, bps, commission, settlement, g.mode],
      );
      for (const l of g.lines)
        await q(
          `INSERT INTO order_items (sub_order_id, product_id, name, image, unit_price, qty, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [sub.id, l.p.id, l.p.name, l.p.images?.[0] || null, l.unit, l.qty, l.total],
        );
      subs.push({ id: sub.id, account: g.shop.razorpay_account_id, settlement, shopId });
    }
    return { order, subs, total };
  });

  try {
    const po = await razorpay.createOrder({
      amount: created.total,
      receipt: created.order.order_no,
      notes: { order_id: created.order.id },
      transfers: created.subs.map((s) => ({ account: s.account, amount: s.settlement, notes: { sub_order_id: s.id } })),
    });
    await db.query(
      `INSERT INTO payments (purpose, order_id, provider_order_id, amount) VALUES ('order',$1,$2,$3)`,
      [created.order.id, po.id, created.total],
    );
    return {
      orderId: created.order.id,
      orderNo: created.order.order_no,
      amount: created.total,
      payment: { provider: 'razorpay', keyId: razorpay.publicKeyId(), providerOrderId: po.id },
    };
  } catch (e) {
    await expireOrder(created.order.id, 'cancelled'); // release reserved stock
    throw e;
  }
}

// Re-open payment for a still-pending order (retry after a failed UPI attempt).
export async function paymentForRetry(user, orderId) {
  const { rows: [o] } = await db.query(
    `SELECT o.id, o.order_no, o.total, o.status, o.created_at, p.provider_order_id
       FROM orders o JOIN payments p ON p.order_id = o.id AND p.purpose = 'order'
      WHERE o.id = $1 AND o.customer_id = $2`, [orderId, user.id]);
  if (!o) throw new HttpError(404, 'not_found');
  if (o.status !== 'pending_payment') throw conflict('order_not_payable');
  return { orderId: o.id, orderNo: o.order_no, amount: o.total,
    payment: { provider: 'razorpay', keyId: razorpay.publicKeyId(), providerOrderId: o.provider_order_id } };
}

// ---- stock release ---------------------------------------------------------------
async function releaseStock(q, orderId, subOrderId = null) {
  await q(
    `UPDATE products p SET stock = p.stock + oi.qty, updated_at = now()
       FROM order_items oi JOIN sub_orders so ON so.id = oi.sub_order_id
      WHERE p.id = oi.product_id AND so.order_id = $1 AND ($2::uuid IS NULL OR so.id = $2)`,
    [orderId, subOrderId],
  );
}

export async function expireOrder(orderId, status = 'expired') {
  await db.tx(async (q) => {
    const { rows: [o] } = await q('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!o || o.status !== 'pending_payment') return; // never touch a paid order
    await releaseStock(q, orderId);
    await q('UPDATE orders SET status = $2 WHERE id = $1', [orderId, status]);
    await q(`UPDATE sub_orders SET status = 'cancelled', updated_at = now() WHERE order_id = $1`, [orderId]);
  });
}

// ---- payment confirmation (single code path for webhook + verified callback) -----------
export async function markPaid({ providerOrderId, providerPaymentId, amount, method }) {
  return db.tx(async (q) => {
    const { rows: [pay] } = await q('SELECT * FROM payments WHERE provider_order_id = $1 FOR UPDATE', [providerOrderId]);
    if (!pay) return { ignored: true };
    if (pay.status === 'paid') return { already: true, payment: pay };
    if (amount != null && Number(amount) !== Number(pay.amount)) {
      await notifyAdmin('payment_issue', { reason: 'amount_mismatch', providerOrderId }, q);
      throw new HttpError(409, 'amount_mismatch');
    }
    await q(`UPDATE payments SET status='paid', provider_payment_id=$2, method=$3, paid_at=now(), failure_reason=NULL WHERE id=$1`,
      [pay.id, providerPaymentId, method || null]);

    if (pay.purpose === 'subscription') {
      const s = await getSettings(q);
      const months = Number(s.subscription_months ?? 6);
      const { rows: [cur] } = await q(
        `SELECT max(expires_at) AS e FROM shop_subscriptions WHERE shop_id=$1 AND status='active' AND expires_at > now()`, [pay.shop_id]);
      const start = cur?.e ? new Date(cur.e) : new Date(); // renewal extends from current expiry
      const end = new Date(start); end.setMonth(end.getMonth() + months);
      await q(`INSERT INTO shop_subscriptions (shop_id, payment_id, amount, starts_at, expires_at) VALUES ($1,$2,$3,$4,$5)`,
        [pay.shop_id, pay.id, pay.amount, start, end]);
      const { rows: [shop] } = await q('SELECT owner_id, name FROM shops WHERE id=$1', [pay.shop_id]);
      await notify(shop.owner_id, 'subscription_active', { expiresAt: end }, q);
      await notifyAdmin('subscription_event', { shop: shop.name, event: 'paid' }, q);
      return { payment: pay };
    }

    const { rows: [order] } = await q(`UPDATE orders SET status='paid', paid_at=now() WHERE id=$1 AND status='pending_payment' RETURNING *`, [pay.order_id]);
    if (!order) {
      // Paid after the order expired/cancelled: money received but stock already released.
      await notifyAdmin('payment_issue', { reason: 'paid_for_inactive_order', orderId: pay.order_id }, q);
      return { payment: pay, orphan: true };
    }
    const { rows: subs } = await q(
      `UPDATE sub_orders SET status='placed', settlement_status='held', updated_at=now() WHERE order_id=$1 RETURNING id, shop_id, subtotal`, [order.id]);
    for (const s of subs) {
      await q(`INSERT INTO order_events (sub_order_id, status) VALUES ($1,'placed')`, [s.id]);
      await q(`UPDATE products p SET sales_count = sales_count + oi.qty FROM order_items oi WHERE oi.product_id = p.id AND oi.sub_order_id = $1`, [s.id]);
      const { rows: [shop] } = await q('SELECT owner_id FROM shops WHERE id=$1', [s.shop_id]);
      await notify(shop.owner_id, 'seller_new_order', { orderNo: order.order_no, subOrderId: s.id, amount: s.subtotal }, q);
    }
    await notify(order.customer_id, 'payment_success', { orderNo: order.order_no, orderId: order.id }, q);
    await notify(order.customer_id, 'order_placed', { orderNo: order.order_no, orderId: order.id }, q);
    await notifyAdmin('new_order', { orderNo: order.order_no, amount: order.total }, q);
    return { payment: pay, order };
  });
}

export async function markPaymentFailed({ providerOrderId, reason }) {
  await db.query(
    `UPDATE payments SET status='failed', failure_reason=$2 WHERE provider_order_id=$1 AND status='created'`,
    [providerOrderId, String(reason || '').slice(0, 300)]);
}

// After a failed attempt Razorpay lets the customer retry on the same order; if a later
// attempt succeeds markPaid() accepts status 'failed' -> 'paid'.

// ---- seller fulfilment ---------------------------------------------------------------
const FLOW = {
  pickup: ['placed', 'accepted', 'preparing', 'ready', 'completed'],
  seller_delivery: ['placed', 'accepted', 'preparing', 'ready', 'dispatched', 'out_for_delivery', 'delivered'],
};
const NOTIFY = { accepted: 'order_accepted', preparing: 'order_preparing', ready: 'order_ready',
  dispatched: 'order_dispatched', out_for_delivery: 'order_out_for_delivery', delivered: 'order_delivered', completed: 'order_delivered' };

export async function advanceSubOrder({ subOrderId, shopId, status, actorId, note }) {
  const result = await db.tx(async (q) => {
    const { rows: [so] } = await q(
      `SELECT so.*, o.customer_id, o.order_no FROM sub_orders so JOIN orders o ON o.id = so.order_id
        WHERE so.id=$1 AND so.shop_id=$2 FOR UPDATE OF so`, [subOrderId, shopId]);
    if (!so) throw new HttpError(404, 'not_found');
    const flow = FLOW[so.fulfilment];
    const cur = flow.indexOf(so.status);
    if (cur < 0 || flow[cur + 1] !== status) throw conflict('invalid_status_transition', `${so.status} -> ${status}`);
    await q(`UPDATE sub_orders SET status=$2, updated_at=now() WHERE id=$1`, [so.id, status]);
    await q(`INSERT INTO order_events (sub_order_id, status, note, actor_id) VALUES ($1,$2,$3,$4)`, [so.id, status, note || null, actorId]);
    await notify(so.customer_id, NOTIFY[status], { orderNo: so.order_no, orderId: so.order_id }, q);
    return { so, done: status === 'completed' || status === 'delivered' };
  });
  if (result.done) await releaseSettlement(result.so);
  return { status };
}

// Seller money is held at the provider until the order is delivered/collected, then released.
async function releaseSettlement(so) {
  try {
    let transferId = so.transfer_id;
    if (!transferId) {
      const { rows: [p] } = await db.query(`SELECT provider_order_id FROM payments WHERE order_id=$1 AND purpose='order'`, [so.order_id]);
      const transfers = await razorpay.fetchOrderTransfers(p.provider_order_id);
      transferId = transfers.find((t) => t.notes?.sub_order_id === so.id)?.id;
    }
    if (!transferId) throw new Error('transfer not found');
    await razorpay.releaseTransfer(transferId);
    await db.query(`UPDATE sub_orders SET transfer_id=$2, settlement_status='released' WHERE id=$1`, [so.id, transferId]);
  } catch (e) {
    console.error('settlement release failed', so.id, e.message);
    await db.query(`UPDATE sub_orders SET settlement_status='failed' WHERE id=$1`, [so.id]);
    await notifyAdmin('payment_issue', { reason: 'settlement_release_failed', subOrderId: so.id });
  }
}

// ---- cancellation + refund -------------------------------------------------------------
// Allowed before preparation starts. Refund goes back to the customer via the provider;
// the seller transfer is reversed (reverse_all) so commission is never "kept" on a refund.
export async function cancelPaidSubOrder({ subOrderId, shopId = null, actorId, reason }) {
  const info = await db.tx(async (q) => {
    const { rows: [so] } = await q(
      `SELECT so.*, o.customer_id, o.order_no, o.id AS oid FROM sub_orders so JOIN orders o ON o.id=so.order_id
        WHERE so.id=$1 AND ($2::uuid IS NULL OR so.shop_id=$2) FOR UPDATE OF so`, [subOrderId, shopId]);
    if (!so) throw new HttpError(404, 'not_found');
    if (!['placed', 'accepted'].includes(so.status)) throw conflict('cannot_cancel_now');
    const { rows: [pay] } = await q(`SELECT * FROM payments WHERE order_id=$1 AND purpose='order' AND status='paid'`, [so.oid]);
    if (!pay) throw conflict('no_paid_payment');
    await releaseStock(q, so.oid, so.id);
    await q(`UPDATE sub_orders SET status='cancelled', settlement_status='reversed', updated_at=now() WHERE id=$1`, [so.id]);
    await q(`INSERT INTO order_events (sub_order_id, status, note, actor_id) VALUES ($1,'cancelled',$2,$3)`, [so.id, reason || null, actorId]);
    const { rows: [rf] } = await q(
      `INSERT INTO refunds (sub_order_id, payment_id, amount, reason, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [so.id, pay.id, so.subtotal, reason || null, actorId]);
    await notify(so.customer_id, 'order_cancelled', { orderNo: so.order_no, orderId: so.oid }, q);
    return { so, pay, refundId: rf.id };
  });
  try {
    const r = await razorpay.refund(info.pay.provider_payment_id, info.so.subtotal, { sub_order_id: info.so.id });
    await db.query(`UPDATE refunds SET status='processed', provider_refund_id=$2 WHERE id=$1`, [info.refundId, r.id]);
  } catch (e) {
    await db.query(`UPDATE refunds SET status='failed' WHERE id=$1`, [info.refundId]);
    await notifyAdmin('payment_issue', { reason: 'refund_failed', subOrderId: info.so.id });
  }
  return { cancelled: true };
}

// ---- subscription checkout -------------------------------------------------------------
export async function subscriptionCheckout(shop) {
  const s = await getSettings();
  const amount = Number(s.subscription_amount ?? 19900);
  const po = await razorpay.createOrder({ amount, receipt: 'SUB' + shop.id.slice(0, 8) + Date.now().toString(36), notes: { shop_id: shop.id, purpose: 'subscription' } });
  await db.query(`INSERT INTO payments (purpose, shop_id, provider_order_id, amount) VALUES ('subscription',$1,$2,$3)`, [shop.id, po.id, amount]);
  return { amount, payment: { provider: 'razorpay', keyId: razorpay.publicKeyId(), providerOrderId: po.id } };
}

// ---- maintenance (run periodically; each step is idempotent, expireOrder locks the order row) ----------------------------------
export async function runMaintenance() {
  const { rows: stale } = await db.query(
    `SELECT id FROM orders WHERE status='pending_payment' AND created_at < now() - ($1 || ' minutes')::interval`,
    [String(config.paymentExpiryMinutes)]);
  for (const o of stale) await expireOrder(o.id);

  await db.query(`UPDATE shop_subscriptions SET status='expired' WHERE status='active' AND expires_at <= now()`);
  await db.query(`UPDATE offers SET status='ended' WHERE status='active' AND ends_at <= now()`);
  await db.query(`UPDATE products p SET discount_price = NULL FROM offers o WHERE o.product_id = p.id AND o.status='ended' AND p.discount_price IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM offers o2 WHERE o2.product_id=p.id AND o2.status='active')`);

  // Subscription expiry reminders at 30 / 7 / 1 days.
  const { rows: subs } = await db.query(
    `SELECT ss.id, ss.reminders, ss.expires_at, s.owner_id, s.name FROM shop_subscriptions ss JOIN shops s ON s.id = ss.shop_id
      WHERE ss.status='active' AND ss.expires_at > now() AND ss.expires_at < now() + interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM shop_subscriptions n WHERE n.shop_id = ss.shop_id AND n.starts_at >= ss.expires_at)`);
  for (const s of subs) {
    const days = Math.ceil((new Date(s.expires_at) - Date.now()) / 86400000);
    const due = [1, 7, 30].find((d) => days <= d);
    if (!due || s.reminders.includes(due)) continue;
    await notify(s.owner_id, 'subscription_expiring', { days, expiresAt: s.expires_at });
    await db.query(`UPDATE shop_subscriptions SET reminders = reminders || $2::jsonb WHERE id=$1`, [s.id, JSON.stringify([due])]);
  }
}

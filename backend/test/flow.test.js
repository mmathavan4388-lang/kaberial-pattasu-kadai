import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.ADMIN_SETUP_TOKEN = 'setup-token-for-tests';
process.env.RAZORPAY_KEY_ID = 'rzp_test_x';
process.env.RAZORPAY_KEY_SECRET = 'key_secret_x';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_x';
process.env.UPLOAD_DIR = new URL('../.test-uploads', import.meta.url).pathname;

const { db } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { createApp } = await import('../src/app.js');
const { razorpay } = await import('../src/services/razorpay.js');
const { runMaintenance } = await import('../src/services/orders.js');

let server, base;
const rzpCalls = { orders: [], released: [], refunds: [] };
let seq = 0;
// Only the outbound network calls to Razorpay are stubbed. Signature verification, order logic,
// commission math, stock handling etc. all run for real.
razorpay.createOrder = async (o) => { rzpCalls.orders.push(o); return { id: `order_T${++seq}` }; };
razorpay.fetchOrderTransfers = async () => rzpCalls.orders.at(-1).transfers.map((t, i) => ({ id: `trf_${i}`, notes: t.notes }));
razorpay.releaseTransfer = async (id) => { rzpCalls.released.push(id); return {}; };
razorpay.refund = async (pid, amt) => { rzpCalls.refunds.push([pid, amt]); return { id: 'rfnd_1' }; };

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, body, headers = {}) {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'mavrix', cookie: this.cookie, ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const sc = r.headers.getSetCookie?.() || [];
    for (const c of sc) this.cookie = c.split(';')[0];
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json };
  }
  get = (p) => this.req('GET', p);
  post = (p, b = {}) => this.req('POST', p, b);
  put = (p, b = {}) => this.req('PUT', p, b);
  patch = (p, b = {}) => this.req('PATCH', p, b);
  del = (p) => this.req('DELETE', p);
}

const sign = (raw) => crypto.createHmac('sha256', 'whsec_x').update(raw).digest('hex');
async function webhook(event, payload, id) {
  const raw = JSON.stringify({ event, payload });
  return fetch(base + '/api/payments/webhook', { method: 'POST', body: raw,
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': id } });
}
const paid = (orderId, amount, id) => webhook('payment.captured',
  { payment: { entity: { id: 'pay_' + id, order_id: orderId, amount, method: 'upi' } } }, 'evt_' + id);

before(async () => {
  await migrate({ log: () => {} });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await db.close(); });

const S = {}; // shared state across ordered tests
const admin = new Client(), sellerA = new Client(), sellerB = new Client(), cust = new Client(), anon = new Client();

test('first admin setup is one-time, token-protected, and single-admin', async () => {
  assert.equal((await anon.get('/api/admin/setup/status')).body.setupAvailable, true);
  const pw = 'Str0ng!Admin#Pass';
  const body = { email: 'owner@example.com', password: pw, confirmPassword: pw };
  assert.equal((await anon.post('/api/admin/setup', { ...body, setupToken: 'wrong' })).status, 403);
  assert.equal((await anon.post('/api/admin/setup', { ...body, setupToken: 'setup-token-for-tests', confirmPassword: 'x' })).status, 400);
  assert.equal((await anon.post('/api/admin/setup', { ...body, password: 'short', confirmPassword: 'short', setupToken: 'setup-token-for-tests' })).status, 400);
  assert.equal((await anon.post('/api/admin/setup', { ...body, setupToken: 'setup-token-for-tests' })).status, 201);
  // permanently disabled afterwards
  assert.equal((await anon.post('/api/admin/setup', { ...body, email: 'other@example.com', setupToken: 'setup-token-for-tests' })).status, 404);
  assert.equal((await anon.get('/api/admin/setup/status')).body.setupAvailable, false);
  // DB itself refuses a second admin
  await assert.rejects(db.query(`INSERT INTO users (role,name,email,password_hash) VALUES ('admin','x','b@b.com','x')`));
  assert.equal((await admin.post('/api/admin/login', { email: 'owner@example.com', password: 'wrong' })).status, 401);
  assert.equal((await admin.post('/api/admin/login', { email: 'owner@example.com', password: pw })).status, 200);
  assert.equal((await admin.get('/api/admin/dashboard')).status, 200);
});

test('admin routes are closed to anonymous, customers and sellers', async () => {
  assert.equal((await anon.get('/api/admin/dashboard')).status, 401);
  const c = new Client();
  await c.post('/api/auth/register', { name: 'Tmp User', mobile: '9000000001', password: 'password1' });
  assert.equal((await c.get('/api/admin/dashboard')).status, 403);
  assert.equal((await c.get('/api/admin/sellers')).status, 403);
  // customers cannot use the admin login either
  assert.equal((await new Client().post('/api/admin/login', { email: 'x@y.com', password: 'password1' })).status, 401);
  // CSRF header required
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

async function onboardSeller(client, n) {
  const r = await client.post('/api/seller/register', { shopName: `Shop ${n}`, ownerName: `Owner ${n}`, mobile: `98000000${n}0`.slice(0, 10),
    email: `shop${n}@example.com`, password: 'password1', address: 'Main Road, Sivakasi', photos: [] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const shopId = r.body.shopId;
  assert.equal((await admin.post(`/api/admin/sellers/${shopId}/status`, { status: 'approved' })).status, 200);
  assert.equal((await admin.patch(`/api/admin/sellers/${shopId}`, { razorpayAccountId: `acc_seller${n}`, verified: true, deliveryEnabled: n === 1 })).status, 200);
  const sub = await client.post('/api/seller/subscription/checkout');
  assert.equal(sub.status, 201);
  assert.equal(sub.body.amount, 19900); // Rs 199
  assert.equal((await paid(sub.body.payment.providerOrderId, 19900, `sub${n}`)).status, 200);
  return shopId;
}

test('seller registration -> admin approval -> Rs199 subscription via verified webhook', async () => {
  // registration must not accept/require licence or documents
  const bad = await sellerB.post('/api/seller/register', { shopName: 'x' });
  assert.equal(bad.status, 400);
  S.shopA = await onboardSeller(sellerA, 1);
  S.shopB = await onboardSeller(sellerB, 2);
  const me = await sellerA.get('/api/seller/me');
  assert.equal(me.body.subscription.active, true);
  assert.ok(me.body.subscription.daysLeft >= 180);
});

test('webhook: bad signature rejected, duplicates ignored', async () => {
  const raw = JSON.stringify({ event: 'payment.captured', payload: {} });
  const r = await fetch(base + '/api/payments/webhook', { method: 'POST', body: raw, headers: { 'x-razorpay-signature': 'deadbeef', 'x-razorpay-event-id': 'e' } });
  assert.equal(r.status, 400);
  const dup = await (await paid('order_unknown', 1, 'subA')).json();
  assert.ok(dup.duplicate || dup.ok);
});

async function addProduct(client, name, price, stock) {
  const cats = (await anon.get('/api/public/categories')).body.categories;
  const r = await client.post('/api/seller/products', { name, description: 'Safe sparkler pack', categoryId: cats[0].id, price, stock, images: ['/uploads/x.webp'], packQuantity: '10 pcs' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.product.id;
}

test('products need admin approval before they are public', async () => {
  S.pA = await addProduct(sellerA, 'Sparkler Deluxe', 200000, 10);
  S.pB = await addProduct(sellerB, 'Rocket Premium', 300000, 5);
  assert.equal((await anon.get(`/api/public/products/${S.pA}`)).status, 404);
  for (const id of [S.pA, S.pB]) assert.equal((await admin.patch(`/api/admin/products/${id}`, { status: 'approved' })).status, 200);
  const list = await anon.get('/api/public/products?q=deluxe');
  assert.equal(list.body.products.length, 1);
  assert.equal(list.body.products[0].in_stock, true);
  assert.equal((await anon.get('/api/public/home')).status, 200);
});

const addr = { line1: '12 Temple Street', city: 'Sivakasi', pincode: '626123' };
const base_co = { contactName: 'Cust One', contactMobile: '9000000002', address: addr, ageConfirmed: true, safetyAck: true };

test('multi-seller checkout: split sub-orders, 5% commission, stock reserved, paid only via signed webhook', async () => {
  await cust.post('/api/auth/register', { name: 'Cust One', mobile: '9000000002', password: 'password1', language: 'ta' });
  assert.equal((await cust.post('/api/me/checkout', { ...base_co, items: [{ productId: S.pA, qty: 1 }], ageConfirmed: false })).status, 400);
  const co = await cust.post('/api/me/checkout', { ...base_co, items: [{ productId: S.pA, qty: 1 }, { productId: S.pB, qty: 1 }],
    fulfilment: { [S.shopA]: 'seller_delivery' } });
  assert.equal(co.status, 201, JSON.stringify(co.body));
  assert.equal(co.body.amount, 500000);
  const order = rzpCalls.orders.at(-1);
  assert.equal(order.amount, 500000);
  assert.deepEqual(order.transfers.map((t) => t.amount).sort(), [190000, 285000]); // 95% of each seller's subtotal
  S.order = co.body;

  // reserved immediately; not paid yet
  assert.equal((await sellerA.get('/api/seller/products')).body.products[0].stock, 9);
  assert.equal((await sellerA.get('/api/seller/orders')).body.orders.length, 0); // hidden until paid
  assert.equal((await cust.get(`/api/me/orders/${S.order.orderId}`)).body.order.status, 'pending_payment');

  // forged client-side "success" is rejected
  const forged = await cust.post('/api/payments/verify', { razorpay_order_id: co.body.payment.providerOrderId, razorpay_payment_id: 'pay_x', razorpay_signature: 'forged' });
  assert.equal(forged.status, 400);
  assert.equal((await cust.get(`/api/me/orders/${S.order.orderId}`)).body.order.status, 'pending_payment');

  // wrong amount is refused
  const wrong = await paid(co.body.payment.providerOrderId, 1, 'wrong');
  assert.equal(wrong.status, 409);
  // genuine verified checkout callback
  const sig = crypto.createHmac('sha256', 'key_secret_x').update(`${co.body.payment.providerOrderId}|pay_ok`).digest('hex');
  const ok = await cust.post('/api/payments/verify', { razorpay_order_id: co.body.payment.providerOrderId, razorpay_payment_id: 'pay_ok', razorpay_signature: sig });
  assert.equal(ok.status, 200);
  // webhook for the same payment afterwards is idempotent
  assert.equal((await paid(co.body.payment.providerOrderId, 500000, 'late')).status, 200);

  const d = await cust.get(`/api/me/orders/${S.order.orderId}`);
  assert.equal(d.body.order.status, 'paid');
  assert.equal(d.body.subOrders.length, 2);
  const ordersA = (await sellerA.get('/api/seller/orders')).body.orders;
  assert.equal(ordersA.length, 1);
  assert.equal(ordersA[0].commission, 10000);   // 5% of 200000
  assert.equal(ordersA[0].settlement, 190000);
  S.subA = ordersA[0].id;
  S.subB = (await sellerB.get('/api/seller/orders')).body.orders[0].id;
  const notes = (await cust.get('/api/notifications')).body.notifications.map((n) => n.type);
  assert.ok(notes.includes('payment_success') && notes.includes('order_placed'));
  const adminNotes = (await admin.get('/api/notifications')).body.notifications.map((n) => n.type);
  assert.ok(adminNotes.includes('new_order') && adminNotes.includes('seller_registered'));
});

test('seller isolation, status flow, settlement release, reviews', async () => {
  // seller B cannot touch seller A's order
  assert.equal((await sellerB.patch(`/api/seller/orders/${S.subA}/status`, { status: 'accepted' })).status, 404);
  assert.equal((await sellerA.patch(`/api/seller/orders/${S.subA}/status`, { status: 'ready' })).status, 409); // cannot skip
  for (const s of ['accepted', 'preparing', 'ready', 'dispatched', 'out_for_delivery']) {
    assert.equal((await sellerA.patch(`/api/seller/orders/${S.subA}/status`, { status: s })).status, 200, s);
  }
  assert.equal(rzpCalls.released.length, 0); // money still held until delivered
  // review not allowed before delivery
  assert.equal((await cust.post('/api/me/reviews', { subOrderId: S.subA, productId: S.pA, rating: 5 })).status, 403);
  assert.equal((await sellerA.patch(`/api/seller/orders/${S.subA}/status`, { status: 'delivered' })).status, 200);
  assert.equal(rzpCalls.released.length, 1);
  assert.equal((await cust.post('/api/me/reviews', { subOrderId: S.subA, productId: S.pA, rating: 5, body: 'Great' })).status, 201);
  assert.equal((await cust.post('/api/me/reviews', { subOrderId: S.subA, productId: S.pA, rating: 4 })).status, 409);
  assert.equal((await anon.get(`/api/public/products/${S.pA}/reviews`)).body.reviews.length, 1);
  // pickup flow for B ends at completed
  for (const s of ['accepted', 'preparing', 'ready', 'completed']) {
    assert.equal((await sellerB.patch(`/api/seller/orders/${S.subB}/status`, { status: s })).status, 200, s);
  }
  const dash = await sellerA.get('/api/seller/dashboard');
  assert.equal(dash.body.totals.net, 190000);
  const adm = await admin.get('/api/admin/dashboard');
  assert.equal(adm.body.commission, 25000); // 10000 + 15000
  assert.equal(adm.body.subscriptionRevenue, 39800);
});

test('stock: out of stock is not purchasable; failed payment retry; expiry releases stock', async () => {
  // B has 4 left (5 - 1)
  const r = await cust.post('/api/me/checkout', { ...base_co, items: [{ productId: S.pB, qty: 5 }] });
  assert.equal(r.status, 409);
  const all = await cust.post('/api/me/checkout', { ...base_co, items: [{ productId: S.pB, qty: 4 }] });
  assert.equal(all.status, 201);
  const pub = await anon.get(`/api/public/products/${S.pB}`);
  assert.equal(pub.body.product.in_stock, false); // reached zero => Out of Stock
  assert.equal((await cust.post('/api/me/checkout', { ...base_co, items: [{ productId: S.pB, qty: 1 }] })).status, 409);
  // payment failure recorded, order still payable for retry
  await webhook('payment.failed', { payment: { entity: { order_id: all.body.payment.providerOrderId, error_description: 'UPI declined' } } }, 'evt_fail1');
  const retry = await cust.post(`/api/me/orders/${all.body.orderId}/pay`);
  assert.equal(retry.body.payment.providerOrderId, all.body.payment.providerOrderId);
  // expire: stock returns
  await db.query(`UPDATE orders SET created_at = now() - interval '1 hour' WHERE id=$1`, [all.body.orderId]);
  await runMaintenance();
  assert.equal((await anon.get(`/api/public/products/${S.pB}`)).body.product.in_stock, true);
});

test('delivery restrictions: seller must be permitted and city allowed', async () => {
  const noDelivery = await cust.post('/api/me/checkout', { ...base_co, items: [{ productId: S.pB, qty: 1 }], fulfilment: { [S.shopB]: 'seller_delivery' } });
  assert.equal(noDelivery.status, 409); // admin never enabled delivery for shop B
  const wrongCity = await cust.post('/api/me/checkout', { ...base_co, address: { ...addr, city: 'Chennai' }, items: [{ productId: S.pA, qty: 1 }], fulfilment: { [S.shopA]: 'seller_delivery' } });
  assert.equal(wrongCity.status, 409);
});

test('cancel before preparation refunds and restocks', async () => {
  const co = await cust.post('/api/me/checkout', { ...base_co, items: [{ productId: S.pA, qty: 2 }] });
  await paid(co.body.payment.providerOrderId, 400000, 'cancelme');
  const before = (await sellerA.get('/api/seller/products')).body.products.find((p) => p.id === S.pA).stock;
  const sub = (await sellerA.get('/api/seller/orders')).body.orders.find((o) => o.status === 'placed');
  const r = await cust.post(`/api/me/sub-orders/${sub.id}/cancel`);
  assert.equal(r.status, 200);
  assert.equal(rzpCalls.refunds.at(-1)[1], 400000);
  const after = (await sellerA.get('/api/seller/products')).body.products.find((p) => p.id === S.pA).stock;
  assert.equal(after, before + 2);
  assert.equal((await admin.get('/api/admin/refunds')).body.refunds.length, 1);
});

test('customer care: ticket -> admin inbox -> admin reply -> customer notified', async () => {
  const t = await cust.post('/api/me/support/tickets', { category: 'payment', orderNo: S.order.orderNo, message: 'Money debited twice' });
  assert.equal(t.status, 201);
  const inbox = await admin.get('/api/admin/support/tickets?status=open');
  assert.equal(inbox.body.tickets.length, 1);
  assert.equal(inbox.body.tickets[0].customer_mobile, '9000000002');
  assert.ok((await admin.get('/api/notifications')).body.notifications.some((n) => n.type === 'support_new'));
  const id = t.body.ticket.id;
  assert.equal((await admin.post(`/api/admin/support/tickets/${id}/reply`, { message: 'We are checking', status: 'pending' })).status, 201);
  const thread = await cust.get(`/api/me/support/tickets/${id}`);
  assert.equal(thread.body.messages.length, 2);
  assert.equal(thread.body.ticket.status, 'pending');
  assert.ok((await cust.get('/api/notifications')).body.notifications.some((n) => n.type === 'support_reply'));
  assert.equal((await admin.patch(`/api/admin/support/tickets/${id}`, { status: 'resolved' })).status, 200);
  // another customer cannot read it
  const other = new Client();
  await other.post('/api/auth/register', { name: 'Other One', mobile: '9000000003', password: 'password1' });
  assert.equal((await other.get(`/api/me/support/tickets/${id}`)).status, 404);
});

test('sessions: logout-all invalidates other devices; audit log is append-only; soft data kept', async () => {
  const device2 = new Client();
  await device2.post('/api/auth/login', { identifier: '9000000002', password: 'password1' });
  assert.equal((await device2.get('/api/auth/me')).body.user.mobile, '9000000002');
  await cust.post('/api/auth/logout-all');
  assert.equal((await device2.get('/api/auth/me')).body.user, null);
  await assert.rejects(db.query('DELETE FROM audit_logs'));
  assert.ok((await admin.get('/api/admin/audit-logs')).body.logs.length > 3);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM payments`)).rows[0].n >= 4, true);
});

test('uploads re-encode images and reject non-images', async () => {
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#c9a24b' } }).png().toBuffer();
  const c = new Client(); await c.post('/api/auth/login', { identifier: 'shop1@example.com', password: 'password1' });
  const r = await fetch(base + '/api/uploads', { method: 'POST', body: png, headers: { 'content-type': 'image/png', 'x-requested-with': 'mavrix', cookie: c.cookie } });
  assert.equal(r.status, 201);
  assert.match((await r.json()).url, /^\/uploads\/shops\/.+\.webp$/);
  const bad = await fetch(base + '/api/uploads', { method: 'POST', body: Buffer.from('<script>alert(1)</script>'), headers: { 'content-type': 'image/png', 'x-requested-with': 'mavrix', cookie: c.cookie } });
  assert.equal(bad.status, 400);
});

// Razorpay (UPI incl. GPay/PhonePe/Paytm) + Razorpay Route for marketplace split settlement.
// Secrets are read from the environment on the server only; nothing here reaches the browser
// except the public key id.
// NOTE: endpoint shapes follow Razorpay's public API docs; verify each against the
// sandbox (rzp_test_ keys) before going live.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';

const BASE = 'https://api.razorpay.com/v1';

async function call(method, path, body) {
  const { keyId, keySecret } = config.razorpay;
  if (!keyId || !keySecret) throw new HttpError(503, 'payments_not_configured');
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('razorpay error', res.status, json?.error?.description);
    throw new HttpError(502, 'payment_provider_error', json?.error?.description || 'Payment provider error');
  }
  return json;
}

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
function safeEqualHex(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const razorpay = {
  publicKeyId: () => config.razorpay.keyId,

  // transfers: [{ account, amount, notes }] => seller share; remainder stays with the platform
  // as commission. on_hold keeps seller money until the order is delivered/collected.
  createOrder({ amount, receipt, notes, transfers }) {
    return call('POST', '/orders', {
      amount, currency: 'INR', receipt, notes,
      ...(transfers?.length
        ? { transfers: transfers.map((t) => ({ account: t.account, amount: t.amount, currency: 'INR', notes: t.notes, on_hold: 1 })) }
        : {}),
    });
  },
  async fetchOrderTransfers(orderId) {
    const o = await call('GET', `/orders/${orderId}?expand[]=transfers`);
    return o.transfers?.items || o.transfers || [];
  },
  releaseTransfer: (transferId) => call('PATCH', `/transfers/${transferId}`, { on_hold: 0 }),
  refund: (paymentId, amount, notes) =>
    call('POST', `/payments/${paymentId}/refund`, { amount, notes, reverse_all: 1 }),
  createLinkedAccount: (a) => call('POST', '/accounts', a),

  // Checkout callback signature: HMAC_SHA256(order_id|payment_id, key_secret)
  verifyCheckoutSignature(orderId, paymentId, signature) {
    if (!config.razorpay.keySecret) return false;
    return safeEqualHex(hmac(config.razorpay.keySecret, `${orderId}|${paymentId}`), signature);
  },
  // Webhook signature: HMAC_SHA256(raw_body, webhook_secret), header X-Razorpay-Signature
  verifyWebhookSignature(rawBody, signature) {
    if (!config.razorpay.webhookSecret) return false;
    return safeEqualHex(hmac(config.razorpay.webhookSecret, rawBody), signature);
  },
};

import { post } from './api.js';

let loading;
function loadScript() {
  loading ||= new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve;
    s.onerror = () => { loading = null; reject(Object.assign(new Error('script'), { code: 'network_error' })); };
    document.body.appendChild(s);
  });
  return loading;
}

// Opens Razorpay checkout restricted to UPI (GPay / PhonePe / Paytm / any UPI app). There is no COD.
// Success is NOT trusted from the browser: the signature goes to the server, which verifies it
// with the secret key (and the signed webhook confirms independently).
export async function payWithRazorpay(order, prefill) {
  await loadScript();
  return new Promise((resolve, reject) => {
    let failed = false;
    const rz = new window.Razorpay({
      key: order.payment.keyId,
      order_id: order.payment.providerOrderId,
      name: 'MAVRIX FIRE',
      description: order.orderNo || 'MAVRIX FIRE',
      theme: { color: '#d4af37' },
      prefill,
      config: { display: { blocks: { upi: { name: 'UPI / GPay', instruments: [{ method: 'upi' }] } }, sequence: ['block.upi'], preferences: { show_default_blocks: false } } },
      handler: async (resp) => {
        try { failed = false; await post('/payments/verify', resp); resolve('paid'); } catch (e) { reject(e); }
      },
      modal: { ondismiss: () => (failed ? reject(Object.assign(new Error('failed'), { code: 'payment_failed' })) : resolve('dismissed')) },
    });
    rz.on('payment.failed', () => { failed = true; }); // customer may retry inside the sheet
    rz.open();
  });
}

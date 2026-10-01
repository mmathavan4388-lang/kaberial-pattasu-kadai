import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n/index.jsx';
import { errText, Empty, Field, Money, useToast } from '../components/ui.jsx';
import { useAction } from '../hooks.js';
import { payWithRazorpay } from '../payment.js';

export default function Checkout() {
  const { t } = useI18n();
  const { user, cart, refreshCart } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [cfg, setCfg] = useState(null);
  const [shops, setShops] = useState({});
  const [mode, setMode] = useState({});
  const [f, setF] = useState({ contactName: user.name, contactMobile: user.mobile || '', line1: '', city: 'Sivakasi', pincode: '' });
  const [age, setAge] = useState(false);
  const [safe, setSafe] = useState(false);
  const [err, setErr] = useState(null);
  const [pending, setPending] = useState(null); // order awaiting payment (retry without re-reserving stock)
  const [busy, run] = useAction();

  useEffect(() => { get('/public/config').then(setCfg).catch(() => {}); }, []);
  const groups = {};
  for (const i of cart) (groups[i.shop_id] ||= { name: i.shop_name, items: [] }).items.push(i);
  useEffect(() => {
    // learn each seller's delivery permission from the public shop endpoint
    Object.keys(groups).forEach((id) => { if (!shops[id]) get(`/public/shops/${id}`).then((r) => setShops((s) => ({ ...s, [id]: r.shop }))).catch(() => {}); });
  }, [cart.length]); // eslint-disable-line

  if (!cart.length && !pending) return <Empty text={t('cart_empty')} action={<Link className="btn" to="/browse">{t('shop_now')}</Link>} />;
  const total = cart.reduce((a, i) => a + (i.discount_price ?? i.price) * i.qty, 0);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function pay(order) {
    try {
      const r = await payWithRazorpay(order, { name: f.contactName, contact: f.contactMobile, email: user.email });
      if (r === 'dismissed') { setPending(order); toast(t('payment_cancelled'), 'err'); return; }
      await refreshCart();
      toast(t('payment_success'));
      nav(`/orders/${order.orderId}`, { replace: true });
    } catch (e) { setPending(order); setErr(e); }
  }
  const submit = (e) => {
    e.preventDefault(); setErr(null);
    run(async () => {
      try {
        if (pending) return pay(pending);
        const order = await post('/me/checkout', {
          items: cart.map((i) => ({ productId: i.id, qty: i.qty })),
          fulfilment: Object.fromEntries(Object.keys(groups).map((id) => [id, mode[id] || 'pickup'])),
          contactName: f.contactName, contactMobile: f.contactMobile,
          address: { line1: f.line1, city: f.city, pincode: f.pincode }, ageConfirmed: age, safetyAck: safe,
        });
        await pay(order);
      } catch (x) { setErr(x); }
    });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <h1>{t('checkout')}</h1>
      {Object.entries(groups).map(([id, g]) => (
        <div key={id} className="card">
          <b>{g.name}</b>
          <div className="muted small">{g.items.map((i) => `${i.name} × ${i.qty}`).join(', ')}</div>
          <Field label={t('fulfilment')}>
            <select value={mode[id] || 'pickup'} onChange={(e) => setMode({ ...mode, [id]: e.target.value })} disabled={!!pending}>
              <option value="pickup">{t('pickup')}</option>
              {shops[id]?.delivery_enabled && <option value="seller_delivery">{t('seller_delivery')}</option>}
            </select>
          </Field>
        </div>
      ))}
      <div className="card stack">
        <h3>{t('contact_address')}</h3>
        <div className="field-row">
          <Field label={t('name')}><input required value={f.contactName} onChange={set('contactName')} /></Field>
          <Field label={t('mobile')}><input required inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} value={f.contactMobile} onChange={set('contactMobile')} /></Field>
        </div>
        <Field label={t('address')}><input required minLength={3} value={f.line1} onChange={set('line1')} /></Field>
        <div className="field-row">
          <Field label={t('city')}>
            <select value={f.city} onChange={set('city')}>{(cfg?.allowedCities || ['Sivakasi']).map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          <Field label={t('pincode')}><input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={f.pincode} onChange={set('pincode')} /></Field>
        </div>
      </div>
      <div className="notice danger stack">
        <label className="check"><input type="checkbox" required checked={age} onChange={(e) => setAge(e.target.checked)} />{t('age_confirm', { n: cfg?.minAge || 18 })}</label>
        <label className="check"><input type="checkbox" required checked={safe} onChange={(e) => setSafe(e.target.checked)} />{t('safety_confirm')} <Link to="/safety" className="gold">{t('read_more')}</Link></label>
      </div>
      <div className="card row between"><b>{t('total')}</b><b className="gold"><Money v={pending?.amount ?? total} /></b></div>
      <p className="small muted">🔒 {t('upi_only_note')}</p>
      {err && <div className="notice danger"><p style={{ margin: 0 }}>{errText(t, err)}</p></div>}
      <button className="btn block" disabled={busy}>{pending ? t('retry_payment') : t('pay_now')}</button>
    </form>
  );
}

import { useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { post } from '../api.js';
import { useApi } from '../hooks.js';
import { useI18n } from '../i18n/index.jsx';
import { Async, errText, fmtDate, ImagePicker, Modal, Money, Field, StatusBadge, useToast } from '../components/ui.jsx';
import { uploadImage } from '../api.js';
import { payWithRazorpay } from '../payment.js';
import { useAuth } from '../auth.jsx';

export default function Orders() {
  return (
    <Routes>
      <Route index element={<List />} />
      <Route path=":id" element={<Detail />} />
    </Routes>
  );
}

function List() {
  const { t } = useI18n();
  const res = useApi('/me/orders');
  return (
    <div className="stack">
      <h1>{t('nav.orders')}</h1>
      <Async res={res} empty={t('no_orders')} isEmpty={(d) => !d.orders.length}>
        {(d) => d.orders.map((o) => (
          <Link key={o.id} to={`/orders/${o.id}`} className="card row between">
            <div><b>{o.order_no}</b><div className="muted small">{fmtDate(o.created_at)}</div>
              <div className="small">{(o.parts || []).map((p) => p.shop).join(', ')}</div></div>
            <div className="right"><b className="gold"><Money v={o.total} /></b><div><StatusBadge s={o.status === 'paid' ? (o.parts?.[0]?.status || 'paid') : o.status} /></div></div>
          </Link>
        ))}
      </Async>
    </div>
  );
}

const STEPS = { pickup: ['placed', 'accepted', 'preparing', 'ready', 'completed'], seller_delivery: ['placed', 'accepted', 'preparing', 'ready', 'dispatched', 'out_for_delivery', 'delivered'] };

function Detail() {
  const { id } = useParams();
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const res = useApi(`/me/orders/${id}`);
  const [review, setReview] = useState(null);

  async function retry() {
    try {
      const order = await post(`/me/orders/${id}/pay`);
      const r = await payWithRazorpay(order, { name: user.name, contact: user.mobile, email: user.email });
      if (r === 'paid') { toast(t('payment_success')); res.reload(); }
    } catch (e) { toast(errText(t, e), 'err'); }
  }
  async function cancel(subId) {
    if (!window.confirm(t('confirm_cancel'))) return;
    try { await post(`/me/sub-orders/${subId}/cancel`); toast(t('order_cancelled_refund')); res.reload(); } catch (e) { toast(errText(t, e), 'err'); }
  }
  return (
    <Async res={res}>
      {({ order, subOrders }) => (
        <div className="stack">
          <div className="row between"><h1>{order.order_no}</h1><StatusBadge s={order.status} /></div>
          <div className="muted small">{fmtDate(order.created_at)} · {order.contact_name} · {order.address?.line1}, {order.address?.city}</div>
          {order.status === 'pending_payment' && (
            <div className="notice danger"><p style={{ marginTop: 0 }}>{t('payment_pending_msg')}</p><button className="btn" onClick={retry}>{t('retry_payment')}</button></div>
          )}
          {subOrders.map((s) => {
            const steps = STEPS[s.fulfilment];
            const reached = Math.max(0, steps.indexOf(s.status));
            return (
              <div key={s.id} className="card stack">
                <div className="row between"><div><Link to={`/shop/${s.shop_id}`} className="gold"><b>{s.shop_name}</b></Link><div className="muted small">{t(s.fulfilment)}{s.fulfilment === 'pickup' && ` · ${s.shop_address}`}</div></div><StatusBadge s={s.status} /></div>
                {(s.items || []).map((i) => (
                  <div key={i.id} className="line-item">
                    {i.image ? <img src={i.image} alt="" /> : <div className="noimg">🎆</div>}
                    <div className="grow"><Link to={`/product/${i.product_id}`}>{i.name}</Link><div className="muted small">{i.qty} × <Money v={i.unit_price} /></div></div>
                    <b><Money v={i.line_total} /></b>
                    {['completed', 'delivered'].includes(s.status) && <button className="btn ghost sm" onClick={() => setReview({ subOrderId: s.id, productId: i.product_id, name: i.name })}>★ {t('review')}</button>}
                  </div>
                ))}
                {s.status !== 'cancelled' && s.status !== 'pending_payment' && (
                  <ol className="timeline">{steps.map((st, idx) => <li key={st} style={{ opacity: idx <= reached ? 1 : 0.35 }}>{t(`status.${st}`)}{s.events?.find((e) => e.status === st) && <span className="muted small"> · {fmtDate(s.events.find((e) => e.status === st).at)}</span>}</li>)}</ol>
                )}
                {['placed', 'accepted'].includes(s.status) && <button className="btn ghost sm" onClick={() => cancel(s.id)}>{t('cancel_order')}</button>}
                {s.shop_mobile && s.fulfilment === 'pickup' && s.status === 'ready' && <div className="notice">{t('ready_for_pickup')} · 📞 {s.shop_mobile}</div>}
              </div>
            );
          })}
          <div className="card row between"><b>{t('total')}</b><b className="gold"><Money v={order.total} /></b></div>
          <div className="row"><Link className="btn ghost" to={`/support/new?order=${order.order_no}`}>{t('need_help')}</Link></div>
          {review && <ReviewModal r={review} onClose={() => setReview(null)} onDone={() => { setReview(null); toast(t('review_thanks')); }} />}
        </div>
      )}
    </Async>
  );
}

function ReviewModal({ r, onClose, onDone }) {
  const { t } = useI18n();
  const toast = useToast();
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [img, setImg] = useState([]);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try { await post('/me/reviews', { subOrderId: r.subOrderId, productId: r.productId, rating, body: body || undefined, imageUrl: img[0] }); onDone(); }
    catch (e) { toast(errText(t, e), 'err'); } finally { setBusy(false); }
  }
  return (
    <Modal title={`${t('review')}: ${r.name}`} onClose={onClose}>
      <div className="stack">
        <div className="row">{[1, 2, 3, 4, 5].map((n) => <button key={n} className="iconbtn" style={{ color: n <= rating ? 'var(--gold)' : 'var(--muted)' }} onClick={() => setRating(n)} aria-label={`${n}`}>★</button>)}</div>
        <Field label={t('review_text')}><textarea maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <ImagePicker value={img} onChange={setImg} max={1} upload={uploadImage} />
        <button className="btn" onClick={send} disabled={busy}>{t('submit')}</button>
      </div>
    </Modal>
  );
}

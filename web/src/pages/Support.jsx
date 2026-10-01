import { useEffect, useRef, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post, uploadImage } from '../api.js';
import { useApi } from '../hooks.js';
import { useI18n } from '../i18n/index.jsx';
import { Async, errText, Empty, Field, fmtDate, ImagePicker, StatusBadge, useToast } from '../components/ui.jsx';

export const SUPPORT_CATS = ['order', 'payment', 'product', 'delivery', 'refund', 'seller', 'other'];

export default function Support() {
  return (
    <Routes>
      <Route index element={<Tickets />} />
      <Route path="new" element={<NewTicket />} />
      <Route path=":id" element={<Thread />} />
    </Routes>
  );
}

function Tickets() {
  const { t } = useI18n();
  const res = useApi('/me/support/tickets');
  return (
    <div className="stack">
      <div className="row between"><h1>{t('customer_care')}</h1><Link className="btn" to="/support/new">{t('new_ticket')}</Link></div>
      <p className="muted small">{t('support_intro')}</p>
      <Async res={res} empty={t('no_tickets')} isEmpty={(d) => !d.tickets.length}>
        {(d) => d.tickets.map((k) => (
          <Link key={k.id} to={`/support/${k.id}`} className="card row between">
            <div><b>{k.ticket_no}</b> · {t(`support.cat.${k.category}`)}<div className="muted small">{k.last_message?.slice(0, 80)}</div></div>
            <div className="right"><StatusBadge s={k.status} /><div className="muted small">{fmtDate(k.updated_at)}</div></div>
          </Link>
        ))}
      </Async>
    </div>
  );
}

function NewTicket() {
  const { t } = useI18n();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  // Draft survives failures: the typed message is never cleared unless the send succeeds.
  const [f, setF] = useState({ category: 'order', orderNo: sp.get('order') || '', message: '' });
  const [img, setImg] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  async function send(e) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const { ticket } = await post('/me/support/tickets', { category: f.category, orderNo: f.orderNo || undefined, message: f.message, imageUrl: img[0] });
      toast(t('message_sent')); nav(`/support/${ticket.id}`, { replace: true });
    } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  return (
    <form className="stack card" onSubmit={send}>
      <h1>{t('new_ticket')}</h1>
      <Field label={t('issue_category')}><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{SUPPORT_CATS.map((c) => <option key={c} value={c}>{t(`support.cat.${c}`)}</option>)}</select></Field>
      <Field label={t('order_id')}><input value={f.orderNo} maxLength={30} onChange={(e) => setF({ ...f, orderNo: e.target.value })} placeholder="MF…" /></Field>
      <Field label={t('message')}><textarea required minLength={2} maxLength={2000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
      <Field label={t('attach_image')}><ImagePicker value={img} onChange={setImg} max={1} upload={uploadImage} /></Field>
      {err && <p className="err-text">{errText(t, err)} — {t('draft_kept')}</p>}
      <button className="btn" disabled={busy}>{err ? t('retry') : t('send')}</button>
    </form>
  );
}

function Thread() {
  const { id } = useParams();
  const { t } = useI18n();
  const res = useApi(`/me/support/tickets/${id}`);
  const [text, setText] = useState('');
  const [err, setErr] = useState(null);
  const end = useRef();
  useEffect(() => { end.current?.scrollIntoView(); }, [res.data]);
  useEffect(() => { const i = setInterval(res.reload, 30000); return () => clearInterval(i); }, [res.reload]);
  async function send(e) {
    e.preventDefault(); setErr(null);
    try { await post(`/me/support/tickets/${id}/messages`, { message: text }); setText(''); res.reload(); } catch (x) { setErr(x); }
  }
  return (
    <Async res={res}>
      {({ ticket, messages }) => (
        <div className="stack">
          <div className="row between"><h1>{ticket.ticket_no}</h1><StatusBadge s={ticket.status} /></div>
          <div className="muted small">{t(`support.cat.${ticket.category}`)}{ticket.order_no && ` · ${ticket.order_no}`}</div>
          <div className="chat card">
            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.sender_role === 'customer' ? 'me' : ''}`}>
                {m.sender_role === 'admin' && <b className="gold small">MAVRIX FIRE</b>}
                {m.body}{m.image_url && <img src={m.image_url} alt="" />}<small>{fmtDate(m.created_at)}</small>
              </div>
            ))}<div ref={end} />
          </div>
          <form className="row" onSubmit={send}>
            <input className="grow" required value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={t('type_message')} />
            <button className="btn">{err ? t('retry') : t('send')}</button>
          </form>
          {err && <p className="err-text">{errText(t, err)}</p>}
        </div>
      )}
    </Async>
  );
}

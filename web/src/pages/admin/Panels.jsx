import { useState } from 'react';
import { Route, Routes, useSearchParams } from 'react-router-dom';
import { del, get, patch, post, put, toPaise, uploadImage } from '../../api.js';
import { useApi } from '../../hooks.js';
import { useI18n } from '../../i18n/index.jsx';
import { Async, errText, Empty, Field, fmtDate, ImagePicker, Modal, Money, Pager, StatusBadge, Stars, useToast } from '../../components/ui.jsx';
import { rupees } from '../../api.js';
import { SUPPORT_CATS } from '../Support.jsx';

export default function Panels() {
  return (
    <Routes>
      <Route index element={<Dashboard />} />
      <Route path="sellers" element={<Sellers />} />
      <Route path="customers" element={<Customers />} />
      <Route path="products" element={<Products />} />
      <Route path="categories" element={<Categories />} />
      <Route path="orders" element={<Orders />} />
      <Route path="finance" element={<Finance />} />
      <Route path="support" element={<SupportInbox />} />
      <Route path="reviews" element={<Reviews />} />
      <Route path="marketing" element={<Marketing />} />
      <Route path="audit" element={<Audit />} />
      <Route path="settings" element={<Settings />} />
    </Routes>
  );
}

// Paginated table helper with loading / empty / error states.
function DataTable({ path, listKey, cols, empty, pageSize = 25, reloadKey }) {
  const [page, setPage] = useState(1);
  const sep = path.includes('?') ? '&' : '?';
  const res = useApi(`${path}${sep}page=${page}&limit=${pageSize}`, [reloadKey]);
  const { t } = useI18n();
  return (
    <Async res={res} empty={empty || t('no_data')} isEmpty={(d) => !d[listKey].length && page === 1}>
      {(d) => (<>
        <div className="card tablewrap"><table>
          <thead><tr>{cols.map((c) => <th key={c.h}>{c.h}</th>)}</tr></thead>
          <tbody>{d[listKey].map((row, i) => <tr key={row.id ?? i}>{cols.map((c) => <td key={c.h}>{c.r ? c.r(row, res.reload) : row[c.k]}</td>)}</tr>)}</tbody>
        </table></div>
        <Pager page={page} setPage={setPage} hasMore={d[listKey].length === pageSize} />
      </>)}
    </Async>
  );
}

function Dashboard() {
  const { t } = useI18n();
  const res = useApi('/admin/dashboard');
  return (
    <Async res={res}>
      {(d) => {
        const stats = [['customers', d.customers], ['sellers', d.sellers], ['active_sellers', d.activeSellers], ['products', d.products], ['orders', d.orders],
          ['successful_orders', d.successfulOrders], ['total_sales', <Money v={d.totalSales} />], ['platform_commission', <Money v={d.commission} />],
          ['seller_settlements', <Money v={d.settled} />], ['pending_settlements', <Money v={d.pendingSettlement} />], ['subscription_revenue', <Money v={d.subscriptionRevenue} />],
          ['open_tickets', d.openTickets], ['resolved_tickets', d.resolvedTickets]];
        const max = Math.max(1, ...d.daily.map((x) => x.sales));
        return (
          <div className="stack"><h1>{t('admin.nav.dashboard')}</h1>
            <div className="stats">{stats.map(([k, v]) => <div key={k} className="card stat"><b>{v}</b><span>{t(`admin.stat.${k}`)}</span></div>)}</div>
            <div className="card"><h3>{t('sales_30d')}</h3>
              {d.daily.length ? <div className="chart">{d.daily.map((x) => <i key={x.day} title={`${x.day}: ${rupees(x.sales)} (${t('commission')} ${rupees(x.commission)})`} style={{ height: `${(x.sales / max) * 100}%` }} />)}</div> : <p className="muted">{t('no_data')}</p>}</div>
          </div>
        );
      }}
    </Async>
  );
}

const SELLER_ACTIONS = [['approved', 'approve'], ['rejected', 'reject'], ['update_required', 'request_update'], ['suspended', 'suspend']];
function Sellers() {
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState(null);
  const [k, setK] = useState(0);
  async function act(id, st) {
    let note;
    if (['rejected', 'update_required'].includes(st)) { note = window.prompt(t('note_required')); if (!note) return; }
    try { await post(`/admin/sellers/${id}/status`, { status: st, note }); toast(t('saved')); setK(k + 1); } catch (e) { toast(errText(t, e), 'err'); }
  }
  return (
    <div className="stack"><h1>{t('admin.nav.sellers')}</h1>
      <div className="chips">{['', 'pending', 'approved', 'update_required', 'rejected', 'suspended'].map((s) => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s ? t(`status.${s}`) : t('all')}</button>)}</div>
      <DataTable path={`/admin/sellers${status ? `?status=${status}` : ''}`} listKey="sellers" reloadKey={`${status}${k}`} cols={[
        { h: t('shop_name'), r: (s) => <a href="#" onClick={(e) => { e.preventDefault(); setDetail(s.id); }} className="gold">{s.name}</a> },
        { h: t('owner_name'), k: 'owner_name' }, { h: t('mobile'), k: 'mobile' },
        { h: t('status'), r: (s) => <StatusBadge s={s.status} /> },
        { h: t('seller.nav.subscription'), r: (s) => (s.subscription_expires ? fmtDate(s.subscription_expires) : '—') },
        { h: t('products'), k: 'product_count' },
        { h: '', r: (s) => <div className="row">{SELLER_ACTIONS.filter(([st]) => st !== s.status).map(([st, lab]) => <button key={st} className="btn ghost sm" onClick={() => act(s.id, st)}>{t(`act.${lab}`)}</button>)}</div> },
      ]} />
      {detail && <SellerDetail id={detail} onClose={() => { setDetail(null); setK(k + 1); }} />}
    </div>
  );
}

function SellerDetail({ id, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const res = useApi(`/admin/sellers/${id}`);
  const [acc, setAcc] = useState('');
  async function save(body) { try { await patch(`/admin/sellers/${id}`, body); toast(t('saved')); res.reload(); } catch (e) { toast(errText(t, e), 'err'); } }
  async function onboard() { try { await post(`/admin/sellers/${id}/onboard`); toast(t('saved')); res.reload(); } catch (e) { toast(errText(t, e), 'err'); } }
  return (
    <Modal title={t('seller_details')} onClose={onClose}>
      <Async res={res}>
        {({ shop: s, products, orders, sales, subscriptions }) => (
          <div className="stack">
            <div><b>{s.name}</b> <StatusBadge s={s.status} /><div className="muted small">{s.owner_name} · {s.mobile} · {s.owner_email}<br />{s.address}</div></div>
            {s.business_info && <p className="muted small" style={{ whiteSpace: 'pre-wrap' }}>{s.business_info}</p>}
            {s.photos?.length > 0 && <div className="hscroll">{s.photos.map((u) => <img key={u} src={u} alt="" style={{ height: 90, borderRadius: 8 }} />)}</div>}
            <div className="stats"><div className="card stat"><b><Money v={sales.sales} /></b><span>{t('gross_sales')}</span></div><div className="card stat"><b><Money v={sales.commission} /></b><span>{t('commission')}</span></div><div className="card stat"><b><Money v={sales.settlement} /></b><span>{t('seller_settlements')}</span></div></div>
            <div className="card stack"><h3>{t('payout_account')}</h3>
              <div className="small">{s.razorpay_account_id || t('not_linked')}</div>
              <div className="row"><input style={{ flex: 1 }} placeholder="acc_XXXXXXXX" value={acc} onChange={(e) => setAcc(e.target.value)} /><button className="btn sm" onClick={() => save({ razorpayAccountId: acc || null })}>{t('save')}</button><button className="btn ghost sm" onClick={onboard}>{t('create_linked_account')}</button></div>
              <label className="check"><input type="checkbox" checked={s.verified} onChange={(e) => save({ verified: e.target.checked })} />{t('verified')}</label>
              <label className="check"><input type="checkbox" checked={s.delivery_enabled} onChange={(e) => save({ deliveryEnabled: e.target.checked })} />{t('delivery_permitted_toggle')}</label>
            </div>
            <div><h3>{t('seller.nav.subscription')}</h3>{subscriptions.length ? subscriptions.map((x) => <div key={x.id} className="small">{fmtDate(x.starts_at)} → {fmtDate(x.expires_at)} · <Money v={x.amount} /> · <StatusBadge s={x.status} /></div>) : <span className="muted small">{t('no_subscription')}</span>}</div>
            <div><h3>{t('products')} ({products.length})</h3>{products.slice(0, 10).map((p) => <div key={p.id} className="small">{p.name} · <Money v={p.price} /> · {p.stock} · <StatusBadge s={p.status} /></div>)}</div>
            <div><h3>{t('orders')} ({orders.length})</h3>{orders.slice(0, 10).map((o) => <div key={o.id} className="small">{o.order_no} · <Money v={o.subtotal} /> · <StatusBadge s={o.status} /> · {t('settlement_status')}: {o.settlement_status}</div>)}</div>
          </div>
        )}
      </Async>
    </Modal>
  );
}

function Customers() {
  const { t } = useI18n();
  const toast = useToast();
  const [k, setK] = useState(0);
  const toggle = async (c) => { try { await post(`/admin/customers/${c.id}/status`, { status: c.status === 'active' ? 'blocked' : 'active' }); setK(k + 1); } catch (e) { toast(errText(t, e), 'err'); } };
  return (
    <div className="stack"><h1>{t('admin.nav.customers')}</h1>
      <DataTable path="/admin/customers" listKey="customers" reloadKey={k} cols={[
        { h: t('name'), k: 'name' }, { h: t('mobile'), k: 'mobile' }, { h: 'Email', k: 'email' }, { h: t('orders'), k: 'orders' },
        { h: t('status'), r: (c) => <StatusBadge s={c.status} /> }, { h: t('joined'), r: (c) => fmtDate(c.created_at) },
        { h: '', r: (c) => <button className="btn ghost sm" onClick={() => toggle(c)}>{c.status === 'active' ? t('act.block') : t('act.unblock')}</button> },
      ]} />
    </div>
  );
}

function Products() {
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [k, setK] = useState(0);
  async function upd(p, body) { try { await patch(`/admin/products/${p.id}`, body); setK(k + 1); } catch (e) { toast(errText(t, e), 'err'); } }
  return (
    <div className="stack"><h1>{t('admin.nav.products')}</h1>
      <div className="chips">{['pending', 'approved', 'removed', ''].map((s) => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s ? t(`status.${s}`) : t('all')}</button>)}</div>
      <DataTable path={`/admin/products${status ? `?status=${status}` : ''}`} listKey="products" reloadKey={`${status}${k}`} cols={[
        { h: '', r: (p) => (p.images?.[0] ? <img src={p.images[0]} alt="" width="44" height="44" style={{ borderRadius: 8, objectFit: 'cover' }} /> : '🎆') },
        { h: t('product'), k: 'name' }, { h: t('seller'), k: 'shop_name' }, { h: t('category'), k: 'category' }, { h: t('price'), r: (p) => <Money v={p.price} /> }, { h: t('stock'), k: 'stock' },
        { h: t('status'), r: (p) => <StatusBadge s={p.status} /> },
        { h: '', r: (p) => <div className="row">
          {p.status !== 'approved' && <button className="btn sm" onClick={() => upd(p, { status: 'approved' })}>{t('act.approve')}</button>}
          {p.status !== 'removed' && <button className="btn ghost sm" onClick={() => upd(p, { status: 'removed' })}>{t('act.remove')}</button>}
          <button className="btn ghost sm" onClick={() => upd(p, { visible: !p.visible })}>{p.visible ? t('act.hide') : t('act.show')}</button>
          <button className="btn ghost sm" onClick={() => upd(p, { featured: !p.featured })}>{p.featured ? '★' : '☆'}</button></div> },
      ]} />
    </div>
  );
}

function Categories() {
  const { t } = useI18n();
  const toast = useToast();
  const res = useApi('/admin/categories');
  const blank = { slug: '', nameEn: '', nameTa: '', nameHi: '', sortOrder: 0, active: true };
  const [f, setF] = useState(null);
  async function save(e) {
    e.preventDefault();
    try { await (f.id ? put(`/admin/categories/${f.id}`, f) : post('/admin/categories', f)); setF(null); res.reload(); } catch (x) { toast(errText(t, x), 'err'); }
  }
  return (
    <div className="stack"><div className="row between"><h1>{t('admin.nav.categories')}</h1><button className="btn" onClick={() => setF(blank)}>+ {t('add')}</button></div>
      <Async res={res} empty={t('no_data')} isEmpty={(d) => !d.categories.length}>
        {(d) => <div className="card tablewrap"><table><thead><tr><th>Slug</th><th>English</th><th>தமிழ்</th><th>हिन्दी</th><th>{t('status')}</th><th /></tr></thead>
          <tbody>{d.categories.map((c) => <tr key={c.id}><td>{c.slug}</td><td>{c.name_en}</td><td>{c.name_ta}</td><td>{c.name_hi}</td><td><StatusBadge s={c.active ? 'active' : 'blocked'} /></td>
            <td><button className="btn ghost sm" onClick={() => setF({ id: c.id, slug: c.slug, nameEn: c.name_en, nameTa: c.name_ta, nameHi: c.name_hi, sortOrder: c.sort_order, active: c.active })}>{t('edit')}</button></td></tr>)}</tbody></table></div>}
      </Async>
      {f && <Modal title={t('admin.nav.categories')} onClose={() => setF(null)}>
        <form className="stack" onSubmit={save}>
          <Field label="Slug"><input required pattern="[a-z0-9-]+" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Field>
          <Field label="English"><input required value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
          <Field label="தமிழ்"><input required value={f.nameTa} onChange={(e) => setF({ ...f, nameTa: e.target.value })} /></Field>
          <Field label="हिन्दी"><input required value={f.nameHi} onChange={(e) => setF({ ...f, nameHi: e.target.value })} /></Field>
          <Field label={t('sort_order')}><input type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} /></Field>
          <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />{t('active')}</label>
          <button className="btn">{t('save')}</button>
        </form></Modal>}
    </div>
  );
}

function Orders() {
  const { t } = useI18n();
  const toast = useToast();
  const [k, setK] = useState(0);
  async function cancel(o) {
    const reason = window.prompt(t('refund_reason')); if (reason === null) return;
    try { await post(`/admin/sub-orders/${o.id}/cancel`, { reason }); toast(t('saved')); setK(k + 1); } catch (e) { toast(errText(t, e), 'err'); }
  }
  return (
    <div className="stack"><h1>{t('admin.nav.orders')}</h1>
      <DataTable path="/admin/orders" listKey="orders" reloadKey={k} cols={[
        { h: t('order_id'), k: 'order_no' }, { h: t('seller'), k: 'shop_name' }, { h: t('customer'), r: (o) => `${o.customer_name} · ${o.customer_mobile}` },
        { h: t('order_total'), r: (o) => <Money v={o.subtotal} /> }, { h: t('commission'), r: (o) => <Money v={o.commission} /> }, { h: t('status'), r: (o) => <StatusBadge s={o.status} /> },
        { h: t('date'), r: (o) => fmtDate(o.created_at) },
        { h: '', r: (o) => ['placed', 'accepted'].includes(o.status) && <button className="btn ghost sm" onClick={() => cancel(o)}>{t('cancel_refund')}</button> },
      ]} />
    </div>
  );
}

function Finance() {
  const { t } = useI18n();
  const [tab, setTab] = useState('payments');
  const tabs = {
    payments: <DataTable path="/admin/payments" listKey="payments" cols={[
      { h: t('date'), r: (p) => fmtDate(p.created_at) }, { h: t('type'), k: 'purpose' }, { h: t('order_id'), r: (p) => p.order_no || p.shop_name }, { h: t('amount'), r: (p) => <Money v={p.amount} /> },
      { h: t('method'), k: 'method' }, { h: t('status'), r: (p) => <StatusBadge s={p.status} /> }, { h: 'Provider ID', r: (p) => <small>{p.provider_payment_id || p.provider_order_id}</small> }, { h: '', k: 'failure_reason' }]} />,
    commissions: <CommissionTable />,
    subscriptions: <SubsTable />,
    settlements: <DataTable path="/admin/settlements" listKey="settlements" cols={[
      { h: t('order_id'), k: 'order_no' }, { h: t('seller'), k: 'shop_name' }, { h: t('commission'), r: (s) => <Money v={s.commission} /> }, { h: t('seller_settlements'), r: (s) => <Money v={s.settlement} /> },
      { h: t('settlement_status'), r: (s) => <StatusBadge s={s.settlement_status} /> }, { h: t('status'), r: (s) => <StatusBadge s={s.status} /> }]} />,
    refunds: <RefundTable />,
  };
  return (
    <div className="stack"><h1>{t('admin.nav.finance')}</h1>
      <div className="chips">{Object.keys(tabs).map((k) => <button key={k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{t(`finance.${k}`)}</button>)}</div>
      {tabs[tab]}
    </div>
  );
}
const CommissionTable = () => { const { t } = useI18n(); const res = useApi('/admin/commissions');
  return <Async res={res} empty={t('no_data')} isEmpty={(d) => !d.commissions.length}>{(d) => <div className="card tablewrap"><table><thead><tr><th>{t('seller')}</th><th>{t('orders')}</th><th>{t('gross_sales')}</th><th>{t('commission')}</th><th>{t('seller_settlements')}</th></tr></thead>
    <tbody>{d.commissions.map((c) => <tr key={c.shop_id}><td>{c.shop_name}</td><td>{c.orders}</td><td><Money v={c.gross} /></td><td><Money v={c.commission} /></td><td><Money v={c.settlement} /></td></tr>)}</tbody></table></div>}</Async>; };
const SubsTable = () => { const { t } = useI18n(); const res = useApi('/admin/subscriptions');
  return <Async res={res} empty={t('no_data')} isEmpty={(d) => !d.subscriptions.length}>{(d) => <div className="card tablewrap"><table><thead><tr><th>{t('seller')}</th><th>{t('start')}</th><th>{t('expires')}</th><th>{t('amount')}</th><th>{t('payment')}</th><th>{t('status')}</th><th>{t('renewed')}</th></tr></thead>
    <tbody>{d.subscriptions.map((s) => <tr key={s.id}><td>{s.shop_name}</td><td>{fmtDate(s.starts_at)}</td><td>{fmtDate(s.expires_at)}</td><td><Money v={s.amount} /></td><td><StatusBadge s={s.payment_status || 'paid'} /></td><td><StatusBadge s={s.status} /></td><td>{s.renewed ? '✓' : '—'}</td></tr>)}</tbody></table></div>}</Async>; };
const RefundTable = () => { const { t } = useI18n(); const res = useApi('/admin/refunds');
  return <Async res={res} empty={t('no_data')} isEmpty={(d) => !d.refunds.length}>{(d) => <div className="card tablewrap"><table><thead><tr><th>{t('date')}</th><th>{t('order_id')}</th><th>{t('amount')}</th><th>{t('status')}</th><th>{t('reason')}</th></tr></thead>
    <tbody>{d.refunds.map((r) => <tr key={r.id}><td>{fmtDate(r.created_at)}</td><td>{r.order_no}</td><td><Money v={r.amount} /></td><td><StatusBadge s={r.status} /></td><td>{r.reason}</td></tr>)}</tbody></table></div>}</Async>; };

function SupportInbox() {
  const { t } = useI18n();
  const [sp] = useSearchParams();
  const [status, setStatus] = useState('open');
  const [open, setOpen] = useState(sp.get('open'));
  const [k, setK] = useState(0);
  return (
    <div className="stack"><h1>{t('admin.nav.support')}</h1>
      <div className="chips">{['open', 'pending', 'resolved', ''].map((s) => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s ? t(`status.${s}`) : t('all')}</button>)}</div>
      <DataTable path={`/admin/support/tickets${status ? `?status=${status}` : ''}`} listKey="tickets" reloadKey={`${status}${k}`} cols={[
        { h: t('ticket'), r: (x) => <a href="#" className="gold" onClick={(e) => { e.preventDefault(); setOpen(x.id); }}>{x.ticket_no}</a> },
        { h: t('customer'), r: (x) => <>{x.customer_name}<br /><small className="muted">{x.customer_mobile}<br />{x.customer_email}</small></> },
        { h: t('order_id'), k: 'order_no' }, { h: t('issue_category'), r: (x) => t(`support.cat.${x.category}`) },
        { h: t('message'), r: (x) => x.last_message?.slice(0, 70) }, { h: t('date'), r: (x) => fmtDate(x.updated_at) }, { h: t('status'), r: (x) => <StatusBadge s={x.status} /> }]} />
      {open && <TicketModal id={open} onClose={() => { setOpen(null); setK(k + 1); }} />}
    </div>
  );
}
function TicketModal({ id, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const res = useApi(`/admin/support/tickets/${id}`);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('pending');
  async function reply(e) {
    e.preventDefault();
    try { await post(`/admin/support/tickets/${id}/reply`, { message: text, status }); setText(''); res.reload(); toast(t('message_sent')); } catch (x) { toast(errText(t, x), 'err'); }
  }
  async function setSt(s) { try { await patch(`/admin/support/tickets/${id}`, { status: s }); res.reload(); } catch (x) { toast(errText(t, x), 'err'); } }
  return (
    <Modal title={t('ticket')} onClose={onClose}>
      <Async res={res}>
        {({ ticket: k, messages }) => (
          <div className="stack">
            <div><b>{k.ticket_no}</b> <StatusBadge s={k.status} /><div className="muted small">{k.customer_name} · {k.customer_mobile} · {k.customer_email}<br />{t(`support.cat.${k.category}`)} {k.order_no && `· ${k.order_no}`}</div></div>
            <div className="chat">{messages.map((m) => <div key={m.id} className={`msg ${m.sender_role === 'admin' ? 'me' : ''}`}>{m.body}{m.image_url && <a href={m.image_url} target="_blank" rel="noreferrer"><img src={m.image_url} alt="" /></a>}<small>{fmtDate(m.created_at)}</small></div>)}</div>
            <form className="stack" onSubmit={reply}>
              <textarea required value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={t('type_message')} />
              <div className="row"><select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>{['open', 'pending', 'resolved'].map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}</select><button className="btn grow">{t('send')}</button></div>
            </form>
            <div className="row">{['open', 'pending', 'resolved'].filter((s) => s !== k.status).map((s) => <button key={s} className="btn ghost sm" onClick={() => setSt(s)}>→ {t(`status.${s}`)}</button>)}</div>
          </div>
        )}
      </Async>
    </Modal>
  );
}

function Reviews() {
  const { t } = useI18n();
  const toast = useToast();
  const [k, setK] = useState(0);
  async function set(r, status) { try { await post(`/admin/reviews/${r.id}/status`, { status }); setK(k + 1); } catch (e) { toast(errText(t, e), 'err'); } }
  return (
    <div className="stack"><h1>{t('admin.nav.reviews')}</h1>
      <DataTable path="/admin/reviews" listKey="reviews" reloadKey={k} cols={[
        { h: t('rating'), r: (r) => <Stars value={r.rating} /> }, { h: t('review'), k: 'body' }, { h: t('product'), k: 'product_name' }, { h: t('seller'), k: 'shop_name' }, { h: t('customer'), k: 'customer_name' },
        { h: t('reports'), k: 'report_count' }, { h: t('status'), r: (r) => <StatusBadge s={r.status} /> },
        { h: '', r: (r) => <button className="btn ghost sm" onClick={() => set(r, r.status === 'visible' ? 'removed' : 'visible')}>{r.status === 'visible' ? t('act.remove') : t('act.restore')}</button> }]} />
    </div>
  );
}

function Marketing() {
  const { t } = useI18n();
  const toast = useToast();
  const banners = useApi('/admin/banners');
  const offers = useApi('/admin/offers');
  const [b, setB] = useState(null);
  const [img, setImg] = useState([]);
  const [bc, setBc] = useState({ audience: 'customers', title: '', message: '' });
  async function saveBanner(e) {
    e.preventDefault();
    const body = { title: b.title, subtitle: b.subtitle || undefined, link: b.link || undefined, sortOrder: Number(b.sortOrder || 0), active: b.active !== false, imageUrl: img[0] };
    try { await (b.id ? put(`/admin/banners/${b.id}`, body) : post('/admin/banners', body)); setB(null); banners.reload(); } catch (x) { toast(errText(t, x), 'err'); }
  }
  async function broadcast(e) {
    e.preventDefault();
    if (!window.confirm(t('confirm_broadcast'))) return;
    try { const r = await post('/admin/notifications/broadcast', bc); toast(`${t('sent')}: ${r.sent}`); setBc({ ...bc, title: '', message: '' }); } catch (x) { toast(errText(t, x), 'err'); }
  }
  return (
    <div className="stack">
      <div className="row between"><h1>{t('admin.nav.marketing')}</h1><button className="btn" onClick={() => { setB({}); setImg([]); }}>+ {t('banner')}</button></div>
      <Async res={banners} empty={t('no_data')} isEmpty={(d) => !d.banners.length}>
        {(d) => d.banners.map((x) => <div key={x.id} className="card row between"><div><b>{x.title}</b><div className="muted small">{x.subtitle}</div></div>
          <div className="row"><StatusBadge s={x.active ? 'active' : 'blocked'} /><button className="btn ghost sm" onClick={() => { setB(x); setImg(x.image_url ? [x.image_url] : []); }}>{t('edit')}</button><button className="btn ghost sm" onClick={() => del(`/admin/banners/${x.id}`).then(banners.reload)}>{t('delete')}</button></div></div>)}
      </Async>
      <h2>{t('seller.nav.offers')}</h2>
      <Async res={offers} empty={t('no_offers')} isEmpty={(d) => !d.offers.length}>
        {(d) => <div className="card tablewrap"><table><tbody>{d.offers.map((o) => <tr key={o.id}><td>{o.shop_name}</td><td>{o.product_name}</td><td>{o.title} · {o.percent_off}%</td><td>{fmtDate(o.ends_at)}</td><td><StatusBadge s={o.status} /></td>
          <td>{o.status === 'active' && <button className="btn ghost sm" onClick={() => post(`/admin/offers/${o.id}/disable`).then(offers.reload)}>{t('act.disable')}</button>}</td></tr>)}</tbody></table></div>}
      </Async>
      <h2>{t('broadcast')}</h2>
      <form className="card stack" onSubmit={broadcast}>
        <select value={bc.audience} onChange={(e) => setBc({ ...bc, audience: e.target.value })}><option value="customers">{t('customers')}</option><option value="sellers">{t('sellers')}</option></select>
        <input required maxLength={100} placeholder={t('title')} value={bc.title} onChange={(e) => setBc({ ...bc, title: e.target.value })} />
        <textarea required maxLength={400} placeholder={t('message')} value={bc.message} onChange={(e) => setBc({ ...bc, message: e.target.value })} />
        <button className="btn">{t('send')}</button>
      </form>
      {b && <Modal title={t('banner')} onClose={() => setB(null)}>
        <form className="stack" onSubmit={saveBanner}>
          <Field label={t('title')}><input required value={b.title || ''} onChange={(e) => setB({ ...b, title: e.target.value })} /></Field>
          <Field label={t('subtitle')}><input value={b.subtitle || ''} onChange={(e) => setB({ ...b, subtitle: e.target.value })} /></Field>
          <Field label="Link"><input value={b.link || ''} onChange={(e) => setB({ ...b, link: e.target.value })} placeholder="/browse?category=1" /></Field>
          <Field label={t('sort_order')}><input type="number" value={b.sort_order ?? b.sortOrder ?? 0} onChange={(e) => setB({ ...b, sortOrder: e.target.value, sort_order: e.target.value })} /></Field>
          <ImagePicker value={img} onChange={setImg} max={1} upload={uploadImage} />
          <label className="check"><input type="checkbox" checked={b.active !== false} onChange={(e) => setB({ ...b, active: e.target.checked })} />{t('active')}</label>
          <button className="btn">{t('save')}</button>
        </form></Modal>}
    </div>
  );
}

function Audit() {
  const { t } = useI18n();
  return (
    <div className="stack"><h1>{t('admin.nav.audit')}</h1>
      <DataTable path="/admin/audit-logs" listKey="logs" pageSize={25} cols={[
        { h: t('date'), r: (l) => fmtDate(l.created_at) }, { h: t('action'), k: 'action' }, { h: 'Entity', r: (l) => `${l.entity || ''} ${l.entity_id || ''}` }, { h: 'IP', k: 'ip' }, { h: 'Meta', r: (l) => <small>{JSON.stringify(l.meta)}</small> }]} />
    </div>
  );
}

function Settings() {
  const { t } = useI18n();
  const toast = useToast();
  const res = useApi('/admin/settings');
  const [tfa, setTfa] = useState(null);
  const [code, setCode] = useState('');
  async function save(e, s) {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await put('/admin/settings', {
        commission_bps: Math.round(Number(fd.get('commission')) * 100), subscription_amount: toPaise(fd.get('subscription')),
        subscription_months: Number(fd.get('months')), allowed_cities: String(fd.get('cities')).split(',').map((c) => c.trim()).filter(Boolean), min_age: Number(fd.get('age')),
      });
      toast(t('saved')); res.reload();
    } catch (x) { toast(errText(t, x), 'err'); }
  }
  return (
    <div className="stack"><h1>{t('admin.nav.settings')}</h1>
      <Async res={res}>
        {({ settings: s }) => (
          <form className="card stack" onSubmit={(e) => save(e, s)} key={JSON.stringify(s)}>
            <p className="muted small">{t('settings_note')}</p>
            <div className="field-row">
              <Field label={t('commission_percent')}><input name="commission" type="number" step="0.01" min="0" max="50" defaultValue={s.commission_bps / 100} /></Field>
              <Field label={`${t('subscription_fee')} (₹)`}><input name="subscription" type="number" step="1" min="1" defaultValue={s.subscription_amount / 100} /></Field>
              <Field label={t('subscription_months')}><input name="months" type="number" min="1" max="36" defaultValue={s.subscription_months} /></Field>
              <Field label={t('min_age')}><input name="age" type="number" min="18" defaultValue={s.min_age} /></Field>
            </div>
            <Field label={t('allowed_cities')}><input name="cities" defaultValue={(s.allowed_cities || []).join(', ')} /></Field>
            <button className="btn">{t('save')}</button>
          </form>
        )}
      </Async>
      <div className="card stack"><h3>2FA (TOTP)</h3>
        {!tfa ? <button className="btn ghost" onClick={async () => { try { setTfa(await post('/admin/2fa/setup')); } catch (x) { toast(errText(t, x), 'err'); } }}>{t('setup_2fa')}</button> : (
          <><p className="small">{t('tfa_scan')}</p><code style={{ wordBreak: 'break-all' }}>{tfa.secret}</code>
            <div className="row"><input style={{ width: 140 }} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
              <button className="btn sm" onClick={async () => { try { await post('/admin/2fa/enable', { code }); toast(t('saved')); setTfa(null); } catch (x) { toast(errText(t, x), 'err'); } }}>{t('verify')}</button></div></>)}
      </div>
      <div className="card"><button className="btn red" onClick={async () => { await post('/auth/logout-all'); window.location.href = '/admin'; }}>{t('logout_all')}</button></div>
    </div>
  );
}

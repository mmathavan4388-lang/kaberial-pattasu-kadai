import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { del, get, patch, post, put, uploadImage, toPaise, rupees } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useApi } from '../../hooks.js';
import { useI18n } from '../../i18n/index.jsx';
import { NotificationList } from '../../components/notif.jsx';
import { Async, errText, Empty, Field, fmtDate, ImagePicker, Logo, Modal, Money, Pager, StatusBadge, Stars, useToast } from '../../components/ui.jsx';
import { payWithRazorpay } from '../../payment.js';

const LINKS = [['', 'seller.nav.dashboard'], ['products', 'seller.nav.products'], ['orders', 'seller.nav.orders'], ['offers', 'seller.nav.offers'], ['reviews', 'seller.nav.reviews'],
  ['settlements', 'seller.nav.settlements'], ['subscription', 'seller.nav.subscription'], ['shop', 'seller.nav.shop'], ['notifications', 'notifications']];

export default function SellerApp() {
  const { t } = useI18n();
  const { logout, user } = useAuth();
  const nav = useNavigate();
  const me = useApi('/seller/me');
  return (
    <>
      <header className="topbar"><div className="in">
        <Link to="/seller" className="brand"><Logo size={34} /><span>MAVRIX FIRE</span></Link><span className="grow" />
        <span className="muted small">{user.name}</span>
        <button className="btn ghost sm" onClick={async () => { await logout(); nav('/'); }}>{t('logout')}</button>
      </div></header>
      <main className="shell page">
        <Async res={me}>
          {({ shop, subscription }) => (
            <div className="dash">
              <nav className="side">{LINKS.map(([to, k]) => <NavLink key={to} to={`/seller/${to}`} end={to === ''} className={({ isActive }) => (isActive ? 'on' : '')}>{t(k)}</NavLink>)}</nav>
              <div className="stack">
                <StatusBanner shop={shop} subscription={subscription} />
                <Routes>
                  <Route index element={<Dashboard />} />
                  <Route path="products" element={<Products shop={shop} />} />
                  <Route path="orders" element={<Orders />} />
                  <Route path="offers" element={<Offers />} />
                  <Route path="reviews" element={<Reviews />} />
                  <Route path="settlements" element={<Settlements />} />
                  <Route path="subscription" element={<Subscription shop={shop} sub={subscription} reload={me.reload} />} />
                  <Route path="shop" element={<ShopProfile shop={shop} reload={me.reload} />} />
                  <Route path="notifications" element={<NotificationList />} />
                </Routes>
              </div>
            </div>
          )}
        </Async>
      </main>
    </>
  );
}

function StatusBanner({ shop, subscription }) {
  const { t } = useI18n();
  const live = shop.status === 'approved' && subscription?.active;
  return (
    <div className={`notice ${['rejected', 'suspended'].includes(shop.status) ? 'danger' : ''}`}>
      <div className="row between"><div><b>{shop.name}</b> · <StatusBadge s={shop.status} /></div>
        {live ? <span className="badge b-approved">{t('shop_live')}</span> : <span className="badge b-pending">{t('shop_not_live')}</span>}</div>
      {shop.status_note && <div className="small" style={{ marginTop: 4 }}>{shop.status_note}</div>}
      {shop.status === 'pending' && <div className="small muted">{t('seller_pending_note')}</div>}
      {shop.status === 'approved' && !subscription?.active && <div className="small">{t('subscription_needed')} <Link className="gold" to="/seller/subscription">{t('seller.nav.subscription')}</Link></div>}
      {shop.status === 'approved' && !shop.razorpay_account_id && <div className="small muted">{t('payout_account_pending')}</div>}
      {subscription?.active && subscription.daysLeft <= 30 && <div className="small gold">{t('subscription_expiring_soon', { days: subscription.daysLeft })}</div>}
    </div>
  );
}

function Bars({ data, field = 'gross' }) {
  const max = Math.max(1, ...data.map((d) => d[field]));
  return <div className="chart" role="img">{data.map((d) => <i key={d.day} title={`${d.day}: ${rupees(d[field])}`} style={{ height: `${(d[field] / max) * 100}%` }} />)}</div>;
}

function Dashboard() {
  const { t } = useI18n();
  const res = useApi('/seller/dashboard');
  return (
    <Async res={res}>
      {({ totals: x, daily, topProducts, newOrders }) => (
        <div className="stack">
          <div className="stats">
            <div className="card stat"><b>{newOrders}</b><span>{t('new_orders')}</span></div>
            <div className="card stat"><b>{x.orders}</b><span>{t('orders')}</span></div>
            <div className="card stat"><b><Money v={x.gross} /></b><span>{t('gross_sales')}</span></div>
            <div className="card stat"><b><Money v={x.commission} /></b><span>{t('platform_commission')}</span></div>
            <div className="card stat"><b><Money v={x.net} /></b><span>{t('your_earnings')}</span></div>
            <div className="card stat"><b><Money v={x.pending_payout} /></b><span>{t('pending_payout')}</span></div>
          </div>
          <div className="card"><h3>{t('sales_30d')}</h3>{daily.length ? <Bars data={daily} /> : <p className="muted">{t('no_data')}</p>}</div>
          <div className="card"><h3>{t('top_products')}</h3>
            {topProducts.length ? <div className="tablewrap"><table><tbody>{topProducts.map((p) => <tr key={p.name}><td>{p.name}</td><td>{p.qty}</td><td className="right"><Money v={p.revenue} /></td></tr>)}</tbody></table></div> : <p className="muted">{t('no_data')}</p>}</div>
        </div>
      )}
    </Async>
  );
}

function Products({ shop }) {
  const { t, catName } = useI18n();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const res = useApi(`/seller/products?page=${page}&limit=20`);
  const cats = useApi('/public/categories');
  const [edit, setEdit] = useState(null);
  async function stock(p, delta) {
    try { await patch(`/seller/products/${p.id}/stock`, { delta }); res.reload(); } catch (e) { toast(errText(t, e), 'err'); }
  }
  async function remove(p) {
    if (!window.confirm(t('confirm_delete'))) return;
    try { await del(`/seller/products/${p.id}`); res.reload(); } catch (e) { toast(errText(t, e), 'err'); }
  }
  return (
    <div className="stack">
      <div className="row between"><h1>{t('seller.nav.products')}</h1><button className="btn" disabled={shop.status !== 'approved'} onClick={() => setEdit({})}>+ {t('add_product')}</button></div>
      <Async res={res} empty={t('no_products_yet')} isEmpty={(d) => !d.products.length && page === 1}>
        {(d) => (<>
          {d.products.map((p) => (
            <div key={p.id} className="card line-item" style={{ borderBottom: '1px solid var(--line)' }}>
              {p.images?.[0] ? <img src={p.images[0]} alt="" /> : <div className="noimg">🎆</div>}
              <div className="grow"><b>{p.name}</b> <StatusBadge s={p.status} />
                <div className="muted small"><Money v={p.discount_price ?? p.price} /> · {catName(cats.data?.categories.find((c) => c.id === p.category_id))}</div>
                <div className="row" style={{ marginTop: 6 }}>
                  <div className="qty"><button onClick={() => stock(p, -1)} aria-label="-">−</button><span>{p.stock}</span><button onClick={() => stock(p, 1)} aria-label="+">+</button></div>
                  <button className="btn ghost sm" onClick={() => stock(p, 10)}>+10</button>
                  <button className="btn ghost sm" onClick={() => setEdit(p)}>{t('edit')}</button>
                  <button className="btn ghost sm" onClick={() => remove(p)}>{t('delete')}</button>
                </div></div>
            </div>))}
          <Pager page={page} setPage={setPage} hasMore={d.products.length === 20} />
        </>)}
      </Async>
      {edit && <ProductForm p={edit} cats={cats.data?.categories || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); res.reload(); }} />}
    </div>
  );
}

function ProductForm({ p, cats, onClose, onSaved }) {
  const { t, catName } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({
    name: p.name || '', description: p.description || '', categoryId: p.category_id || cats[0]?.id || '', price: p.price ? p.price / 100 : '',
    discountPrice: p.discount_price ? p.discount_price / 100 : '', packQuantity: p.pack_quantity || '', stock: p.stock ?? 0, available: p.available ?? true,
    safetyNotes: p.safety_notes || '',
  });
  const [images, setImages] = useState(p.images || []);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = { name: f.name, description: f.description || undefined, categoryId: Number(f.categoryId), price: toPaise(f.price),
        discountPrice: f.discountPrice ? toPaise(f.discountPrice) : null, packQuantity: f.packQuantity || undefined, stock: Number(f.stock),
        available: f.available, images, safetyNotes: f.safetyNotes || undefined };
      await (p.id ? put(`/seller/products/${p.id}`, body) : post('/seller/products', body));
      toast(p.id ? t('saved') : t('product_submitted')); onSaved();
    } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  return (
    <Modal title={p.id ? t('edit_product') : t('add_product')} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label={t('product_name')}><input required minLength={2} value={f.name} onChange={set('name')} /></Field>
        <Field label={t('category')}><select required value={f.categoryId} onChange={set('categoryId')}>{cats.map((c) => <option key={c.id} value={c.id}>{catName(c)}</option>)}</select></Field>
        <div className="field-row">
          <Field label={`${t('price')} (₹)`}><input required type="number" min="1" step="0.01" value={f.price} onChange={set('price')} /></Field>
          <Field label={`${t('discount_price')} (₹)`}><input type="number" min="1" step="0.01" value={f.discountPrice} onChange={set('discountPrice')} /></Field>
        </div>
        <div className="field-row">
          <Field label={t('pack_quantity')}><input value={f.packQuantity} onChange={set('packQuantity')} placeholder="10 pcs" /></Field>
          <Field label={t('stock')}><input required type="number" min="0" value={f.stock} onChange={set('stock')} /></Field>
        </div>
        <Field label={t('description')}><textarea value={f.description} onChange={set('description')} /></Field>
        <Field label={t('safety_notes')}><textarea value={f.safetyNotes} onChange={set('safetyNotes')} /></Field>
        <Field label={t('product_photos')}><ImagePicker value={images} onChange={setImages} max={8} upload={uploadImage} /></Field>
        <label className="check"><input type="checkbox" checked={f.available} onChange={(e) => setF({ ...f, available: e.target.checked })} />{t('available')}</label>
        <p className="small muted">{t('moderation_note')}</p>
        {err && <p className="err-text">{errText(t, err)}{err.details?.[0] && ` (${err.details[0].path})`}</p>}
        <button className="btn" disabled={busy || !images.length}>{t('save')}</button>
      </form>
    </Modal>
  );
}

const NEXT = { pickup: { placed: 'accepted', accepted: 'preparing', preparing: 'ready', ready: 'completed' },
  seller_delivery: { placed: 'accepted', accepted: 'preparing', preparing: 'ready', ready: 'dispatched', dispatched: 'out_for_delivery', out_for_delivery: 'delivered' } };

function Orders() {
  const { t } = useI18n();
  const toast = useToast();
  const res = useApi('/seller/orders?limit=50');
  async function move(o, status) {
    try { await patch(`/seller/orders/${o.id}/status`, { status }); res.reload(); } catch (e) { toast(errText(t, e), 'err'); }
  }
  async function cancel(o) {
    if (!window.confirm(t('confirm_cancel'))) return;
    try { await post(`/seller/orders/${o.id}/cancel`, {}); res.reload(); } catch (e) { toast(errText(t, e), 'err'); }
  }
  return (
    <div className="stack"><h1>{t('seller.nav.orders')}</h1>
      <Async res={res} empty={t('no_orders')} isEmpty={(d) => !d.orders.length}>
        {(d) => d.orders.map((o) => {
          const next = NEXT[o.fulfilment][o.status];
          return (
            <div key={o.id} className="card stack">
              <div className="row between"><b>{o.order_no}</b><StatusBadge s={o.status} /></div>
              <div className="muted small">{fmtDate(o.created_at)} · {t(o.fulfilment)}</div>
              <div>{(o.items || []).map((i) => <div key={i.name}>{i.name} × {i.qty}</div>)}</div>
              <div className="muted small">{o.contact_name} · {o.contact_mobile}{o.fulfilment === 'seller_delivery' && ` · ${o.address?.line1}, ${o.address?.city} ${o.address?.pincode}`}</div>
              <div className="row between"><span>{t('order_total')}: <Money v={o.subtotal} /> · {t('commission')}: <Money v={o.commission} /> · <b className="gold">{t('your_earnings')}: <Money v={o.settlement} /></b></span></div>
              <div className="row">
                {next && <button className="btn sm" onClick={() => move(o, next)}>→ {t(`status.${next}`)}</button>}
                {['placed', 'accepted'].includes(o.status) && <button className="btn ghost sm" onClick={() => cancel(o)}>{t('cancel_order')}</button>}
              </div>
            </div>);
        })}
      </Async>
    </div>
  );
}

function Offers() {
  const { t } = useI18n();
  const toast = useToast();
  const res = useApi('/seller/offers');
  const prods = useApi('/seller/products?limit=50');
  const [f, setF] = useState({ productId: '', title: '', percentOff: 10, endsAt: '' });
  async function create(e) {
    e.preventDefault();
    try { await post('/seller/offers', { ...f, percentOff: Number(f.percentOff), endsAt: new Date(f.endsAt).toISOString() }); res.reload(); prods.reload(); toast(t('saved')); }
    catch (x) { toast(errText(t, x), 'err'); }
  }
  return (
    <div className="stack"><h1>{t('seller.nav.offers')}</h1>
      <form className="card stack" onSubmit={create}>
        <Field label={t('product')}><select required value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}><option value="" />{prods.data?.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label={t('offer_title')}><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="field-row">
          <Field label={t('percent_off')}><input type="number" min="1" max="90" required value={f.percentOff} onChange={(e) => setF({ ...f, percentOff: e.target.value })} /></Field>
          <Field label={t('ends_at')}><input type="datetime-local" required value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
        </div>
        <button className="btn">{t('create_offer')}</button>
      </form>
      <Async res={res} empty={t('no_offers')} isEmpty={(d) => !d.offers.length}>
        {(d) => d.offers.map((o) => (
          <div key={o.id} className="card row between"><div><b>{o.title}</b> · {o.product_name}<div className="muted small">{o.percent_off}% · {t('until')} {fmtDate(o.ends_at)}</div></div>
            <div className="row"><StatusBadge s={o.status} />{o.status === 'active' && <button className="btn ghost sm" onClick={() => del(`/seller/offers/${o.id}`).then(() => { res.reload(); prods.reload(); })}>{t('end')}</button>}</div></div>))}
      </Async>
    </div>
  );
}

function Reviews() {
  const { t } = useI18n();
  const res = useApi('/seller/reviews');
  return (
    <div className="stack"><h1>{t('seller.nav.reviews')}</h1>
      <Async res={res} empty={t('no_reviews')} isEmpty={(d) => !d.reviews.length}>
        {(d) => d.reviews.map((r) => <div key={r.id} className="card"><Stars value={r.rating} /> <span className="muted small">{r.customer_name} · {r.product_name} · {fmtDate(r.created_at)}</span>{r.body && <p style={{ margin: '.3rem 0 0' }}>{r.body}</p>}</div>)}
      </Async>
    </div>
  );
}

function Settlements() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const res = useApi(`/seller/settlements?page=${page}&limit=20`);
  return (
    <div className="stack"><h1>{t('seller.nav.settlements')}</h1><p className="muted small">{t('settlement_note')}</p>
      <Async res={res} empty={t('no_data')} isEmpty={(d) => !d.settlements.length && page === 1}>
        {(d) => (<><div className="card tablewrap"><table>
          <thead><tr><th>{t('order_id')}</th><th>{t('order_total')}</th><th>{t('commission')} (5%)</th><th>{t('your_earnings')}</th><th>{t('settlement_status')}</th></tr></thead>
          <tbody>{d.settlements.map((s) => <tr key={s.id}><td>{s.order_no}</td><td><Money v={s.subtotal} /></td><td><Money v={s.commission} /></td><td><Money v={s.settlement} /></td><td><StatusBadge s={s.settlement_status} /></td></tr>)}</tbody></table></div>
          <Pager page={page} setPage={setPage} hasMore={d.settlements.length === 20} /></>)}
      </Async>
    </div>
  );
}

function Subscription({ shop, sub, reload }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const hist = useApi('/seller/subscription/history');
  async function pay() {
    try {
      const o = await post('/seller/subscription/checkout');
      const r = await payWithRazorpay({ ...o, orderNo: 'MAVRIX FIRE Seller Plan' }, { name: user.name, contact: user.mobile, email: user.email });
      if (r === 'paid') { toast(t('payment_success')); reload(); hist.reload(); }
    } catch (e) { toast(errText(t, e), 'err'); }
  }
  return (
    <div className="stack"><h1>{t('seller.nav.subscription')}</h1>
      <div className="card stack">
        <div>{t('seller_plan')}: <b className="gold">₹199 / 6 {t('months')}</b></div>
        {sub ? <div>{t('status')}: <StatusBadge s={sub.active ? 'active' : 'expired'} /> · {t('expires')}: {fmtDate(sub.expires_at)}{sub.active && ` (${sub.daysLeft} ${t('days_left')})`}</div> : <div className="muted">{t('no_subscription')}</div>}
        <button className="btn" disabled={shop.status !== 'approved'} onClick={pay}>{sub?.active ? t('renew') : t('pay_subscription')}</button>
        {shop.status !== 'approved' && <p className="small muted">{t('subscription_after_approval')}</p>}
      </div>
      <Async res={hist} empty={t('no_data')} isEmpty={(d) => !d.subscriptions.length}>
        {(d) => <div className="card tablewrap"><table><thead><tr><th>{t('start')}</th><th>{t('expires')}</th><th>{t('amount')}</th><th>{t('payment')}</th></tr></thead>
          <tbody>{d.subscriptions.map((s) => <tr key={s.id}><td>{fmtDate(s.starts_at)}</td><td>{fmtDate(s.expires_at)}</td><td><Money v={s.amount} /></td><td><StatusBadge s={s.payment_status || 'paid'} /></td></tr>)}</tbody></table></div>}
      </Async>
    </div>
  );
}

function ShopProfile({ shop, reload }) {
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ name: shop.name, ownerName: shop.owner_name, mobile: shop.mobile, address: shop.address, businessInfo: shop.business_info || '' });
  const [photos, setPhotos] = useState(shop.photos || []);
  const [logo, setLogo] = useState(shop.logo_url ? [shop.logo_url] : []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    try { await patch('/seller/shop', { ...f, photos, logoUrl: logo[0] }); toast(t('saved')); reload(); } catch (x) { toast(errText(t, x), 'err'); }
  }
  return (
    <form className="card stack" onSubmit={save}>
      <h1>{t('seller.nav.shop')}</h1>
      <Field label={t('shop_name')}><input required value={f.name} onChange={set('name')} /></Field>
      <Field label={t('owner_name')}><input required value={f.ownerName} onChange={set('ownerName')} /></Field>
      <Field label={t('mobile')}><input required pattern="[6-9][0-9]{9}" value={f.mobile} onChange={set('mobile')} /></Field>
      <Field label={t('shop_address')}><textarea required value={f.address} onChange={set('address')} /></Field>
      <Field label={t('business_info')}><textarea value={f.businessInfo} onChange={set('businessInfo')} /></Field>
      <Field label={t('shop_logo')}><ImagePicker value={logo} onChange={setLogo} max={1} upload={uploadImage} /></Field>
      <Field label={t('shop_photos')}><ImagePicker value={photos} onChange={setPhotos} max={8} upload={uploadImage} /></Field>
      <button className="btn">{t('save')}</button>
    </form>
  );
}

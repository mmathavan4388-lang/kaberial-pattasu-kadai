import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, post, put } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { useI18n } from '../i18n/index.jsx';
import { Async, errText, fmtDate, HScroll, Price, ProductCard, Section, Stars, useToast } from '../components/ui.jsx';

export default function Product() {
  const { id } = useParams();
  const { t } = useI18n();
  const { user, setQty, cart } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const res = useApi(`/public/products/${id}`);
  const cmp = useApi(`/public/products/${id}/compare`);
  const reviews = useApi(`/public/products/${id}/reviews`);
  const [img, setImg] = useState(0);
  const [qty, setQ] = useState(1);
  const [wish, setWish] = useState(false);

  const needLogin = () => { nav('/login', { state: { from: `/product/${id}` } }); };
  async function add(buy) {
    if (user?.role !== 'customer') return needLogin();
    try {
      const have = cart.find((i) => i.id === id)?.qty || 0;
      await setQty(id, buy ? qty : Math.min(have + qty, 100));
      toast(t('added_to_cart'));
      if (buy) nav('/checkout');
    } catch (e) { toast(errText(t, e), 'err'); }
  }
  async function toggleWish() {
    if (user?.role !== 'customer') return needLogin();
    try { await (wish ? del : put)(`/me/wishlist/${id}`); setWish(!wish); } catch (e) { toast(errText(t, e), 'err'); }
  }

  return (
    <Async res={res}>
      {({ product: p }) => {
        const out = !p.in_stock;
        const imgs = p.images?.length ? p.images : [];
        return (
          <div className="stack">
            <div className="pdp">
              <div className="gallery">
                <div className="main">{imgs[img] ? <img src={imgs[img]} alt={p.name} /> : <div className="noimg">🎆</div>}</div>
                {imgs.length > 1 && <div className="thumbs">{imgs.map((u, i) => <img key={u} src={u} alt="" loading="lazy" onClick={() => setImg(i)} />)}</div>}
              </div>
              <div className="stack">
                <h1>{p.name}</h1>
                <div className="row"><Price p={p} />{p.rating_count > 0 && <Stars value={p.rating_avg} count={p.rating_count} />}</div>
                {p.pack_quantity && <div className="muted">{t('pack')}: {p.pack_quantity}</div>}
                <div>{out ? <span className="badge b-cancelled">{t('out_of_stock')}</span> : <span className="badge b-approved">{t('in_stock')}{p.stock <= 10 ? ` · ${t('only_left', { n: p.stock })}` : ''}</span>}</div>
                <div className="card row between">
                  <div><Link to={`/shop/${p.shop_id}`} className="gold">{p.shop_name}</Link>{p.shop_verified && <span className="vtag">✓ {t('verified')}</span>}
                    <div className="muted small">{p.shop_address}</div></div>
                  <Link className="btn ghost sm" to={`/shop/${p.shop_id}`}>{t('visit_shop')}</Link>
                </div>
                <div className="small muted">
                  {p.pickup_enabled && <div>🏪 {t('pickup_available')}</div>}
                  <div>{p.delivery_enabled ? `🚚 ${t('delivery_where_permitted')}` : `🚚 ${t('delivery_not_offered')}`}</div>
                </div>
                {!out && (
                  <div className="row">
                    <div className="qty"><button onClick={() => setQ(Math.max(1, qty - 1))} aria-label="-">−</button><span>{qty}</span><button onClick={() => setQ(Math.min(p.stock, qty + 1))} aria-label="+">+</button></div>
                    <button className="btn ghost grow" onClick={() => add(false)}>{t('add_to_cart')}</button>
                    <button className="btn grow" onClick={() => add(true)}>{t('buy_now')}</button>
                  </div>
                )}
                <button className="btn ghost sm" onClick={toggleWish}>{wish ? '♥' : '♡'} {t('wishlist')}</button>
                {p.description && <div><h3>{t('description')}</h3><p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{p.description}</p></div>}
                <div className="notice danger">⚠ {p.safety_notes || t('safety_short')} <Link className="gold" to="/safety">{t('read_more')}</Link></div>
              </div>
            </div>
            {cmp.data?.products.length > 0 && <Section title={t('compare_sellers')}><HScroll>{cmp.data.products.map((c) => <ProductCard key={c.id} p={c} />)}</HScroll></Section>}
            <Section title={t('reviews')}>
              <Async res={reviews} empty={t('no_reviews')} isEmpty={(d) => !d.reviews.length}>
                {(d) => <div className="stack">{d.reviews.map((r) => (
                  <div key={r.id} className="card"><Stars value={r.rating} /> <span className="muted small">{r.customer_name} · {fmtDate(r.created_at)}</span>
                    {r.body && <p style={{ margin: '.3rem 0 0' }}>{r.body}</p>}{r.image_url && <img src={r.image_url} alt="" style={{ maxWidth: 160, marginTop: 8, borderRadius: 8 }} />}
                    {user?.role === 'customer' && <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => post(`/me/reviews/${r.id}/report`).then(() => toast(t('reported'))).catch((e) => toast(errText(t, e), 'err'))}>{t('report')}</button>}
                  </div>))}</div>}
              </Async>
            </Section>
          </div>
        );
      }}
    </Async>
  );
}

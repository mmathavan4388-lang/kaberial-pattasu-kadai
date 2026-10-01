import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApi } from '../hooks.js';
import { useI18n } from '../i18n/index.jsx';
import { Async, fmtDate, Pager, ProductCard, Section, Stars } from '../components/ui.jsx';

export default function Shop() {
  const { id } = useParams();
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const shop = useApi(`/public/shops/${id}`);
  const prods = useApi(`/public/products?shop=${id}&page=${page}&limit=20&sort=new`);
  return (
    <Async res={shop}>
      {({ shop: s, offers, reviews }) => (
        <div className="stack">
          {s.photos?.length > 0 && <div className="hscroll">{s.photos.map((u) => <img key={u} src={u} alt="" loading="lazy" style={{ height: 160, borderRadius: 12 }} />)}</div>}
          <div className="card row">
            <div className="slogo" style={{ width: 72, height: 72 }}>{s.logo_url ? <img src={s.logo_url} alt="" /> : '🏪'}</div>
            <div className="grow">
              <h1>{s.name}{s.verified && <span className="vtag">✓ {t('verified')}</span>}</h1>
              <div className="muted">{s.address}, {s.city}</div>
              {s.rating_count > 0 && <Stars value={s.rating_avg} count={s.rating_count} />}
            </div>
          </div>
          {s.business_info && <div className="card"><h3>{t('about_shop')}</h3><p className="muted" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{s.business_info}</p></div>}
          <div className="small muted">{s.pickup_enabled && <div>🏪 {t('pickup_available')}</div>}<div>{s.delivery_enabled ? `🚚 ${t('delivery_where_permitted')}` : `🚚 ${t('delivery_not_offered')}`}</div></div>
          {offers.length > 0 && <Section title={t('offers')}>{offers.map((o) => <div key={o.id} className="notice">{o.title} · <b>{o.percent_off}%</b> · {t('until')} {fmtDate(o.ends_at)}</div>)}</Section>}
          <Section title={t('products')}>
            <Async res={prods} empty={t('empty_products')} isEmpty={(d) => !d.products.length && page === 1}>
              {(d) => <><div className="grid">{d.products.map((p) => <ProductCard key={p.id} p={p} />)}</div><Pager page={page} setPage={setPage} hasMore={d.hasMore} /></>}
            </Async>
          </Section>
          <Section title={t('reviews')}>
            {reviews.length === 0 ? <p className="muted">{t('no_reviews')}</p> : reviews.map((r) => (
              <div key={r.id} className="card" style={{ marginBottom: 8 }}><Stars value={r.rating} /> <span className="muted small">{r.customer_name} · {r.product_name}</span>{r.body && <p style={{ margin: '.3rem 0 0' }}>{r.body}</p>}</div>))}
          </Section>
        </div>
      )}
    </Async>
  );
}

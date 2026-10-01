import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get } from '../api.js';
import { useApi } from '../hooks.js';
import { useI18n } from '../i18n/index.jsx';
import { Async, Empty, ErrorState, Loading, Pager, ProductCard, ShopCard } from '../components/ui.jsx';

export default function Browse() {
  const { t, catName } = useI18n();
  const [sp, setSp] = useSearchParams();
  const [page, setPage] = useState(1);
  const cats = useApi('/public/categories');
  const q = sp.get('q') || '', category = sp.get('category') || '', sort = sp.get('sort') || 'popular', view = sp.get('view');
  const [inStock, setInStock] = useState(false);
  const set = (k, v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); setPage(1); };
  useEffect(() => setPage(1), [q, category, sort, inStock]);

  const qs = new URLSearchParams({ page, limit: 20, sort, ...(q && { q }), ...(category && { category }), ...(inStock && { inStock: 'true' }) });
  const products = useApi(view === 'shops' ? null : `/public/products?${qs}`);
  const shops = useApi(view === 'shops' ? `/public/shops?page=${page}` : null);
  return (
    <div className="stack">
      <div className="chips">
        <button className={`chip ${!view && !category ? 'on' : ''}`} onClick={() => { set('view', ''); set('category', ''); }}>{t('all')}</button>
        {cats.data?.categories.map((c) => <button key={c.id} className={`chip ${String(c.id) === category ? 'on' : ''}`} onClick={() => { set('view', ''); set('category', c.id); }}>{catName(c)}</button>)}
        <button className={`chip ${view === 'shops' ? 'on' : ''}`} onClick={() => set('view', 'shops')}>{t('shops')}</button>
      </div>
      {view !== 'shops' && (
        <div className="row">
          <select value={sort} onChange={(e) => set('sort', e.target.value)} style={{ width: 'auto' }} aria-label={t('sort')}>
            {['popular', 'new', 'price_asc', 'price_desc', 'rating'].map((s) => <option key={s} value={s}>{t(`sort.${s}`)}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} />{t('in_stock_only')}</label>
          {q && <span className="muted small">“{q}”</span>}
        </div>
      )}
      {view === 'shops' ? (
        <Async res={shops} empty={t('empty_shops')} isEmpty={(d) => !d.shops.length}>{(d) => <div className="stack">{d.shops.map((s) => <ShopCard key={s.id} s={s} />)}</div>}</Async>
      ) : (
        <Async res={products} empty={t('empty_products')} isEmpty={(d) => !d.products.length && page === 1}>
          {(d) => (<><div className="grid">{d.products.map((p) => <ProductCard key={p.id} p={p} />)}</div><Pager page={page} setPage={setPage} hasMore={d.hasMore} /></>)}
        </Async>
      )}
    </div>
  );
}

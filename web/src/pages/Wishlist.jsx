import { useApi } from '../hooks.js';
import { useI18n } from '../i18n/index.jsx';
import { Async, ProductCard } from '../components/ui.jsx';

export default function Wishlist() {
  const { t } = useI18n();
  const res = useApi('/me/wishlist');
  return (
    <div className="stack"><h1>{t('wishlist')}</h1>
      <Async res={res} empty={t('wishlist_empty')} isEmpty={(d) => !d.products.length}>{(d) => <div className="grid">{d.products.map((p) => <ProductCard key={p.id} p={p} />)}</div>}</Async>
    </div>
  );
}

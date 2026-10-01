import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Empty, errText, Money, Price, useToast } from '../components/ui.jsx';

export default function Cart() {
  const { t } = useI18n();
  const { cart, setQty } = useAuth();
  const toast = useToast();
  const change = (id, q) => setQty(id, q).catch((e) => toast(errText(t, e), 'err'));
  if (!cart.length) return <Empty text={t('cart_empty')} action={<Link className="btn" to="/browse">{t('shop_now')}</Link>} />;
  // Group by seller: each seller becomes its own sub-order at checkout.
  const groups = {};
  for (const i of cart) (groups[i.shop_id] ||= { name: i.shop_name, items: [] }).items.push(i);
  const total = cart.filter((i) => i.purchasable && i.in_stock).reduce((a, i) => a + (i.discount_price ?? i.price) * i.qty, 0);
  const blocked = cart.some((i) => !i.purchasable || !i.in_stock);
  return (
    <div className="stack">
      <h1>{t('nav.cart')}</h1>
      {Object.entries(groups).map(([sid, g]) => (
        <div key={sid} className="card">
          <h3><Link to={`/shop/${sid}`} className="gold">{g.name}</Link></h3>
          {g.items.map((i) => (
            <div key={i.id} className="line-item">
              {i.images?.[0] ? <img src={i.images[0]} alt="" /> : <div className="noimg">🎆</div>}
              <div className="grow"><Link to={`/product/${i.id}`}>{i.name}</Link><div><Price p={i} /></div>
                {(!i.purchasable || !i.in_stock) && <div className="err-text small">{t('out_of_stock')}</div>}</div>
              <div className="qty"><button onClick={() => change(i.id, i.qty - 1)} aria-label="-">−</button><span>{i.qty}</span><button onClick={() => change(i.id, i.qty + 1)} aria-label="+">+</button></div>
              <button className="iconbtn" onClick={() => change(i.id, 0)} aria-label={t('remove')}>🗑</button>
            </div>
          ))}
        </div>
      ))}
      <div className="card row between"><b>{t('total')}</b><b className="gold"><Money v={total} /></b></div>
      {blocked && <p className="err-text">{t('cart_has_unavailable')}</p>}
      <p className="small muted">{t('multi_seller_note')}</p>
      <Link className={`btn block ${blocked ? 'disabled' : ''}`} to="/checkout" onClick={(e) => blocked && e.preventDefault()} aria-disabled={blocked}>{t('checkout')}</Link>
    </div>
  );
}

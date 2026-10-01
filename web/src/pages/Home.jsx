import { Link } from 'react-router-dom';
import { useApi } from '../hooks.js';
import { useI18n } from '../i18n/index.jsx';
import { Async, HScroll, ProductCard, Section, ShopCard } from '../components/ui.jsx';

export default function Home() {
  const { t, catName } = useI18n();
  const res = useApi('/public/home');
  return (
    <Async res={res} empty={t('empty_home')}>
      {(d) => {
        const banner = d.banners[0];
        return (
          <>
            <div className="hero">
              <img className="bg" src="/brand/logo.webp" alt="" aria-hidden="true" />
              <h1>{banner?.title || t('hero_title')}</h1>
              <p className="muted" style={{ maxWidth: 480 }}>{banner?.subtitle || t('hero_sub')}</p>
              <Link className="btn" to={banner?.link || '/browse'}>{t('shop_now')}</Link>
            </div>
            <Section title={t('categories')}>
              <div className="chips">{d.categories.map((c) => <Link key={c.id} className="chip" to={`/browse?category=${c.id}`}>{catName(c)}</Link>)}</div>
            </Section>
            {d.featuredShops.length > 0 && <Section title={t('featured_shops')} to="/browse?view=shops"><HScroll>{d.featuredShops.map((s) => <ShopCard key={s.id} s={s} />)}</HScroll></Section>}
            {d.trending.length > 0 && <Section title={t('trending')} to="/browse?sort=popular"><HScroll>{d.trending.map((p) => <ProductCard key={p.id} p={p} />)}</HScroll></Section>}
            {d.popular.length > 0 && <Section title={t('popular')} to="/browse?sort=popular"><HScroll>{d.popular.map((p) => <ProductCard key={p.id} p={p} />)}</HScroll></Section>}
            {d.newArrivals.length > 0 && <Section title={t('new_arrivals')} to="/browse?sort=new"><HScroll>{d.newArrivals.map((p) => <ProductCard key={p.id} p={p} />)}</HScroll></Section>}
            {d.offers.length > 0 && <Section title={t('offers')}><HScroll>{d.offers.map((p) => <div key={p.id}><ProductCard p={p} /><div className="small gold center">{p.offer_title} · {p.percent_off}%</div></div>)}</HScroll></Section>}
            {d.verifiedShops.length > 0 && <Section title={t('verified_shops')}><HScroll>{d.verifiedShops.map((s) => <ShopCard key={s.id} s={s} />)}</HScroll></Section>}
            {!d.trending.length && !d.newArrivals.length && !d.featuredShops.length && <p className="muted center pad">{t('empty_home')}</p>}
            <div className="notice" style={{ marginTop: '1.5rem' }}>⚠ {t('safety_short')} <Link className="gold" to="/safety">{t('read_more')}</Link></div>
          </>
        );
      }}
    </Async>
  );
}

import { createContext, useCallback, useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/index.jsx';
import { rupees } from '../api.js';

export function Logo({ size = 40, className = '' }) {
  return <img src="/brand/logo-sm.webp" width={size} height={size} alt="MAVRIX FIRE" className={`logo ${className}`} style={{ width: size, height: size }} />;
}

export function Spinner() { return <div className="spinner" role="status" aria-label="loading" />; }
export const Loading = () => <div className="center pad"><Spinner /></div>;

export function ErrorState({ error, onRetry }) {
  const { t } = useI18n();
  return (
    <div className="state card">
      <p>{errText(t, error)}</p>
      {onRetry && <button className="btn" onClick={onRetry}>{t('retry')}</button>}
    </div>
  );
}
export function Empty({ text, action }) {
  return <div className="state card"><p className="muted">{text}</p>{action}</div>;
}
// Shared loading/error/empty wrapper for API-backed lists.
export function Async({ res, empty, isEmpty, children }) {
  if (res.loading && !res.data) return <Loading />;
  if (res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (isEmpty?.(res.data)) return <Empty text={empty} />;
  return children(res.data);
}

export function errText(t, e) {
  const code = e?.code || 'server_error';
  const k = `err.${code}`;
  const s = t(k);
  return s === k ? t('err.server_error') : s;
}

const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">{items.map((i) => <div key={i.id} className={`toast ${i.kind}`}>{i.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export const Money = ({ v }) => <>{rupees(v)}</>;

export function Stars({ value = 0, count }) {
  const full = Math.round(value);
  return <span className="stars" title={value}>{'★'.repeat(full)}<span className="dim">{'★'.repeat(5 - full)}</span>{count != null && <small> ({count})</small>}</span>;
}

export function Price({ p }) {
  const eff = p.discount_price ?? p.price;
  return (
    <span className="price">
      <b><Money v={eff} /></b>
      {p.discount_price != null && <><s className="muted"><Money v={p.price} /></s><em>{Math.round(100 - (p.discount_price * 100) / p.price)}%</em></>}
    </span>
  );
}

export function ProductCard({ p }) {
  const { t } = useI18n();
  return (
    <Link to={`/product/${p.id}`} className="pcard card">
      <div className="pimg">
        {p.images?.[0] ? <img src={p.images[0]} alt={p.name} loading="lazy" decoding="async" /> : <div className="noimg">🎆</div>}
        {!p.in_stock && <span className="oos">{t('out_of_stock')}</span>}
      </div>
      <div className="pbody">
        <div className="pname">{p.name}</div>
        <div className="muted small">{p.shop_name}{p.shop_verified && <span className="vtag" title={t('verified')}>✓</span>}</div>
        <Price p={p} />
        {p.rating_count > 0 && <Stars value={p.rating_avg} count={p.rating_count} />}
      </div>
    </Link>
  );
}

export function ShopCard({ s }) {
  const { t } = useI18n();
  return (
    <Link to={`/shop/${s.id}`} className="scard card">
      <div className="slogo">{s.logo_url ? <img src={s.logo_url} alt="" loading="lazy" /> : <span>🏪</span>}</div>
      <div>
        <div className="pname">{s.name}{s.verified && <span className="vtag" title={t('verified')}>✓ {t('verified')}</span>}</div>
        <div className="muted small">{s.city}</div>
        {s.rating_count > 0 && <Stars value={s.rating_avg} count={s.rating_count} />}
      </div>
    </Link>
  );
}

export function Section({ title, to, children }) {
  const { t } = useI18n();
  return (
    <section className="sec">
      <div className="sec-h"><h2>{title}</h2>{to && <Link to={to} className="small gold">{t('see_all')} →</Link>}</div>
      {children}
    </section>
  );
}
export const HScroll = ({ children }) => <div className="hscroll">{children}</div>;

export function Field({ label, children, hint }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small className="muted">{hint}</small>}</label>;
}

export function StatusBadge({ s }) {
  const { t } = useI18n();
  return <span className={`badge b-${s}`}>{t(`status.${s}`)}</span>;
}

export function Pager({ page, setPage, hasMore }) {
  const { t } = useI18n();
  return (
    <div className="pager">
      <button className="btn ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ {t('prev')}</button>
      <span className="muted">{page}</span>
      <button className="btn ghost" disabled={!hasMore} onClick={() => setPage(page + 1)}>{t('next')} ›</button>
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sec-h"><h3>{title}</h3><button className="btn ghost sm" onClick={onClose} aria-label="close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

// Multi-image upload (compressed + stored server-side; only URLs are kept).
export function ImagePicker({ value = [], onChange, max = 6, upload }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function add(e) {
    const files = [...e.target.files].slice(0, max - value.length);
    e.target.value = '';
    setBusy(true);
    try {
      const urls = [];
      for (const f of files) urls.push(await upload(f));
      onChange([...value, ...urls]);
    } catch (err) { toast(errText(t, err), 'err'); } finally { setBusy(false); }
  }
  return (
    <div className="imgpick">
      {value.map((u, i) => (
        <div className="thumb" key={u}><img src={u} alt="" /><button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="remove">✕</button></div>
      ))}
      {value.length < max && <label className="thumb add">{busy ? <Spinner /> : '+'}<input type="file" accept="image/*" multiple hidden onChange={add} disabled={busy} /></label>}
    </div>
  );
}

export function fmtDate(d) {
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

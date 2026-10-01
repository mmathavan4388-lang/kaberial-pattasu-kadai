import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { get } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Logo } from './ui.jsx';

export default function CustomerLayout() {
  const { t } = useI18n();
  const { user, cartCount } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [unread, setUnread] = useState(0);
  const [cities, setCities] = useState([]);
  useEffect(() => { get('/public/config').then((c) => setCities(c.allowedCities || [])).catch(() => {}); }, []);
  useEffect(() => {
    if (user?.role !== 'customer') return setUnread(0);
    const load = () => get('/notifications').then((r) => setUnread(r.unread)).catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [user]);

  const submit = (e) => { e.preventDefault(); nav(`/browse?q=${encodeURIComponent(q)}`); };
  const dest = (p) => (user?.role === 'customer' ? p : '/login');
  return (
    <>
      <header className="topbar">
        <div className="in">
          <Link to="/" className="brand"><Logo size={34} /><span>MAVRIX FIRE</span></Link>
          <form className="search" onSubmit={submit}><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search_placeholder')} aria-label={t('search')} /></form>
          <button className="iconbtn" onClick={() => nav(dest('/notifications'))} aria-label={t('notifications')}>🔔{unread > 0 && <span className="dot">{unread}</span>}</button>
          <button className="iconbtn" onClick={() => nav('/profile')} aria-label={t('profile')}>👤</button>
        </div>
        <div className="locbar">📍 {cities.join(', ') || 'Sivakasi'}</div>
      </header>
      <main className="shell page"><Outlet /><div className="footer">MAVRIX FIRE · by SAYRIX</div></main>
      <nav className="bottomnav" aria-label="main">
        <NavLink to="/" end><span>⌂</span>{t('nav.home')}</NavLink>
        <NavLink to="/browse"><span>⌕</span>{t('nav.browse')}</NavLink>
        <NavLink to="/cart"><span>🛒{cartCount > 0 && <span className="dot" style={{ position: 'static', marginLeft: 2 }}>{cartCount}</span>}</span>{t('nav.cart')}</NavLink>
        <NavLink to="/orders"><span>📦</span>{t('nav.orders')}</NavLink>
        <NavLink to="/profile"><span>☰</span>{t('nav.profile')}</NavLink>
      </nav>
    </>
  );
}

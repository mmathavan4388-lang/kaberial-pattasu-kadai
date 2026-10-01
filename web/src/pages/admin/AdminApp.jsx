import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { get, post } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { errText, Field, Loading, Logo } from '../../components/ui.jsx';
import { NotificationList } from '../../components/notif.jsx';
import Panels from './Panels.jsx';

const LINKS = ['dashboard', 'sellers', 'customers', 'products', 'categories', 'orders', 'finance', 'support', 'reviews', 'marketing', 'notifications', 'audit', 'settings'];

export default function AdminApp() {
  const { user, setUser, logout } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  if (user === undefined) return <Loading />;
  if (user?.role !== 'admin') {
    return (
      <Routes>
        <Route path="setup" element={<Setup />} />
        <Route path="*" element={<AdminLogin onDone={setUser} />} />
      </Routes>
    );
  }
  return (
    <>
      <header className="topbar"><div className="in">
        <Link to="/admin" className="brand"><Logo size={34} /><span>MAVRIX FIRE · ADMIN</span></Link><span className="grow" />
        <button className="btn ghost sm" onClick={async () => { await logout(); nav('/admin'); }}>{t('logout')}</button>
      </div></header>
      <main className="shell page" style={{ maxWidth: 1400 }}>
        <div className="dash">
          <nav className="side">{LINKS.map((l) => <NavLink key={l} to={`/admin/${l === 'dashboard' ? '' : l}`} end={l === 'dashboard'} className={({ isActive }) => (isActive ? 'on' : '')}>{t(`admin.nav.${l}`)}</NavLink>)}</nav>
          <div className="stack" style={{ minWidth: 0 }}>
            <Routes>
              <Route path="notifications" element={<div className="stack"><h1>{t('notifications')}</h1><NotificationList linkFor={(n) => n.data?.ticketId ? `/admin/support?open=${n.data.ticketId}` : n.type === 'seller_registered' ? '/admin/sellers' : null} /></div>} />
              <Route path="*" element={<Panels />} />
            </Routes>
          </div>
        </div>
      </main>
    </>
  );
}

function AdminLogin({ onDone }) {
  const { t } = useI18n();
  const [f, setF] = useState({ email: '', password: '', otp: '' });
  const [needOtp, setNeedOtp] = useState(false);
  const [err, setErr] = useState(null);
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { get('/admin/setup/status').then((r) => setSetup(r.setupAvailable)).catch(() => {}); }, []);
  async function submit(e) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { const { user } = await post('/admin/login', { email: f.email, password: f.password, otp: f.otp || undefined }); onDone(user); }
    catch (x) { if (x.code === 'otp_required') setNeedOtp(true); else setErr(x); } finally { setBusy(false); }
  }
  return (
    <div className="authbox page">
      <div className="head"><Logo size={56} /><h2>{t('admin_login')}</h2></div>
      <form className="card stack" onSubmit={submit}>
        <Field label="Email"><input type="email" required autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={t('admin_password')}><input type="password" required autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        {needOtp && <Field label={t('otp_code')}><input inputMode="numeric" maxLength={6} autoFocus value={f.otp} onChange={(e) => setF({ ...f, otp: e.target.value })} /></Field>}
        {err && <p className="err-text">{errText(t, err)}</p>}
        <button className="btn" disabled={busy}>{t('login')}</button>
        {setup && <p className="small center"><Link className="gold" to="/admin/setup">{t('first_admin_setup')}</Link></p>}
      </form>
    </div>
  );
}

function Setup() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [avail, setAvail] = useState(null);
  const [f, setF] = useState({ email: '', password: '', confirmPassword: '', setupToken: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { get('/admin/setup/status').then((r) => setAvail(r.setupAvailable)).catch(() => setAvail(false)); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await post('/admin/setup', f); nav('/admin', { replace: true }); } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  if (avail === null) return <Loading />;
  if (!avail) return <div className="authbox"><div className="card state"><p>{t('setup_unavailable')}</p><Link className="btn" to="/admin">{t('admin_login')}</Link></div></div>;
  return (
    <div className="authbox page">
      <div className="head"><Logo size={56} /><h2>{t('first_admin_setup')}</h2><p className="muted small">{t('setup_note')}</p></div>
      <form className="card stack" onSubmit={submit}>
        <Field label="Admin Gmail / email"><input type="email" required value={f.email} onChange={set('email')} /></Field>
        <Field label={t('admin_password')} hint={t('admin_password_hint')}><input type="password" required minLength={12} autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        <Field label={t('confirm_password')}><input type="password" required autoComplete="new-password" value={f.confirmPassword} onChange={set('confirmPassword')} /></Field>
        <Field label={t('setup_token')} hint={t('setup_token_hint')}><input type="password" required value={f.setupToken} onChange={set('setupToken')} /></Field>
        <div className="notice danger small">{t('never_gmail_password')}</div>
        {err && <p className="err-text">{errText(t, err)}</p>}
        <button className="btn" disabled={busy}>{t('create_admin')}</button>
      </form>
    </div>
  );
}

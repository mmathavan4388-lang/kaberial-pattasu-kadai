import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { patch, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { LANGS, useI18n } from '../i18n/index.jsx';
import { errText, Field, Logo, useToast } from '../components/ui.jsx';

export default function Profile() {
  const { t, lang, setLang } = useI18n();
  const { user, setUser, logout } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  async function chooseLang(l) {
    setLang(l);
    if (user) patch('/auth/me', { language: l }).catch(() => {});
  }
  async function otp(kind) {
    try {
      if (kind === 'send') { await post('/auth/otp/request'); setOtpSent(true); toast(t('otp_sent')); }
      else { await post('/auth/otp/verify', { code }); setUser({ ...user, mobileVerified: true }); toast(t('mobile_verified')); }
    } catch (e) { toast(errText(t, e), 'err'); }
  }
  return (
    <div className="stack">
      <div className="card center" style={{ flexDirection: 'column', textAlign: 'center' }}>
        <Logo size={96} /><h2 className="gold" style={{ margin: '.4rem 0 0' }}>MAVRIX FIRE</h2><div className="muted small">by SAYRIX</div>
      </div>
      {user ? (
        <div className="card stack">
          <div><b>{user.name}</b><div className="muted small">{user.mobile} {user.email && `· ${user.email}`}</div></div>
          {user.role === 'customer' && !user.mobileVerified && (
            <div className="notice stack"><div>{t('mobile_not_verified')}</div>
              <div className="row"><button className="btn sm" onClick={() => otp('send')}>{t('send_otp')}</button>
                {otpSent && <><input style={{ width: 120 }} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="OTP" /><button className="btn sm" onClick={() => otp('verify')}>{t('verify')}</button></>}</div></div>
          )}
          {user.role === 'customer' && <div className="chips"><Link className="chip" to="/orders">{t('nav.orders')}</Link><Link className="chip" to="/wishlist">{t('wishlist')}</Link><Link className="chip" to="/support">{t('customer_care')}</Link><Link className="chip" to="/notifications">{t('notifications')}</Link></div>}
          {user.role === 'seller' && <Link className="btn" to="/seller">{t('seller_dashboard')}</Link>}
        </div>
      ) : (
        <div className="card row"><Link className="btn grow" to="/login">{t('login')}</Link><Link className="btn ghost grow" to="/register">{t('register')}</Link></div>
      )}
      <div className="card stack">
        <h3>{t('language')}</h3>
        <div className="chips">{LANGS.map((l) => <button key={l.code} className={`chip ${lang === l.code ? 'on' : ''}`} onClick={() => chooseLang(l.code)}>{l.label}</button>)}</div>
      </div>
      <div className="card stack">
        <Link to="/safety" className="gold">⚠ {t('safety_title')}</Link>
        {!user && <Link to="/seller/register" className="gold">{t('become_seller')}</Link>}
        {user && <>
          <button className="btn ghost" onClick={async () => { await post('/auth/logout-all'); setUser(null); nav('/'); }}>{t('logout_all')}</button>
          <button className="btn red" onClick={async () => { await logout(); nav('/'); }}>{t('logout')}</button></>}
      </div>
      <div className="footer">MAVRIX FIRE · by SAYRIX · v1.0</div>
    </div>
  );
}

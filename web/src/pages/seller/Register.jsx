import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { patch, post, uploadImage } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { errText, Field, ImagePicker, Logo } from '../../components/ui.jsx';

// No licence / documents fields by design. Bank details are collected by the payment
// provider's secure onboarding after admin approval, never typed into this app.
export default function SellerRegister() {
  const { t, lang } = useI18n();
  const { setUser } = useAuth();
  const [step, setStep] = useState(1); // 2 = add photos (needs the new session to upload)
  const nav = useNavigate();
  const [f, setF] = useState({ shopName: '', ownerName: '', mobile: '', email: '', password: '', address: '', businessInfo: '' });
  const [photos, setPhotos] = useState([]);
  const [created, setCreated] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const r = await post('/seller/register', { ...f, businessInfo: f.businessInfo || undefined, photos: [], language: lang });
      setCreated(r.user); setStep(2);
    } catch (x) { setErr(x); } finally { setBusy(false); }
  }
  async function finish() {
    setBusy(true);
    try { if (photos.length) await patch('/seller/shop', { photos, logoUrl: photos[0] }); } catch (x) { setErr(x); setBusy(false); return; }
    setUser(created); nav('/seller', { replace: true });
  }
  if (step === 2) {
    return (
      <div className="authbox page" style={{ maxWidth: 560 }}>
        <div className="head"><Logo size={56} /><h2>{t('shop_photos')}</h2><p className="muted small">{t('application_received')}</p></div>
        <div className="card stack">
          <ImagePicker value={photos} onChange={setPhotos} max={6} upload={uploadImage} />
          {err && <p className="err-text">{errText(t, err)}</p>}
          <button className="btn" disabled={busy} onClick={finish}>{photos.length ? t('save') : t('skip_for_now')}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="authbox page" style={{ maxWidth: 560 }}>
      <div className="head"><Link to="/"><Logo size={56} /></Link><h2>{t('seller_register')}</h2><p className="muted small">{t('seller_register_note')}</p></div>
      <form className="card stack" onSubmit={submit}>
        <Field label={t('shop_name')}><input required minLength={2} value={f.shopName} onChange={set('shopName')} /></Field>
        <Field label={t('owner_name')}><input required minLength={2} value={f.ownerName} onChange={set('ownerName')} /></Field>
        <div className="field-row">
          <Field label={t('mobile')}><input required inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} value={f.mobile} onChange={set('mobile')} /></Field>
          <Field label={t('email')}><input required type="email" value={f.email} onChange={set('email')} /></Field>
        </div>
        <Field label={t('password')} hint={t('password_hint')}><input required type="password" minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        <Field label={t('shop_address')}><textarea required minLength={5} value={f.address} onChange={set('address')} /></Field>
        <Field label={t('business_info')}><textarea value={f.businessInfo} onChange={set('businessInfo')} /></Field>
        <p className="small muted">{t('seller_fee_note')}</p>
        {err && <p className="err-text">{errText(t, err)}{err.details?.[0] && ` (${err.details[0].path})`}</p>}
        <button className="btn block" disabled={busy}>{t('submit_application')}</button>
        <p className="small center muted"><Link to="/login" className="gold">{t('login')}</Link></p>
      </form>
    </div>
  );
}

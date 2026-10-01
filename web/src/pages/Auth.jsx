import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n/index.jsx';
import { errText, Field, Logo } from '../components/ui.jsx';
import { useAction } from '../hooks.js';

function Shell({ title, children }) {
  return (
    <div className="authbox page">
      <div className="head"><Link to="/"><Logo size={56} /></Link><h2 style={{ marginTop: '.6rem' }}>{title}</h2></div>
      <div className="card">{children}</div>
    </div>
  );
}
const home = (u) => (u.role === 'seller' ? '/seller' : '/');

export function Login() {
  const { t } = useI18n();
  const { setUser } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [f, setF] = useState({ identifier: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, run] = useAction();
  const submit = (e) => {
    e.preventDefault(); setErr(null);
    run(async () => {
      try { const { user } = await post('/auth/login', f); setUser(user); nav(loc.state?.from || home(user), { replace: true }); }
      catch (x) { setErr(x); }
    });
  };
  return (
    <Shell title={t('login')}>
      <form className="stack" onSubmit={submit}>
        <Field label={t('email_or_mobile')}><input autoComplete="username" required value={f.identifier} onChange={(e) => setF({ ...f, identifier: e.target.value })} /></Field>
        <Field label={t('password')}><input type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        {err && <p className="err-text">{errText(t, err)}</p>}
        <button className="btn block" disabled={busy}>{t('login')}</button>
        <p className="small muted center">{t('no_account')}&nbsp;<Link className="gold" to="/register">{t('register')}</Link></p>
        <p className="small muted center"><Link className="gold" to="/seller/register">{t('become_seller')}</Link></p>
      </form>
    </Shell>
  );
}

export function Register() {
  const { t, lang } = useI18n();
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', mobile: '', email: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, run] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault(); setErr(null);
    run(async () => {
      try {
        const body = { ...f, language: lang }; if (!body.email) delete body.email;
        const { user } = await post('/auth/register', body); setUser(user); nav('/profile', { replace: true });
      } catch (x) { setErr(x); }
    });
  };
  return (
    <Shell title={t('register')}>
      <form className="stack" onSubmit={submit}>
        <Field label={t('name')}><input required minLength={2} value={f.name} onChange={set('name')} /></Field>
        <Field label={t('mobile')}><input required inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} value={f.mobile} onChange={set('mobile')} /></Field>
        <Field label={t('email_optional')}><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label={t('password')} hint={t('password_hint')}><input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        {err && <p className="err-text">{errText(t, err)}{err.details?.[0] && ` (${err.details[0].path})`}</p>}
        <button className="btn block" disabled={busy}>{t('register')}</button>
        <p className="small muted center">{t('have_account')}&nbsp;<Link className="gold" to="/login">{t('login')}</Link></p>
      </form>
    </Shell>
  );
}

import { Logo } from '../components/ui.jsx';
import { LANGS, useI18n } from '../i18n/index.jsx';

export default function LanguageSelect() {
  const { setLang } = useI18n();
  return (
    <div className="authbox page">
      <div className="head"><Logo size={96} /><h1 className="gold">MAVRIX FIRE</h1>
        <p className="muted">தமிழ் · हिन्दी · English</p></div>
      <div className="langgrid">
        {LANGS.map((l) => (
          <button key={l.code} className="card langbtn" onClick={() => setLang(l.code)}>
            <span>{l.label}</span><span className="muted small">{l.english}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

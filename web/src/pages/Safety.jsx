import { useI18n } from '../i18n/index.jsx';

export default function Safety() {
  const { t } = useI18n();
  return (
    <div className="stack">
      <h1>⚠ {t('safety_title')}</h1>
      <div className="card"><ul className="stack" style={{ margin: 0, paddingLeft: '1.1rem' }}>
        {[1, 2, 3, 4, 5, 6, 7].map((n) => <li key={n}>{t(`safety_${n}`)}</li>)}
      </ul></div>
      <p className="muted small">{t('legal_note')}</p>
    </div>
  );
}

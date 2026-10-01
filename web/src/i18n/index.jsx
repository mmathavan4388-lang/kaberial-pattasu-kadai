import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from './en.js';
import ta from './ta.js';
import hi from './hi.js';

const DICTS = { en, ta, hi };
export const LANGS = [
  { code: 'ta', label: 'தமிழ்', english: 'Tamil' },
  { code: 'hi', label: 'हिन्दी', english: 'Hindi' },
  { code: 'en', label: 'English', english: 'English' },
];

const Ctx = createContext(null);
const read = () => { try { return localStorage.getItem('mf_lang'); } catch { return null; } };

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(read());
  useEffect(() => { document.documentElement.lang = lang || 'en'; }, [lang]);
  const setLang = useCallback((l) => {
    try { localStorage.setItem('mf_lang', l); } catch { /* private mode */ }
    setLangState(l);
  }, []);
  const t = useCallback((key, vars) => {
    let s = DICTS[lang || 'en']?.[key] ?? DICTS.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
    return s;
  }, [lang]);
  // Category names come from the database in all three languages.
  const catName = useCallback((c) => (c ? c[`name_${lang || 'en'}`] || c.name_en : ''), [lang]);
  const value = useMemo(() => ({ lang, setLang, t, catName, chosen: !!lang }), [lang, setLang, t, catName]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useI18n = () => useContext(Ctx);

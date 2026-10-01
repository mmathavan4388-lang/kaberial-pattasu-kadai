import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api.js';

// Loads data with explicit loading / error states and a retry callback.
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await get(path);
      if (my === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (my === seq.current) setState({ data: null, error, loading: false });
    }
  }, [path]); // eslint-disable-line
  useEffect(() => { load(); }, [load, ...deps]); // eslint-disable-line
  return { ...state, reload: load };
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn) => {
    setBusy(true);
    try { return await fn(); } finally { setBusy(false); }
  }, []);
  return [busy, run];
}

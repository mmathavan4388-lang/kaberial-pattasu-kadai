import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { get, post, put as _put, del as _del } from './api.js';
import { useI18n } from './i18n/index.jsx';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [cart, setCart] = useState([]);
  const { setLang, chosen } = useI18n();

  const refreshCart = useCallback(async (u = user) => {
    if (u?.role !== 'customer') return setCart([]);
    try { setCart((await get('/me/cart')).items); } catch { /* shown on cart page */ }
  }, [user]);

  useEffect(() => {
    get('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);
  useEffect(() => {
    if (user) {
      if (!chosen && user.language) setLang(user.language);
      refreshCart(user);
    } else setCart([]);
  }, [user]); // eslint-disable-line

  const logout = useCallback(async () => { await post('/auth/logout'); setUser(null); }, []);
  const setQty = useCallback(async (productId, qty) => { await _put(`/me/cart/${productId}`, { qty }); await refreshCart(); }, [refreshCart]);
  const value = { user, setUser, logout, cart, refreshCart, setQty, cartCount: cart.reduce((a, i) => a + i.qty, 0) };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);

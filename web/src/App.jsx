import { lazy, Suspense, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useI18n } from './i18n/index.jsx';
import { Loading } from './components/ui.jsx';
import Splash from './pages/Splash.jsx';
import LanguageSelect from './pages/LanguageSelect.jsx';
import CustomerLayout from './components/CustomerLayout.jsx';
import Home from './pages/Home.jsx';
import { Login, Register } from './pages/Auth.jsx';

// Seller and admin areas are code-split: customers never download them.
const Browse = lazy(() => import('./pages/Browse.jsx'));
const Product = lazy(() => import('./pages/Product.jsx'));
const Shop = lazy(() => import('./pages/Shop.jsx'));
const Cart = lazy(() => import('./pages/Cart.jsx'));
const Checkout = lazy(() => import('./pages/Checkout.jsx'));
const Orders = lazy(() => import('./pages/Orders.jsx'));
const Wishlist = lazy(() => import('./pages/Wishlist.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const Support = lazy(() => import('./pages/Support.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Safety = lazy(() => import('./pages/Safety.jsx'));
const SellerRegister = lazy(() => import('./pages/seller/Register.jsx'));
const SellerApp = lazy(() => import('./pages/seller/SellerApp.jsx'));
const AdminApp = lazy(() => import('./pages/admin/AdminApp.jsx'));

function RequireRole({ role, to, children }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (user === undefined) return <Loading />;
  if (!user || user.role !== role) return <Navigate to={to} state={{ from: loc.pathname }} replace />;
  return children;
}

export default function App() {
  const { chosen } = useI18n();
  const [splash, setSplash] = useState(() => { try { return !sessionStorage.getItem('mf_splash'); } catch { return true; } });
  const loc = useLocation();

  if (splash && !loc.pathname.startsWith('/admin')) {
    return <Splash onDone={() => { try { sessionStorage.setItem('mf_splash', '1'); } catch { /* ignore */ } setSplash(false); }} />;
  }
  if (!chosen && !loc.pathname.startsWith('/admin')) return <LanguageSelect />;

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/seller/register" element={<SellerRegister />} />
        <Route path="/seller/*" element={<RequireRole role="seller" to="/login"><SellerApp /></RequireRole>} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route element={<CustomerLayout />}>
          <Route index element={<Home />} />
          <Route path="browse" element={<Browse />} />
          <Route path="product/:id" element={<Product />} />
          <Route path="shop/:id" element={<Shop />} />
          <Route path="safety" element={<Safety />} />
          <Route path="cart" element={<RequireRole role="customer" to="/login"><Cart /></RequireRole>} />
          <Route path="checkout" element={<RequireRole role="customer" to="/login"><Checkout /></RequireRole>} />
          <Route path="orders/*" element={<RequireRole role="customer" to="/login"><Orders /></RequireRole>} />
          <Route path="wishlist" element={<RequireRole role="customer" to="/login"><Wishlist /></RequireRole>} />
          <Route path="notifications" element={<RequireRole role="customer" to="/login"><Notifications /></RequireRole>} />
          <Route path="support/*" element={<RequireRole role="customer" to="/login"><Support /></RequireRole>} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

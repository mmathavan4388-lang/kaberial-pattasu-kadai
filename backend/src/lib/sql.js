// A shop can sell only while approved AND its 6-month subscription is active.
export const SHOP_LIVE = `(s.status = 'approved' AND EXISTS (
  SELECT 1 FROM shop_subscriptions ss WHERE ss.shop_id = s.id AND ss.status = 'active' AND ss.expires_at > now()))`;

// Products shown to customers (join: products p JOIN shops s).
export const PRODUCT_LIVE = `(p.deleted_at IS NULL AND p.status = 'approved' AND p.visible AND ${SHOP_LIVE})`;

export const PRODUCT_COLS = `p.id, p.name, p.price, p.discount_price, p.pack_quantity, p.images, p.stock,
  p.available, p.featured, p.rating_avg, p.rating_count, p.category_id, p.shop_id,
  (p.available AND p.stock > 0) AS in_stock,
  s.name AS shop_name, s.verified AS shop_verified`;

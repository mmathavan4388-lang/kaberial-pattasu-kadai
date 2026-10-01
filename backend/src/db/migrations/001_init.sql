-- MAVRIX FIRE v1.0 schema. All money is stored in paise (integer).
-- Users never get hard-deleted (deleted_at); orders/payments/support are never deleted.

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role            text NOT NULL CHECK (role IN ('customer','seller','admin')),
  name            text NOT NULL,
  email           text,
  mobile          text,
  password_hash   text NOT NULL,
  mobile_verified boolean NOT NULL DEFAULT false,
  language        text NOT NULL DEFAULT 'en' CHECK (language IN ('en','ta','hi')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  token_version   integer NOT NULL DEFAULT 0,
  totp_secret     text,
  totp_enabled    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE UNIQUE INDEX users_mobile_uq ON users (mobile) WHERE deleted_at IS NULL AND mobile IS NOT NULL;
-- Exactly ONE admin can ever exist. Enforced by the database, not only by app code.
CREATE UNIQUE INDEX users_single_admin ON users (role) WHERE role = 'admin';

CREATE TABLE otps (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  mobile      text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shops (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            uuid NOT NULL UNIQUE REFERENCES users(id),
  name                text NOT NULL,
  owner_name          text NOT NULL,
  mobile              text NOT NULL,
  email               text NOT NULL,
  address             text NOT NULL,
  city                text NOT NULL DEFAULT 'Sivakasi',
  business_info       text,
  logo_url            text,
  photos              jsonb NOT NULL DEFAULT '[]',
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','update_required','suspended')),
  status_note         text,
  razorpay_account_id text,            -- linked account for split settlement (Razorpay Route)
  delivery_enabled    boolean NOT NULL DEFAULT false, -- admin compliance control
  pickup_enabled      boolean NOT NULL DEFAULT true,
  verified            boolean NOT NULL DEFAULT false,
  rating_avg          numeric(3,2) NOT NULL DEFAULT 0,
  rating_count        integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shops_status_idx ON shops (status);

CREATE TABLE shop_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shops(id),
  payment_id  uuid,
  amount      bigint NOT NULL,
  starts_at   timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired')),
  reminders   jsonb NOT NULL DEFAULT '[]',   -- reminder days already sent (30, 7, 1)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shop_subscriptions_shop_idx ON shop_subscriptions (shop_id, expires_at DESC);

CREATE TABLE categories (
  id         serial PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  name_en    text NOT NULL,
  name_ta    text NOT NULL,
  name_hi    text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true
);

CREATE TABLE products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shops(id),
  category_id    integer REFERENCES categories(id),
  name           text NOT NULL,
  description    text,
  price          bigint NOT NULL CHECK (price > 0),
  discount_price bigint CHECK (discount_price IS NULL OR (discount_price > 0 AND discount_price <= price)),
  pack_quantity  text,
  stock          integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  available      boolean NOT NULL DEFAULT true,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','removed')),
  visible        boolean NOT NULL DEFAULT true,
  featured       boolean NOT NULL DEFAULT false,
  images         jsonb NOT NULL DEFAULT '[]',
  safety_notes   text,
  rating_avg     numeric(3,2) NOT NULL DEFAULT 0,
  rating_count   integer NOT NULL DEFAULT 0,
  sales_count    integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  search         tsvector GENERATED ALWAYS AS
                 (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(description,''))) STORED
);
CREATE INDEX products_search_idx ON products USING gin (search);
CREATE INDEX products_shop_idx ON products (shop_id) WHERE deleted_at IS NULL;
CREATE INDEX products_category_idx ON products (category_id) WHERE deleted_at IS NULL;
CREATE INDEX products_created_idx ON products (created_at DESC);
CREATE INDEX products_sales_idx ON products (sales_count DESC);

CREATE TABLE cart_items (
  user_id    uuid NOT NULL REFERENCES users(id),
  product_id uuid NOT NULL REFERENCES products(id),
  qty        integer NOT NULL CHECK (qty > 0 AND qty <= 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE wishlist_items (
  user_id    uuid NOT NULL REFERENCES users(id),
  product_id uuid NOT NULL REFERENCES products(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

-- One customer checkout = one order; split into one sub-order per seller.
CREATE TABLE orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no         text NOT NULL UNIQUE,
  customer_id      uuid NOT NULL REFERENCES users(id),
  total            bigint NOT NULL,
  status           text NOT NULL DEFAULT 'pending_payment'
                   CHECK (status IN ('pending_payment','paid','cancelled','expired')),
  contact_name     text NOT NULL,
  contact_mobile   text NOT NULL,
  address          jsonb NOT NULL,
  age_confirmed    boolean NOT NULL,
  safety_ack       boolean NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  paid_at          timestamptz
);
CREATE INDEX orders_customer_idx ON orders (customer_id, created_at DESC);
CREATE INDEX orders_pending_idx ON orders (created_at) WHERE status = 'pending_payment';

CREATE TABLE sub_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders(id),
  shop_id           uuid NOT NULL REFERENCES shops(id),
  subtotal          bigint NOT NULL,
  commission_bps    integer NOT NULL,
  commission        bigint NOT NULL,      -- platform share, computed automatically
  settlement        bigint NOT NULL,      -- seller share = subtotal - commission
  fulfilment        text NOT NULL CHECK (fulfilment IN ('pickup','seller_delivery')),
  status            text NOT NULL DEFAULT 'pending_payment'
                    CHECK (status IN ('pending_payment','placed','accepted','preparing','ready',
                                      'dispatched','out_for_delivery','delivered','completed','cancelled')),
  transfer_id       text,
  settlement_status text NOT NULL DEFAULT 'pending'
                    CHECK (settlement_status IN ('pending','held','released','settled','reversed','failed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (commission + settlement = subtotal)
);
CREATE INDEX sub_orders_shop_idx ON sub_orders (shop_id, created_at DESC);
CREATE INDEX sub_orders_order_idx ON sub_orders (order_id);

CREATE TABLE order_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_order_id  uuid NOT NULL REFERENCES sub_orders(id),
  product_id    uuid NOT NULL REFERENCES products(id),
  name          text NOT NULL,
  image         text,
  unit_price    bigint NOT NULL,
  qty           integer NOT NULL CHECK (qty > 0),
  line_total    bigint NOT NULL
);
CREATE INDEX order_items_sub_idx ON order_items (sub_order_id);

CREATE TABLE order_events (
  id           bigserial PRIMARY KEY,
  sub_order_id uuid NOT NULL REFERENCES sub_orders(id),
  status       text NOT NULL,
  note         text,
  actor_id     uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_sub_idx ON order_events (sub_order_id, id);

CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose             text NOT NULL CHECK (purpose IN ('order','subscription')),
  order_id            uuid REFERENCES orders(id),
  shop_id             uuid REFERENCES shops(id),
  provider            text NOT NULL DEFAULT 'razorpay',
  provider_order_id   text NOT NULL UNIQUE,
  provider_payment_id text,
  amount              bigint NOT NULL,
  currency            text NOT NULL DEFAULT 'INR',
  status              text NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','failed','refunded')),
  method              text,
  failure_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz
);
CREATE INDEX payments_order_idx ON payments (order_id);

CREATE TABLE webhook_events (
  event_id     text PRIMARY KEY,         -- idempotency key from the provider
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_order_id       uuid NOT NULL REFERENCES sub_orders(id),
  payment_id         uuid NOT NULL REFERENCES payments(id),
  amount             bigint NOT NULL,
  reason             text,
  status             text NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated','processed','failed')),
  provider_refund_id text,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES products(id),
  shop_id        uuid NOT NULL REFERENCES shops(id),
  customer_id    uuid NOT NULL REFERENCES users(id),
  sub_order_id   uuid NOT NULL REFERENCES sub_orders(id),
  rating         integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body           text,
  image_url      text,
  status         text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','removed')),
  report_count   integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, product_id)
);
CREATE TABLE review_reports (
  review_id  uuid NOT NULL REFERENCES reviews(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, user_id)
);

-- Notifications store a type + data; the client renders the text in the user's language.
CREATE TABLE notifications (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id),
  type       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, id DESC);

CREATE TABLE support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no   text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES users(id),
  category    text NOT NULL CHECK (category IN ('order','payment','product','delivery','refund','seller','other')),
  order_no    text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_status_idx ON support_tickets (status, updated_at DESC);
CREATE INDEX support_tickets_customer_idx ON support_tickets (customer_id, updated_at DESC);

CREATE TABLE support_messages (
  id          bigserial PRIMARY KEY,
  ticket_id   uuid NOT NULL REFERENCES support_tickets(id),
  sender_id   uuid NOT NULL REFERENCES users(id),
  sender_role text NOT NULL CHECK (sender_role IN ('customer','admin')),
  body        text NOT NULL,
  image_url   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_messages_ticket_idx ON support_messages (ticket_id, id);

CREATE TABLE offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shops(id),
  product_id  uuid NOT NULL REFERENCES products(id),
  title       text NOT NULL,
  percent_off integer NOT NULL CHECK (percent_off BETWEEN 1 AND 90),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','disabled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE banners (
  id         serial PRIMARY KEY,
  title      text NOT NULL,
  subtitle   text,
  image_url  text,
  link       text,
  sort_order integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true
);

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id         bigserial PRIMARY KEY,
  actor_id   uuid,
  actor_role text,
  action     text NOT NULL,
  entity     text,
  entity_id  text,
  meta       jsonb NOT NULL DEFAULT '{}',
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (id DESC);

-- Audit logs are append-only.
CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

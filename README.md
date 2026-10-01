# MAVRIX FIRE — by SAYRIX

Multi-vendor fireworks marketplace (launch city: **Sivakasi**). Splash credit: `from SAYRIX MATHAV`.
Official logo: `web/public/brand/` (the uploaded artwork, resized only — never redrawn or recoloured).

## Architecture
| Layer | Implementation |
|---|---|
| Customer app / Seller dashboard / Admin panel | React (Vite) PWA in `web/`, mobile-first, code-split per role, Tamil / Hindi / English (static dictionaries in `web/src/i18n`, no AI) |
| API | Node 20+ / Express 5 in `backend/` (zod validation, helmet, rate limits, role checks enforced server-side) |
| Database | PostgreSQL (Supabase/RDS/any). Forward-only SQL migrations in `backend/src/db/migrations`, applied on boot. Dev/tests use embedded PGlite |
| Storage | S3-compatible object storage (`S3_*` env); only URLs are stored in the DB. Local `./uploads` in dev. Images are validated and re-encoded to WebP server-side |
| Payments | Razorpay: UPI/GPay only (no COD) with **Razorpay Route** split settlement. "Paid" comes only from the HMAC-verified webhook or HMAC-verified checkout callback |
| Auth | bcrypt, httpOnly SameSite=Strict JWT cookie, token versioning (logout-all), CSRF header, optional admin TOTP 2FA, append-only audit log |

## Key rules implemented
- **One admin only**: DB unique index + one-time First Admin Setup guarded by `ADMIN_SETUP_TOKEN`; permanently disabled afterwards; no public admin registration.
- Seller: ₹199 / 6 months (paid after approval; renewal extends expiry; reminders at 30/7/1 days). 5 % commission computed per seller sub-order and sent as a split transfer held until delivery/pickup. No licence/document fields at registration.
- Multi-seller cart → one order, one sub-order per seller. Stock is reserved atomically at checkout and released on expiry/cancel/refund; out-of-stock can't be bought.
- Compliance controls: 18+ and safety acknowledgement at checkout, admin approval of every product, seller delivery only when admin enables it for that seller and the city is allowed; otherwise pickup.
- Customer Care: tickets → admin inbox → admin replies → in-app notifications both ways; Open/Pending/Resolved.
- Soft deletes for users/products; orders, payments, refunds, support and audit logs are never deleted.

## Easiest: run on your computer
```
npm run setup && npm run build && npm start     # then open http://localhost:4000
```
Admin setup token in dev is `dev-setup-token`.

## One-click deploy
Render > New > Blueprint > select this repo (`render.yaml` creates the app + Postgres). Read `ADMIN_SETUP_TOKEN` from Render > Environment, then open `/admin/setup`.

## Run locally (dev mode)
```
cd backend && npm i && ADMIN_SETUP_TOKEN=choose-a-secret npm run dev   # API :4000, embedded DB
cd web && npm i && npm run dev                                        # UI :5173 (proxies /api)
cd backend && npm test                                                # 13 integration tests
```
Open `/admin/setup` and enter an admin email, a **new** App Admin Password and the setup token (never a Gmail password).

## Deploy
`cd web && npm run build`, then run `backend` with the env from `backend/.env.example` (the API serves `web/dist`). HTTPS is required in production (HSTS + redirect enabled). Point Razorpay's webhook at `/api/payments/webhook` (events: `payment.captured`, `payment.failed`, `order.paid`, `transfer.processed`, `transfer.failed`).
Updates (v1.1, v1.2…): add a new numbered `.sql` file to `migrations/`; it runs once and existing data is untouched. Enable automated daily backups + PITR on your Postgres host.

## Not done / needs your accounts or decisions before go-live
- **Razorpay Route**: needs a live account with Route enabled. API calls follow the public docs but were only tested against stubs — verify in the sandbox. Seller bank/KYC happens on Razorpay's onboarding, not in this app.
- **SMS OTP**: no provider bundled (`services/sms.js`); set `REQUIRE_MOBILE_VERIFICATION=false` until wired. **Google login** and **push notifications** are not implemented (notifications are in-app, polled every 60 s).
- **Tamil/Hindi text** was written by hand; have a native speaker review it.
- Rate limiting is in-memory (use Redis for multiple instances). No GST/delivery-fee logic. Legal compliance (licences, permitted hours/areas) must be confirmed with a Tamil Nadu fireworks-law advisor.
- No committed browser tests (backend flow tests are).

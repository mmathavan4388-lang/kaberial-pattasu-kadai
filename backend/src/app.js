import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { HttpError } from './lib/http.js';
import { loadUser, csrfGuard } from './middleware/auth.js';
import { globalLimiter } from './middleware/limits.js';
import { auth } from './routes/auth.js';
import { pub } from './routes/public.js';
import { me } from './routes/customer.js';
import { seller } from './routes/seller.js';
import { admin } from './routes/admin.js';
import { shared, webhook, webhookHandler } from './routes/shared.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind the platform's HTTPS terminator
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
        frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
        connectSrc: ["'self'", 'https://lumberjack.razorpay.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  }));
  if (config.isProd) {
    app.use((req, res, next) => (req.secure ? next() : res.redirect(301, `https://${req.headers.host}${req.originalUrl}`)));
  }

  // Payment webhook needs the RAW body for signature verification: mount before express.json().
  app.post('/api/payments/webhook', webhook, webhookHandler);

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', globalLimiter, csrfGuard, loadUser);

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', auth);
  app.use('/api/public', pub);
  app.use('/api/seller', seller);
  app.use('/api/admin', admin);
  app.use('/api/me', me);
  app.use('/api', shared);
  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  if (config.storage.driver === 'local') {
    app.use('/uploads', express.static(path.resolve(config.storage.localDir), { maxAge: '30d', immutable: true }));
  }
  const dist = path.resolve(process.cwd(), '../web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.code, message: err.message !== err.code ? err.message : undefined, details: err.details });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });
  return app;
}

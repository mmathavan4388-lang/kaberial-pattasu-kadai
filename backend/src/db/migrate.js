// Forward-only, versioned SQL migrations. Applied migrations are recorded in
// schema_migrations and never re-run, so app updates (v1.1, v1.2, ...) evolve the
// schema without ever dropping existing customer/seller/order/payment data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './index.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate({ log = console.log } = {}) {
  await db.init();
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await db.tx(async (q) => {
      await q.exec(sql);
      await q('INSERT INTO schema_migrations(version) VALUES ($1)', [f]);
    });
    log(`migrated ${f}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().then(() => db.close()).catch((e) => { console.error(e); process.exit(1); });
}

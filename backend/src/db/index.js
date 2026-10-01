import pg from 'pg';
import { config } from '../config.js';

// bigint (int8) money columns: values stay far below 2^53 (paise).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

let impl;

// PGlite ignores custom parsers for numeric (1700): coerce like the pg driver does above.
function fixNumeric(r) {
  const cols = (r.fields || []).filter((f) => f.dataTypeID === 1700).map((f) => f.name);
  if (cols.length) for (const row of r.rows) for (const c of cols) if (row[c] != null) row[c] = Number(row[c]);
  return r;
}

async function open() {
  if (impl) return impl;
  if (config.databaseUrl) {
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 10,
      ssl: config.isProd && !/localhost|127\.0\.0\.1/.test(config.databaseUrl) ? { rejectUnauthorized: false } : undefined,
    });
    impl = {
      query: (text, params) => pool.query(text, params),
      async tx(fn) {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const q = (t, p) => c.query(t, p);
          q.exec = (t) => c.query(t);
          const out = await fn(q);
          await c.query('COMMIT');
          return out;
        } catch (e) {
          await c.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    // Embedded Postgres for local development and tests only.
    const { PGlite } = await import('@electric-sql/pglite');
    const lite = new PGlite(config.pgliteDir || undefined, { parsers: { 20: Number, 1700: Number } });
    await lite.waitReady;
    impl = {
      query: (text, params) => lite.query(text, params).then(fixNumeric),
      tx: (fn) =>
        lite.transaction((t) => {
          const q = (text, params) => t.query(text, params).then(fixNumeric);
          q.exec = (text) => t.exec(text);
          return fn(q);
        }),
      exec: (sql) => lite.exec(sql),
      close: () => lite.close(),
    };
  }
  return impl;
}

export const db = {
  init: open,
  async query(text, params) {
    return (await open()).query(text, params);
  },
  async tx(fn) {
    return (await open()).tx(fn);
  },
  async exec(sql) {
    const d = await open();
    if (d.exec) return d.exec(sql);
    return d.query(sql);
  },
  async close() {
    if (impl) await impl.close();
    impl = null;
  },
};

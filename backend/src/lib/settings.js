import { db } from '../db/index.js';

export async function getSettings(q = null) {
  const run = q || ((t, p) => db.query(t, p));
  const { rows } = await run('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

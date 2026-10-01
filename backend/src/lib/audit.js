import { db } from '../db/index.js';

export async function audit(req, action, entity, entityId, meta = {}, q = null) {
  const run = q || ((t, p) => db.query(t, p));
  await run(
    `INSERT INTO audit_logs (actor_id, actor_role, action, entity, entity_id, meta, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [req?.user?.id || null, req?.user?.role || null, action, entity, entityId ? String(entityId) : null, JSON.stringify(meta), req?.ip || null],
  );
}

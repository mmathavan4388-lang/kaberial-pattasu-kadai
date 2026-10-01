import { db } from '../db/index.js';

// In-app notification. Text is rendered client-side from `type` + `data` in the
// recipient's language. A push transport (FCM / Web Push) can be hooked in `push()`.
export async function notify(userId, type, data = {}, q = null) {
  const run = q || ((t, p) => db.query(t, p));
  await run('INSERT INTO notifications (user_id, type, data) VALUES ($1,$2,$3)', [userId, type, JSON.stringify(data)]);
}

export async function notifyAdmin(type, data = {}, q = null) {
  const run = q || ((t, p) => db.query(t, p));
  await run(
    `INSERT INTO notifications (user_id, type, data)
     SELECT id, $1, $2 FROM users WHERE role = 'admin'`,
    [type, JSON.stringify(data)],
  );
}

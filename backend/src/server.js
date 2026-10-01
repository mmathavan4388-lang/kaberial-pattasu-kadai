import { config } from './config.js';
import { db } from './db/index.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';
import { runMaintenance } from './services/orders.js';

await db.init();
await migrate(); // forward-only, idempotent: safe on every deploy
const app = createApp();
const server = app.listen(config.port, () => console.log(`MAVRIX FIRE API listening on :${config.port}`));

const timer = setInterval(() => runMaintenance().catch((e) => console.error('maintenance', e)), 5 * 60_000);
const stop = async () => { clearInterval(timer); server.close(); await db.close(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

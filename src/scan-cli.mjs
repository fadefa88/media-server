import { createPool, initDb } from './db.mjs';
import { createScanState, scanLibrary } from './scanner.mjs';

const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 0;

const pool = createPool();
await initDb(pool);

const state = createScanState();
const timer = setInterval(() => {
  const pct = state.total ? Math.round((state.processed / state.total) * 1000) / 10 : 0;
  console.log(`${state.processed}/${state.total} ${pct}% ${state.current || ''}`);
}, 1000);

try {
  const result = await scanLibrary({ pool, limit, state });
  console.log(result);
} finally {
  clearInterval(timer);
  await pool.end();
}

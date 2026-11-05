// e2e-workflow-run.mjs — one-command full-workflow check. Boots the built API in SANDBOX payment mode on a dedicated
// port against your DATABASE_URL, runs the cross-surface workflow harness, then tears the API down.
//
//   DATABASE_URL=postgres://…  npm run e2e:workflow
//
// Defaults to the Luxe Nails tenant created by `npm run setup:local`. Override with E2E_SALON / E2E_OWNER_EMAIL /
// E2E_OWNER_PASSWORD. Requires the API to be built (setup:local builds it; or `npm run build:api`).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(SCRIPTS, '..');
const PORT = Number(process.env.E2E_WF_PORT) || 3010;
const DB = process.env.DATABASE_URL || 'postgresql://aps:aps@localhost:5432/aps';

const env = {
  ...process.env,
  DATABASE_URL: DB, REPO_DRIVER: 'postgres',
  AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET || 'local-dev-secret',
  PAYMENTS_SANDBOX: '1', PORT: String(PORT), NODE_ENV: 'development',
};

const api = spawn('node', ['dist/main.js'], { cwd: API_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
let apiLog = ''; api.stdout.on('data', (d) => (apiLog += d)); api.stderr.on('data', (d) => (apiLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try { const res = await fetch(`http://127.0.0.1:${PORT}/health`); if (res.ok) return true; } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}

function stop(code) { try { api.kill('SIGTERM'); } catch { /* */ } process.exit(code); }

(async () => {
  if (!(await waitHealth())) { console.error('API did not start. Last log:\n' + apiLog.split('\n').slice(-15).join('\n') + '\n(Did you build it? `npm run build:api`)'); return stop(2); }
  const harness = spawn('node', ['scripts/e2e-full-workflow.mjs'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      E2E_BASE: `http://127.0.0.1:${PORT}`,
      E2E_SALON: process.env.E2E_SALON || 'LUXE',
      E2E_OWNER_EMAIL: process.env.E2E_OWNER_EMAIL || 'owner@luxenails.test',
      E2E_OWNER_PASSWORD: process.env.E2E_OWNER_PASSWORD || 'Owner123!',
    },
    stdio: 'inherit',
  });
  harness.on('exit', (code) => stop(code ?? 1));
})();

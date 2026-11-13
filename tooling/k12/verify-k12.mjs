#!/usr/bin/env node
// verify-k12.mjs — checks the K-12 security steps that can be checked from a machine (docs/K12_RUNBOOK.md).
// It never prints a secret: connection strings are read from the environment and only PASS / FAIL is shown.
//
//   DB_PUBLIC_HOST=<the database's public hostname or IP>   step 6: port 5432 must NOT answer from the internet
//   OLD_DATABASE_URL=<the old, exposed connection string>   step 5: must be REFUSED now
//   DATABASE_URL=<the new connection string>                step 7: must connect (run from inside the private network)
//   node tooling/k12/verify-k12.mjs
//
// Each check that has no input is reported SKIPPED (not PASS). Exit code 1 if any check FAILS.
/* global process, console */
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const results = [];
const add = (step, name, status, note = '') => results.push({ step, name, status, note });

function tcpOpen(host, port, ms = 5000) {
  return new Promise((ok) => {
    const s = net.connect({ host, port });
    const done = (v) => { s.destroy(); ok(v); };
    s.setTimeout(ms, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}
async function pgConnects(url) {
  let pg;
  try { ({ default: pg } = await import('pg')); } catch { return { ok: null, why: 'the pg package is not installed here' }; }
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try { await c.connect(); await c.query('select 1'); return { ok: true }; }
  catch (e) { return { ok: false, why: String(e?.code || e?.message || e).replace(/postgres(ql)?:\/\/\S+/g, '<url>') }; }
  finally { await c.end().catch(() => undefined); }
}

// step 5 — the old password is dead
if (process.env.OLD_DATABASE_URL) {
  const r = await pgConnects(process.env.OLD_DATABASE_URL);
  add(5, 'old database login refused', r.ok === false ? 'PASS' : r.ok === true ? 'FAIL' : 'SKIPPED', r.ok === true ? 'the OLD connection string still works — rotate the password' : r.why || '');
} else add(5, 'old database login refused', 'SKIPPED', 'set OLD_DATABASE_URL');

// step 6 — 5432 closed to the internet
if (process.env.DB_PUBLIC_HOST) {
  const open = await tcpOpen(process.env.DB_PUBLIC_HOST, 5432);
  add(6, 'port 5432 closed from outside', open ? 'FAIL' : 'PASS', open ? `${process.env.DB_PUBLIC_HOST}:5432 accepts connections — turn off the public TCP proxy` : '');
} else add(6, 'port 5432 closed from outside', 'SKIPPED', 'set DB_PUBLIC_HOST (run this from OUTSIDE the private network)');

// step 7 — the new environment works
if (process.env.DATABASE_URL) {
  const r = await pgConnects(process.env.DATABASE_URL);
  add(7, 'new database login works', r.ok === true ? 'PASS' : r.ok === false ? 'FAIL' : 'SKIPPED', r.why || '');
} else add(7, 'new database login works', 'SKIPPED', 'set DATABASE_URL (run this from INSIDE the private network)');

// step 7 — no secret readable through code that feeds screens
try { execFileSync('node', [resolve(ROOT, 'apps/api/scripts/secrets-exposure-check.mjs')], { stdio: 'pipe' }); add(7, 'secrets-exposure-check', 'PASS'); }
catch (e) { add(7, 'secrets-exposure-check', 'FAIL', String(e.stdout || e.message).split('\n').slice(-3).join(' ')); }

// step 8 — history scan before the push
try {
  execFileSync('gitleaks', ['version'], { stdio: 'pipe' });
  try { execFileSync('gitleaks', ['detect', '--source', ROOT, '--redact', '--no-banner'], { stdio: 'pipe' }); add(8, 'gitleaks full history clean', 'PASS'); }
  catch { add(8, 'gitleaks full history clean', 'FAIL', 'gitleaks found leaks (redacted) — do not push; see its report'); }
} catch { add(8, 'gitleaks full history clean', 'SKIPPED', 'install gitleaks (brew install gitleaks)'); }

// step 8 — CI enforces it after the push
const wf = resolve(ROOT, '.github/workflows/security.yml');
if (existsSync(wf)) {
  const soft = /continue-on-error:\s*true/.test(readFileSync(wf, 'utf8'));
  add(8, 'CI gitleaks job is blocking', soft ? 'PENDING' : 'PASS', soft ? 'after the push, remove continue-on-error from .github/workflows/security.yml' : '');
}

for (const r of results) console.log(`${r.status.padEnd(8)} step ${r.step}  ${r.name}${r.note ? ' — ' + r.note : ''}`);
process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);

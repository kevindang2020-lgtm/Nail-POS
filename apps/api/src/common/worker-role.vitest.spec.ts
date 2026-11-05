// worker-role.vitest.spec.ts — BUILD_PLAN Phase 14 (Constitution 12): the least-privilege role files stay true to the code.
//   • 03_worker_grants.generated.sql is exactly what the script derives today (else: run --write and re-provision);
//   • every consumer of the DATABASE_WORKER handle is one the script knows (a new one must list its tables there);
//   • every table the central retention executor owns can be purged by the worker; nothing the worker never touches is in;
//   • the SQL never carries a password, and --dry-run with no database prints SQL and changes nothing.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const API = join(__dirname, '..', '..');
const ROOT = join(API, '..', '..');
const load = () => import(pathToFileURL(join(API, 'scripts', 'db-provision-roles.mjs')).href) as Promise<any>;

function* walk(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.ts$/.test(n) && !/\.(spec|test)\.ts$/.test(n)) yield p;
  }
}

describe('least-privilege role files', () => {
  it('the generated worker grants are current', () => {
    expect(() => execFileSync(process.execPath, ['scripts/db-provision-roles.mjs', '--check'], { cwd: API, stdio: 'pipe' })).not.toThrow();
  });

  it('every consumer of the DATABASE_WORKER handle is one the provisioning script lists', async () => {
    const { WORKER_USES } = await load();
    const known = new Set<string>(WORKER_USES.map((u: any) => u.source.split(' ')[0]));
    const consumers: string[] = [];
    for (const base of ['apps/api/src', 'modules', 'packages']) {
      for (const f of walk(join(ROOT, base))) {
        const text = readFileSync(f, 'utf8');
        if (!/@Inject\(DATABASE_WORKER\)|token:\s*DATABASE_WORKER/.test(text)) continue;
        consumers.push(relative(ROOT, f));
      }
    }
    // the provider module itself injects it only to close the pool on shutdown
    const real = consumers.filter((c) => c !== 'packages/database/src/database.module.ts' && !c.endsWith('/security.module.ts'));
    expect(real.sort()).toEqual(['apps/api/src/jobs/job-worker.ts', 'apps/api/src/observability/telemetry-store.ts']);
    for (const c of real) expect(known.has(c), `${c} uses DATABASE_WORKER — add its tables to WORKER_USES`).toBe(true);
    // the retention executor is bound to the worker in security.module.ts
    expect(readFileSync(join(ROOT, 'modules/super-admin/src/super-admin-security/security.module.ts'), 'utf8')).toMatch(/new RetentionExecutorService\(\(worker \?\? db\)/);
    expect(known.has('modules/super-admin/src/super-admin-security/retention-executor.service.ts')).toBe(true);
  });

  it('the worker can purge every central retention table and is given nothing that holds customer or money data', async () => {
    const { deriveWorkerGrants } = await load();
    const grants = deriveWorkerGrants();
    const by = new Map<string, string[]>(grants.map((g: any) => [g.table, g.privs]));
    const policy = JSON.parse(readFileSync(join(API, 'db', 'retention-policy.json'), 'utf8'));
    for (const [t, p] of Object.entries<any>(policy.tables)) {
      if (p.executor !== 'central') continue;
      expect(by.get(t), t).toEqual(expect.arrayContaining(['SELECT', 'DELETE']));
    }
    for (const t of ['customers', 'users', 'payments', 'tickets', 'gift_cards', 'tenants', 'audit_logs', 'payment_refunds', 'loyalty_ledger']) expect(by.has(t), t).toBe(false);
    for (const g of grants) for (const p of g.privs) expect(p).toMatch(/^(SELECT|INSERT|UPDATE|DELETE)( \([a-z_, ]+\))?$/);   // never TRUNCATE / ALL / REFERENCES
  });

  it('--dry-run without a database prints the SQL, with no password, and needs no connection', () => {
    const out = execFileSync(process.execPath, ['scripts/db-provision-roles.mjs', '--dry-run'], { cwd: API, env: { PATH: process.env.PATH, APS_API_PASSWORD: 'never-printed-1', APS_WORKER_PASSWORD: 'never-printed-2' }, encoding: 'utf8' });
    expect(out).toContain('CREATE ROLE "aps_api" LOGIN');
    expect(out).toContain("('jobs', 'SELECT, UPDATE, DELETE'");   // the worker block, rendered
    expect(out).not.toMatch(/never-printed/);
    expect(out).not.toMatch(/\{\{[A-Z_]+\}\}/);
    for (const f of readdirSync(join(API, 'db', 'roles'))) expect(readFileSync(join(API, 'db', 'roles', f), 'utf8')).not.toMatch(/PASSWORD\s+'/i);
  });

  it('role names are validated (no injection through --api-role)', () => {
    expect(() => execFileSync(process.execPath, ['scripts/db-provision-roles.mjs', '--dry-run', '--api-role', 'x"; drop'], { cwd: API, stdio: 'pipe', env: { PATH: process.env.PATH } })).toThrow();
  });
});

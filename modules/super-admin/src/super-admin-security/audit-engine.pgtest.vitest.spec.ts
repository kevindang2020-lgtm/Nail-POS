// audit-engine.pgtest.vitest.spec.ts — the Security Audit Engine against the REAL migrated schema (Jul 26, 2026).
// Proves in Postgres what the unit spec proves in memory: run rows persist honestly, findings DEDUPE on the
// fingerprint UNIQUE key across runs, new critical/high findings land in the real security_incidents table exactly
// once (correlation_id = fingerprint), fixes auto-RESOLVE, and a real DB probe (Super Admin MFA) detects and then
// clears. (The advisory-lock skip is covered in the unit spec: PGlite is one session and pg advisory locks are
// re-entrant within a session, so a same-session "concurrent" test would be meaningless.)
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyAuditEngineRepository } from './audit-engine.kysely.repository';
import { AuditEngineService } from './audit-engine.service';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const SA_USER = 'ae000000-0000-0000-0000-0000000000a1';
const T = 'ae000000-0000-0000-0000-000000000001';
const badEnv = { NODE_ENV: 'production', AUTH_SESSION_SECRET: 'local-dev-secret', MFA_ENC_KEY: '0123456789abcdef0123456789abcdef', PAYMENTS_SANDBOX: '1' };
const goodEnv = { NODE_ENV: 'production', AUTH_SESSION_SECRET: 'x'.repeat(48), MFA_ENC_KEY: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', PAYMENTS_SANDBOX: '0', APP_DATA_ENCRYPTION_KEY: 'k'.repeat(32), WEB_CORS_ORIGINS: 'https://pos.aipowersalon.com' };

let pg: PGlite;
let db: Kysely<any>;
let svc: AuditEngineService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'AE','AE','aeA','AEA')`, [T]);
  await q(`insert into users (id, tenant_id, email, password_hash, role, full_name) values ($1,$2,'sa@ae.test','x','SUPER_ADMIN','Audit SA')`, [SA_USER, T]);
  const repo = new KyselyAuditEngineRepository(db as any);
  // Incidents here are inserted with raw SQL so the finding→incident FK + correlation are proven on the REAL
  // security_incidents table. (The full IncidentService transaction path has its own suite; under this PGlite
  // test driver its Kysely transaction interacts badly with the migration-loaded session — a HARNESS limitation,
  // not a production path: NOT VERIFIED on PGlite, verified at unit level + by the incident module's own tests.)
  const incidents = {
    async create(input: any) {
      const r: any = await q(`insert into security_incidents (incident_ref, title, description, category, severity, status, detection_source, correlation_id)
        values ($1,$2,$3,$4,$5,'detected',$6,$7) returning id`,
        [`INC-T-${Math.random().toString(36).slice(2, 8)}`, input.title, input.description, input.category, input.severity, input.detectionSource, input.correlationId]);
      return { id: String(r[0].id) };
    },
  };
  svc = new AuditEngineService(repo, incidents as any, db as any, badEnv);
});

describe('security audit engine (real schema)', () => {
  it('run 1: bad env + SA without MFA → 6 open findings; the 5 critical/high each escalate ONCE into security_incidents', async () => {
    const r1 = await svc.runAudit('manual', null);
    expect(r1.ran).toBe(true);
    expect(r1.open).toBe(6);
    const findings = await q(`select fingerprint, severity, status, occurrences, incident_id from security_audit_findings order by fingerprint`);
    expect(findings.length).toBe(6);
    expect(findings.every((f: any) => f.status === 'open' && Number(f.occurrences) === 1)).toBe(true);
    const incidents = await q(`select correlation_id, severity, detection_source from security_incidents`);
    expect(incidents.length).toBe(5);                            // all 5 are critical/high in this scenario
    expect(incidents.every((i: any) => i.detection_source === 'automated_security_audit')).toBe(true);
    const linked = findings.filter((f: any) => f.incident_id != null);
    expect(linked.length).toBe(5);                               // the CORS-unset MEDIUM stays findings-only, no incident
  });

  it('run 2 (same env): dedupe — same 6 fingerprints, occurrences bump to 2, NO new incidents', async () => {
    const r2 = await svc.runAudit('manual', null);
    expect(r2.open).toBe(6);
    const findings = await q(`select occurrences from security_audit_findings`);
    expect(findings.every((f: any) => Number(f.occurrences) === 2)).toBe(true);
    expect((await q(`select count(*)::int c from security_incidents`))[0].c).toBe(5);
    expect((await q(`select count(*)::int c from security_audit_runs where status='completed'`))[0].c).toBe(2);
  });

  it('run 3 (env fixed incl. CORS, MFA enrolled): every finding auto-RESOLVES (re-verify) and stays resolved in the DB', async () => {
    (svc as any).env = goodEnv;
    await q(`insert into mfa_factors (user_id, type, secret_enc, confirmed) values ($1,'totp','enc','t')`, [SA_USER]);
    const r3 = await svc.runAudit('manual', null);
    expect(r3.open).toBe(0);
    expect(r3.resolved).toBe(6);
    const rows = await q(`select status, resolved_at, resolved_run from security_audit_findings`);
    expect(rows.every((f: any) => f.status === 'resolved' && f.resolved_at != null && f.resolved_run != null)).toBe(true);
  });
});

// report-export.pgtest — F3 (Finish the Five, 30 Oct 2026): both CSV exports are produced and audited on the server
// against the REAL schema. Success → requested + succeeded with row / byte counts and digest, the same columns as the
// screens; a failing generation → requested + failed with a safe code and no success; no export permission → denied, no
// CSV; the audit store failing → 503 and no CSV (no unlogged success); only this salon's rows; nothing personal is logged.
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CommissionScreenRepository } from './commission-screen.repository';
import { TeamPerformanceScreenRepository } from './team-performance-screen.repository';
import { auditedExport } from './report-export';

const P = 'fa7f0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9'), U = id('e1'), CU = id('e2');
const MIA = id('c1'), OTHER = id('c9');
const mgr = { tenantId: T, branchId: B, userId: U, role: 'MANAGER', permissions: ['pos.reports.view', 'payroll.view', 'reports.export', 'pos.technicians.view'] };
const noExport = { ...mgr, permissions: ['pos.reports.view', 'payroll.view', 'pos.technicians.view'] };
let pg: any; let db: any; let comm: CommissionScreenRepository; let perf: TeamPerformanceScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const audits = async (req: string) => (await q(`select action, status, metadata, request_id, tenant_id, branch_id from audit_events where request_id = $1 order by occurred_at, action`, [req])).rows;

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','rx-a','RXA001','active'), ($2,'Other LLC','Other','rx-b','RXB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, BX, T2]);
  await q(`insert into users (id, tenant_id, branch_id, full_name, email, role, status) values ($1,$2,$3,'Kim Manager','kim@example.test','MANAGER','active')`, [U, T, B]);
  for (const [tid, nm, tenant, br, ph] of [[MIA, 'Mia Tran', T, B, '+18565557001'], [OTHER, 'Other Tech', T2, BX, '+18565557009']])
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, role_label, normalized_phone) values ($1,$2,$3,$4,'x',$4,'active',true,'Technician',$5)`, [tid, tenant, br, nm, ph]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,'Mai','Le','Mai Le','+18565551234'), ($4,$5,$6,'Bo','Ng','Bo Ng','+18565550000')`, [CU, T, B, id('e3'), T2, BX]);
  let n = 0;
  for (const [tenant, br, tech, cust, gross, earned] of [[T, B, MIA, CU, 10000, 4000], [T, B, MIA, CU, 5000, 2000], [T2, BX, OTHER, id('e3'), 99900, 9900]] as const) {
    n++; const tk = id('f' + n);
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, paid_at) values ($1,$2,$3,$4,'paid',$5, now() - interval '1 hour')`, [tk, tenant, br, cust, `T-${n}`]);
    await q(`insert into ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, technician_id, engine_version, gross_price_cents, commissionable_cents, commission_type, commission_value, tech_service_earnings_cents, card_tip_cents, snapshot_at)
      values ($1,$2,$3,$4,$5,'1.0.0',$6,$6,'percent',40,$7,500, now() - interval '1 hour')`, [tenant, br, tk, id('9' + n), tech, gross, earned]);
  }
  db = kyselyFor(pg); comm = new CommissionScreenRepository(db as never); perf = new TeamPerformanceScreenRepository(db as never);
}, 180_000);

describe('server-side audited CSV exports', () => {
  it('Commission: requested + succeeded, the same columns and file name, only this salon, no personal data logged', async () => {
    const out = await comm.exportCsv(mgr, { preset: 'month', q: '+1 856-555-1234', lang: 'en' }, 'req-comm-1');
    const [head, ...rows] = out.csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(head).toBe('Technician,Services,Service Revenue,Discount,Commissionable base,Commission,Adjustments,Rate,Tips,Payout,Paid');
    expect(rows).toEqual(['Mia Tran,2,150.00,0.00,150.00,60.00,0.00,40%,10.00,70.00,0.00']);
    expect(out.filename).toMatch(/^commission-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(out.csv).not.toContain('Other Tech');
    const a = await audits('req-comm-1');
    expect(a.map((x: any) => x.action)).toEqual(['report.export.requested', 'report.export.succeeded']);
    expect(a.every((x: any) => x.tenant_id === T && x.branch_id === B)).toBe(true);
    const ok = a[1].metadata;
    expect(ok).toMatchObject({ reportType: 'COMMISSION', rowCount: 1, byteCount: Buffer.byteLength(out.csv, 'utf8'), sha256: createHash('sha256').update(out.csv, 'utf8').digest('hex') });
    expect(ok.filters.search).toEqual({ present: true, length: 15 });
    const all = JSON.stringify(a);
    expect(all).not.toContain('856'); expect(all).not.toContain('Mia Tran'); expect(all).not.toContain('150.00');
  });
  it('Team Performance: Vietnamese headers when the screen is in Vietnamese; audited the same way', async () => {
    const out = await perf.exportCsv(mgr, { preset: 'month', lang: 'vi' }, 'req-tp-1');
    expect(out.csv.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe('Thợ,Chi nhánh,Dịch vụ đã hoàn tất,Đánh giá xác thực,Đánh giá,Mức,Dịch vụ gần nhất');
    expect(out.filename).toMatch(/^team-performance-/);
    expect((await audits('req-tp-1')).map((x: any) => x.action)).toEqual(['report.export.requested', 'report.export.succeeded']);
  });
  it('a failing generation records requested + failed (safe code) and never a success', async () => {
    const boom = Object.assign(new Error('relation "secret" does not exist — customer 856-555-1234'), { code: '42P01' });
    await expect(auditedExport(db, mgr, 'TEAM_PERFORMANCE', { preset: 'month' }, 'req-fail-1', async () => { throw boom; })).rejects.toBe(boom);
    const a = await audits('req-fail-1');
    expect(a.map((x: any) => x.action).sort()).toEqual(['report.export.failed', 'report.export.requested']);
    const f = a.find((x: any) => x.action === 'report.export.failed');
    expect(f.status).toBe('failure'); expect(f.metadata.failureCode).toBe('42P01'); expect(JSON.stringify(f)).not.toContain('856');
  });
  it('without the export permission: denied, recorded, no CSV produced', async () => {
    await expect(comm.exportCsv(noExport, { preset: 'month' }, 'req-deny-1')).rejects.toMatchObject({ status: 403 });
    const a = await audits('req-deny-1');
    expect(a).toHaveLength(1); expect(a[0]).toMatchObject({ action: 'report.export.denied', status: 'denied' }); expect(a[0].metadata.permissionMissing).toBe('reports.export');
  });
  it('audit storage outage: fails closed (503), no CSV, no unlogged success', async () => {
    await q(`create or replace function test_audit_outage() returns trigger language plpgsql as $$ begin if new.module = 'reports' then raise exception 'audit store unavailable'; end if; return new; end $$`);
    await q(`create trigger trg_test_audit_outage before insert on audit_events for each row execute function test_audit_outage()`);
    try {
      let csv: string | null = null;
      await expect(comm.exportCsv(mgr, { preset: 'month' }, 'req-outage-1').then((o) => { csv = o.csv; })).rejects.toMatchObject({ status: 503 });
      expect(csv).toBeNull();
      expect(await audits('req-outage-1')).toHaveLength(0);
    } finally { await q(`drop trigger trg_test_audit_outage on audit_events`); }
  });
  it('history: a manager sees the salon’s export attempts newest first; a person without audit access only their own', async () => {
    const h = await comm.exportHistory(mgr, {});
    expect(h.scope).toBe('salon'); expect(h.items[0].event).toBe('denied');
    expect(h.items.map((x: any) => x.at)).toEqual([...h.items.map((x: any) => x.at)].sort().reverse());
    const own = await comm.exportHistory({ ...noExport, userId: id('e8') }, {});
    expect(own.scope).toBe('own'); expect(own.totalItems).toBe(0);
    expect((await comm.exportHistory({ tenantId: T2, branchId: BX, userId: id('e7'), role: 'MANAGER', permissions: ['audit.view'] }, {})).totalItems).toBe(0);
  });
});

describe('round 10 — Finish the Five 07: audit coverage (last verified export, last request whose outcome was never recorded)', () => {
  it('names the last recorded success with its digest and a requested export with no recorded outcome after 5 minutes; another salon never', async () => {
    let h: any = await comm.exportHistory(mgr, {});
    expect(h.coverage.lastVerifiedExport).toMatchObject({ reportType: expect.any(String), sha256: expect.stringMatching(/^[0-9a-f]{64}$/), rowCount: expect.any(Number) });
    expect(h.coverage.lastMissingOutcome).toBeNull();               // every request so far has its outcome (or was denied up front)
    // a request that stopped: 'requested' recorded 10 minutes ago, no succeeded / failed row for its request id
    await q(`insert into audit_events (tenant_id, branch_id, actor_user_id, module, action, resource_type, resource_id, request_id, status, severity, summary, metadata, occurred_at)
      values ($1,$2,$3,'reports','report.export.requested','report_export','COMMISSION','req-lost-1','success','info','COMMISSION export requested','{}'::jsonb, now() - interval '10 minutes')`, [T, B, U]);
    // and one still running (2 minutes old) — not counted yet
    await q(`insert into audit_events (tenant_id, branch_id, actor_user_id, module, action, resource_type, resource_id, request_id, status, severity, summary, metadata, occurred_at)
      values ($1,$2,$3,'reports','report.export.requested','report_export','COMMISSION','req-running-1','success','info','COMMISSION export requested','{}'::jsonb, now() - interval '2 minutes')`, [T, B, U]);
    h = await comm.exportHistory(mgr, {});
    expect(h.coverage.lastMissingOutcome).toMatchObject({ reportType: 'COMMISSION', requestId: 'req-lost-1' });
    expect(h.coverage.missingOutcomes).toBe(1);
    expect((await comm.exportHistory({ tenantId: T2, branchId: BX, userId: id('e7'), role: 'MANAGER', permissions: ['audit.view'] }, {})).coverage).toEqual({ lastVerifiedExport: null, lastMissingOutcome: null, missingOutcomes: 0 });
  });
});

// payroll-lock.pgtest — merge Oct 12 2026 (migration 589) on the REAL schema (PGlite, all migrations): the DATABASE
// refuses UPDATE/DELETE of payroll lines in a PAID period (not just the service), and reopening a FINALIZED period
// requires a reason that is stored on the row and audited at high severity. A paid period never reopens (the state
// machine refuses, 409) — Payroll mandate §73–§74, §124.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyPayrollRepository } from './payroll.kysely.repository';
import { PayrollService } from './payroll.service';

const P = 'c0ad0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const TA = id('a1'), BA = id('b1'), TECH = id('c1'), OWNER = id('ee1');
let pg: any; let db: any;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const ctx = () => ({ tenantId: TA, branchId: BA, userId: OWNER, role: 'OWNER', permissions: ['pos.payroll.manage', 'pos.payroll.view'] } as any);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lock LLC','Lock','pay-lock','PAYL01','active')`, [TA]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [BA, TA]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,'Mia','Chen','Mia Chen','active',true)`, [TECH, TA, BA]);
}, 180_000);

describe('payroll paid-period lock (DB trigger) + reopen reason', () => {
  it('the trigger refuses UPDATE and DELETE of lines in a PAID period, but allows them while draft', async () => {
    const period = id('e1'); const line = id('f1');
    await q(`insert into payroll_periods (id, tenant_id, branch_id, period_start, period_end, status) values ($1,$2,$3,'2026-09-28','2026-10-11','draft')`, [period, TA, BA]);
    await q(`insert into payroll_lines (id, tenant_id, period_id, technician_id, commission_cents, payable_cents) values ($1,$2,$3,$4,1000,1000)`, [line, TA, period, TECH]);
    await q(`update payroll_lines set payable_cents = 1200 where id = $1`, [line]);   // draft: fine
    await q(`update payroll_periods set status = 'paid', paid_at = now() where id = $1`, [period]);
    await expect(q(`update payroll_lines set payable_cents = 1 where id = $1`, [line])).rejects.toThrow(/paid; its lines are locked \(UPDATE refused\)/);
    await expect(q(`delete from payroll_lines where id = $1`, [line])).rejects.toThrow(/DELETE refused/);
    expect(Number((await q(`select payable_cents from payroll_lines where id = $1`, [line]))[0].payable_cents)).toBe(1200);   // untouched
  });

  it('reopening a FINALIZED period requires a reason; with one it is stored on the row + audited (high)', async () => {
    const audits: any[] = [];
    const svc = new PayrollService(new KyselyPayrollRepository(db), { record: async (_c: any, i: any) => { audits.push(i); return null; } } as any);
    const p = await svc.createPeriod(ctx(), { periodStart: '2026-10-12', periodEnd: '2026-10-25' });
    await svc.finalize(ctx(), p.id);
    await expect(svc.reopen(ctx(), p.id)).rejects.toThrow(/requires a reason/);
    await expect(svc.reopen(ctx(), p.id, '  ')).rejects.toThrow(/requires a reason/);
    expect((await svc.getPeriod(ctx(), p.id)).period.status).toBe('finalized');   // refused → unchanged
    const reopened = await svc.reopen(ctx(), p.id, 'Missed a tip correction for Mia');
    expect(reopened.status).toBe('draft');
    expect(reopened.reopenReason).toBe('Missed a tip correction for Mia');
    expect(reopened.reopenedBy).toBe(OWNER);
    expect(reopened.reopenedAt).toBeTruthy();
    const a = audits.find((x) => x.action === 'period.reopened');
    expect(a).toMatchObject({ module: 'payroll', severity: 'high', resourceId: p.id });
    expect(a.metadata).toMatchObject({ reason: 'Missed a tip correction for Mia', previousStatus: 'finalized' });
  });

  it('a PAID period cannot be reopened at all (state machine + DB lock agree)', async () => {
    const svc = new PayrollService(new KyselyPayrollRepository(db));
    const p = await svc.createPeriod(ctx(), { periodStart: '2026-10-26', periodEnd: '2026-11-08' });
    await svc.finalize(ctx(), p.id); await svc.markPaid(ctx(), p.id);
    await expect(svc.reopen(ctx(), p.id, 'please')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    expect((await svc.getPeriod(ctx(), p.id)).period.status).toBe('paid');
  });
});

// §208 (Oct 21 2026): the `new_payroll_engine` rollout flag is a safety valve on the one irreversible step — approve
// (lock). A salon the flag is withheld from / killed for is refused with the flag's name; preview and validation still
// work; a salon the flag lets through locks as before. No flag service bound (unit harnesses) = on.
import { PayrollWorkflowService } from './payroll-workflow.service';
describe('new_payroll_engine rollout flag', () => {
  const wctx = () => ({ ...ctx(), permissions: ['pos.payroll.manage', 'pos.payroll.view', 'payroll.approve'] });
  const flags = (allowed: boolean, reason = 'NOT_IN_ROLLOUT') => ({ decide: async () => (allowed ? { allowed: true } : { allowed: false, reason, detail: 'Outside the 0% rollout' }) });
  it('withheld → approve refuses PAYROLL_ENGINE_NOT_ROLLED_OUT (409), the period stays draft; rolled out → approve proceeds', async () => {
    const repo = new KyselyPayrollRepository(db);
    const base = new PayrollService(repo, { record: async () => null } as any);
    const p = await base.createPeriod(ctx(), { periodStart: '2026-11-09', periodEnd: '2026-11-22' });
    const held = new PayrollWorkflowService(db as any, { featureFlags: flags(false) });
    await expect(held.approve(wctx(), p.id)).rejects.toMatchObject({ code: 'PAYROLL_ENGINE_NOT_ROLLED_OUT' });
    expect((await base.getPeriod(ctx(), p.id)).period.status).toBe('draft');
    const open = new PayrollWorkflowService(db as any, { featureFlags: flags(true) });
    await expect(open.approve(wctx(), p.id)).resolves.toBeTruthy();
  });
  it('a plan-layer denial (NOT_IN_PLAN) is not this valve\'s business — only the platform layer holds the lock', async () => {
    const base = new PayrollService(new KyselyPayrollRepository(db), { record: async () => null } as any);
    const p = await base.createPeriod(ctx(), { periodStart: '2026-11-23', periodEnd: '2026-12-06' });
    const wf = new PayrollWorkflowService(db as any, { featureFlags: flags(false, 'NOT_IN_PLAN') });
    await expect(wf.approve(wctx(), p.id)).resolves.toBeTruthy();
  });
});

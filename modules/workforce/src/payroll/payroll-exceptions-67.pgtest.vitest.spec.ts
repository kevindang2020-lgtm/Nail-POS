// payroll-exceptions-67.pgtest — 200-technician mandate §67 (Oct 26 2026) on the REAL schema (PGlite, every migration):
// the week's validation now names the technicians behind two more exceptions, so the owner's "Show exceptions only"
// finds them on their statements:
//   UNALLOCATED_TIP          — a paid ticket's tip is not fully allocated; the technicians who served it are named
//   MISSING_COMMISSION_RULE  — a technician's service was priced by the fallback source (no technician / policy rule,
//                              no service rate matched — 'Tenant default rate')
// A clean technician gets neither. The stored validation drives reviewWeek (exceptionsOnly) without re-validating.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { permissionsFor } from '@aipowersalon/permissions';
import { PayrollWorkflowService } from './payroll-workflow.service';
import { PayrollPaycheckService } from './payroll-paycheck.service';
import { RULE_SOURCE_TENANT_DEFAULT } from '../compensation/compensation-rule-loader';

const U = (n: number) => `e67a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = U(1), B = U(2), C = U(3), OWNER = U(4), MGR = U(5);
const TIPPY = U(10), NORULE = U(11), CLEAN = U(12), HELPER = U(13);
const TK_TIP = U(20), TK_RULE = U(21), TK_CLEAN = U(22);
const PERIOD = U(30);
const PAID_AT = '2026-10-14T16:00:00Z';   // inside the week Oct 12–18 (New York)
let pg: any; let wf: PayrollWorkflowService; let svc: PayrollPaycheckService;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const manager = () => ({ tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] }) as any;
const owner = () => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] }) as any;

beforeAll(async () => {
  pg = await migratedPglite(); const db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, owner_user_id) values ($1,'Ex67 LLC','Ex67','ex-67','EX6701','active',$2)`, [T, OWNER]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ex','Guest','Ex Guest')`, [C, T, B]);
  for (const [id, name] of [[TIPPY, 'Tia Tip'], [NORULE, 'Nora Rule'], [CLEAN, 'Cleo Clean'], [HELPER, 'Hal Helper']] as const) {
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,$4,$5,$6,'active',true)`, [id, T, B, name.split(' ')[0], name.split(' ')[1], name]);
  }
  await q(`insert into payroll_periods (id, tenant_id, branch_id, label, period_start, period_end, status) values ($1,$2,null,'Week of Oct 12','2026-10-12','2026-10-18','draft')`, [PERIOD, T]);
  // three paid tickets: a $10 tip of which only $6 was allocated (Tia + Hal served it); a fallback-priced service (Nora);
  // a clean ticket (Cleo: rule-priced, tip fully allocated)
  for (const [id, tip] of [[TK_TIP, 1000], [TK_RULE, 0], [TK_CLEAN, 500]] as const) {
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at, tip_cents) values ($1,$2,$3,$4,'paid',$5,$6)`, [id, T, B, C, PAID_AT, tip]);
  }
  const line = async (ticket: string, tech: string) => (await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, technician_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status, created_at)
    values ($1,$2,$3,$4,'00000000-0000-0000-0000-000000000000','Gel Manicure',4500,45,4500,'completed',$5) returning id`, [T, B, ticket, tech, PAID_AT]))[0].id as string;
  const lTip = await line(TK_TIP, TIPPY); await line(TK_TIP, HELPER); const lRule = await line(TK_RULE, NORULE); const lClean = await line(TK_CLEAN, CLEAN);
  await q(`insert into ticket_tip_allocations (tenant_id, branch_id, ticket_id, technician_id, tip_cents) values ($1,$2,$3,$4,600)`, [T, B, TK_TIP, TIPPY]);
  await q(`insert into ticket_tip_allocations (tenant_id, branch_id, ticket_id, technician_id, tip_cents) values ($1,$2,$3,$4,500)`, [T, B, TK_CLEAN, CLEAN]);
  const snap = (ticket: string, lineId: string, tech: string, ruleSource: string) => q(`insert into ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, technician_id, gross_price_cents, tech_service_earnings_cents, card_tip_cents, cash_tip_cents, retail_commission_cents, snapshot_at, engine_version, rule_source, commissionable_cents)
    values ($1,$2,$3,$4,$5,4500,2250,0,0,0,$6,'v-test',$7,4500)`, [T, B, ticket, lineId, tech, PAID_AT, ruleSource]);
  await snap(TK_TIP, lTip, TIPPY, 'Technician + Service'); await snap(TK_RULE, lRule, NORULE, RULE_SOURCE_TENANT_DEFAULT); await snap(TK_CLEAN, lClean, CLEAN, 'Service default');
  for (const tech of [TIPPY, NORULE, CLEAN]) await q(`insert into payroll_lines (tenant_id, period_id, technician_id, commission_cents, tips_cents, net_cents, payable_cents) values ($1,$2,$3,2250,0,2250,2250)`, [T, PERIOD, tech]);
  const outbox = { write: async () => undefined } as any;
  wf = new PayrollWorkflowService(db, { outbox });
  svc = new PayrollPaycheckService(db, { workflow: wf, outbox, pins: { verifyPin: async () => ({ ok: false }) } });
  wf.paychecks = svc;
});

describe('§67 exception codes on the real schema', () => {
  it('validation names the technicians: UNALLOCATED_TIP (who served the ticket) and MISSING_COMMISSION_RULE (fallback-priced)', async () => {
    const v = await wf.validate(manager(), PERIOD);
    const tip = v.issues.find((i) => i.code === 'UNALLOCATED_TIP')!;
    expect(tip).toBeTruthy();
    expect(tip.ticketIds).toEqual([TK_TIP]);
    expect([...(tip.technicianIds ?? [])].sort()).toEqual([TIPPY, HELPER].sort());
    const rule = v.issues.find((i) => i.code === 'MISSING_COMMISSION_RULE')!;
    expect(rule).toMatchObject({ severity: 'warning', count: 1, technicianIds: [NORULE] });
  });

  it('the owner\'s week review shows them on the statements and "exceptions only" finds exactly those', async () => {
    await svc.calculate(manager(), PERIOD);          // builds the statements from the lines
    await wf.validate(manager(), PERIOD);            // the stored validation reviewWeek reads
    const all: any = await svc.reviewWeek(owner(), PERIOD, {});
    const codesOf = (tech: string) => (all.statements.find((s: any) => s.technicianId === tech)?.exceptions ?? []).map((e: any) => e.code);
    expect(codesOf(TIPPY)).toContain('UNALLOCATED_TIP');
    expect(codesOf(NORULE)).toContain('MISSING_COMMISSION_RULE');
    expect(codesOf(CLEAN)).not.toContain('UNALLOCATED_TIP');
    expect(codesOf(CLEAN)).not.toContain('MISSING_COMMISSION_RULE');
    const ex: any = await svc.reviewWeek(owner(), PERIOD, { exceptionsOnly: true });
    const ids = ex.statements.map((s: any) => s.technicianId);
    expect(ids).toContain(TIPPY); expect(ids).toContain(NORULE); expect(ids).not.toContain(CLEAN);
    // named on statements → no longer a period-level line
    expect(ex.view.periodIssues.map((i: any) => i.code)).not.toContain('UNALLOCATED_TIP');
  });
});

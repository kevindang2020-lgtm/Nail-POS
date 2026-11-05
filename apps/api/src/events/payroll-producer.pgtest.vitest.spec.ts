// payroll-producer.pgtest — payroll.period_paid was declared since Constitution 8 and recorded by nothing. Marking a period
// paid records it in the status write's transaction — once (a paid period is locked) — with totals only.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyPayrollRepository } from '@aipowersalon/workforce';
import { seedRow, seedTechnician } from './pgtest-seed';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';

const T = '38383838-3838-4383-8383-383838383838', B = '39393939-3939-4393-8393-393939393939', P = '3a3a3a3a-3a3a-43a3-83a3-3a3a3a3a3a3a', P2 = '3c3c3c3c-3a3a-43a3-83a3-3a3a3a3a3a3c', TECH = '3d3d3d3d-3a3a-43a3-83a3-3a3a3a3a3a3d';
const ctx = { tenantId: T, branchId: B, userId: '3b3b3b3b-3b3b-43b3-83b3-3b3b3b3b3b3b' } as any;
let db: any; let repo: KyselyPayrollRepository;

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'P', display_name: 'Payroll Salon', tenant_slug: 'payrollsalon', tenant_code: 'PAYR01', status: 'active' });
  await seedRow(pg, 'branches', { id: B, tenant_id: T, name: 'Main' });
  await seedRow(pg, 'payroll_periods', { id: P, tenant_id: T, branch_id: B, status: 'finalized', period_start: '2026-09-01', period_end: '2026-09-15', total_payable_cents: 123456 });
  await seedRow(pg, 'payroll_periods', { id: P2, tenant_id: T, branch_id: B, status: 'draft', period_start: '2026-09-16', period_end: '2026-09-30', total_payable_cents: 5000 });
  await seedTechnician(pg, TECH, T, B);
  await seedRow(pg, 'payroll_lines', { tenant_id: T, period_id: P2, technician_id: TECH, payable_cents: 5000 });
  repo = new KyselyPayrollRepository(db, new OutboxWriter());
});

describe('payroll.period_paid', () => {
  it('finalized -> paid records it once with the total; setting paid again records nothing', async () => {
    const r = await repo.setStatus(ctx, P, 'paid' as any);
    expect(r?.status).toBe('paid');
    await repo.setStatus(ctx, P, 'paid' as any);
    const out = (await sql`SELECT aggregate_id, payload_json FROM outbox_events WHERE event_type = 'payroll.period_paid'`.execute(db)).rows as any[];
    expect(out.map((x) => x.aggregate_id)).toEqual([P]);
    expect(out[0].payload_json).toMatchObject({ periodId: P, status: 'paid', previousStatus: 'finalized', totalPayableCents: 123456, technicianIds: [] });
  });
  it('approve (draft -> finalized) and reopen (-> draft) are recorded with the technicians on the period; the projection tells the owner AND each technician', async () => {
    expect((await repo.setStatus(ctx, P2, 'finalized' as any))?.status).toBe('finalized');
    expect((await repo.setStatus(ctx, P2, 'draft' as any))?.status).toBe('draft');
    const rows = (await sql`SELECT event_type, tenant_id, branch_id, aggregate_id, payload_json FROM outbox_events WHERE aggregate_id = ${P2} ORDER BY occurred_at`.execute(db)).rows as any[];
    expect(rows.map((r) => r.event_type)).toEqual(['payroll.period_finalized', 'payroll.period_reopened']);
    expect(rows[0].payload_json).toMatchObject({ status: 'finalized', previousStatus: 'draft', technicianIds: [TECH] });
    const sent: any[] = [];
    await new RealtimeProjectionConsumer({ toTenant: () => {}, toOwner: (t: string, ev: string, pl: any) => sent.push(['owner', t === T ? 'T' : t, ev, pl.action]), toTechnician: (id: string, ev: string, pl: any) => sent.push(['tech', id === TECH ? 'TECH' : id, ev, pl.action]) } as any)
      .handle({ eventType: rows[0].event_type, tenantId: rows[0].tenant_id, branchId: rows[0].branch_id, aggregateId: rows[0].aggregate_id, payload: rows[0].payload_json } as any);
    expect(sent).toEqual([['owner', 'T', 'owner_payroll_updated', 'payroll_approved'], ['tech', 'TECH', 'technician_earnings_updated', 'payroll_approved']]);
  });
});

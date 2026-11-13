// ai-business-branch-freshness.pgtest — AI BRANCH COMPARISON 11 (round 10): per-branch freshness on the REAL schema — the newest
// checkout / booking per branch and each branch's own undelivered events; "delayed" only past the lag limit; read-only; and the
// comparison rows carry it when the source is wired (nothing invented without it).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyBranchFreshness, branchFreshness, BRANCH_EVENT_LAG_DELAYED_SECONDS } from './ai-business-branch-freshness';
import { AiBusinessBranchesService } from './ai-business-branches.service';

const id = (n: number) => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B1 = id(2), B2 = id(3), U = id(9), TE1 = id(20), C = id(30);
let pg: any; let db: any;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Lux','st-910','ST910','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$3,'Big','active','UTC'), ($2,$3,'Small','active','UTC')`, [B1, B2, T]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'A','A','A A')`, [TE1, T, B1]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'F','R','F R')`, [C, T, B1]);
}, 180_000);

describe('AI BRANCH COMPARISON 11 — per-branch freshness', () => {
  it('BF-01 newest ticket / booking per branch and each branch\'s own undelivered events; delayed only past the lag limit; read-only', async () => {
    const now = new Date('2026-11-05T15:00:00Z');
    await q(`insert into tickets (tenant_id, branch_id, customer_id, status, total_cents, paid_at, created_at) values ($1,$2,$3,'paid',1000,'2026-11-05T14:00:00Z','2026-11-05T13:50:00Z')`, [T, B1, C]);
    await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, created_at) values ($1,$2,$3,$4,'F R','2026-11-06','10:00','11:00','booked','2026-11-05T12:00:00Z')`, [T, B1, TE1, C]);
    await q(`insert into outbox_events (id, event_type, tenant_id, branch_id, aggregate_type, aggregate_id, correlation_id, payload_json, occurred_at, publish_status) values
      (gen_random_uuid(),'ticket.paid',$1,$2,'ticket','x','c','{}'::jsonb,$3,'failed'), (gen_random_uuid(),'ticket.paid',$1,$4,'ticket','y','c','{}'::jsonb,$5,'pending')`,
      [T, B2, new Date(now.getTime() - (BRANCH_EVENT_LAG_DELAYED_SECONDS + 120) * 1000), B1, new Date(now.getTime() - 60 * 1000)]);
    const before = (await q(`select count(*)::int n from outbox_events where tenant_id = $1`, [T]))[0].n;
    const f = await branchFreshness(db, T, [B1, B2], now);
    expect(f[B1]).toEqual({ lastTicketAt: '2026-11-05T14:00:00.000Z', lastBookingAt: '2026-11-05T12:00:00.000Z', eventsWaiting: 1, oldestEventLagSeconds: 60, delayed: false });
    expect(f[B2]).toEqual({ lastTicketAt: null, lastBookingAt: null, eventsWaiting: 1, oldestEventLagSeconds: BRANCH_EVENT_LAG_DELAYED_SECONDS + 120, delayed: true });
    expect((await q(`select count(*)::int n from outbox_events where tenant_id = $1`, [T]))[0].n).toBe(before);
  });
  it('BF-02 the comparison rows carry each branch\'s freshness when wired; none without the source', async () => {
    const reports = {
      getBooking: async () => ({ totalBookings: 10, completed: 8, cancelledPercent: 0, noShowPercent: 0 }),
      getSales: async () => ({ kpis: { netSalesCents: 40000, ticketsCount: 8 } }),
    } as any;
    const scope = { listAuthorizedBranches: async () => [{ branchId: B1, branchName: 'Big', status: 'active' }, { branchId: B2, branchName: 'Small', status: 'active' }] } as any;
    const ctx = { tenantId: T, userId: U, role: 'OWNER', permissions: ['pos.reports.financial_view'] } as any;
    const r: any = await new AiBusinessBranchesService(reports, scope, new KyselyBranchFreshness(db)).compareBranches(ctx, { from: '2026-11-01', to: '2026-11-06' });
    expect(r.branches.find((b: any) => b.branchId === B2).freshness).toMatchObject({ eventsWaiting: 1, delayed: true });
    expect(r.branches.find((b: any) => b.branchId === B1).freshness).toMatchObject({ lastTicketAt: '2026-11-05T14:00:00.000Z', eventsWaiting: 1 });
    const plain: any = await new AiBusinessBranchesService(reports, scope).compareBranches(ctx, { from: '2026-11-01', to: '2026-11-06' });
    expect(plain.branches[0].freshness).toBeUndefined();
  });
});

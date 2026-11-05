// checkout-state-bounded.pgtest — BUILD_PLAN Phase 10 load finding (Constitution 1 §101): GET /pos/checkout/state loaded
// and hydrated EVERY ticket the branch ever had (five queries per ticket) plus every payment, so one request took
// 36–42 s on a branch with ~6,700 tickets and 50 concurrent clients timed out. The board only needs the tickets still
// open plus today's; history is the transactions screen's job.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';

const T = 'cb000000-0000-4000-8000-000000000001';
const B = 'cb000000-0000-4000-8000-0000000000b1';
const ctx: any = { tenantId: T, branchId: B, userId: 'cb000000-0000-4000-8000-0000000000f1', role: 'OWNER', permissions: [] };
let pg: any; let repo: KyselyCheckoutRepository;
const NOW = Date.parse('2026-10-08T16:00:00Z');   // noon in New York
const DAY = 86_400_000;
const C = 'cb000000-0000-4000-8000-0000000000c1';

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'B', 'B', 'cb-bounded', 'CBB01', 'active');
    INSERT INTO branches (id, tenant_id, name, timezone) VALUES ('${B}', '${T}', 'Main', 'America/New_York');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C}', '${T}', '${B}', 'Pat', 'Guest', 'Pat Guest');`);
  const old = new Date(NOW - 3 * DAY).toISOString();
  // 40 tickets paid three days ago — history, not the board
  for (let i = 0; i < 40; i++) {
    const t = (await pg.query(`insert into tickets (tenant_id, branch_id, customer_id, status, created_at, paid_at) values ($1,$2,'${C}','paid',$3,$3) returning id`, [T, B, old])).rows[0].id;
    await pg.query(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) values ($1,$2,$3,'cash',1000,'approved',$4)`, [T, B, t, old]);
  }
  // still open from three days ago — stays on the board until it is paid
  await pg.query(`insert into tickets (tenant_id, branch_id, customer_id, status, created_at) values ($1,$2,'${C}','ready_for_payment',$3)`, [T, B, old]);
  // paid today
  const today = new Date(NOW - 3_600_000).toISOString();
  const tp = (await pg.query(`insert into tickets (tenant_id, branch_id, customer_id, status, created_at, paid_at) values ($1,$2,'${C}','paid',$3,$3) returning id`, [T, B, today])).rows[0].id;
  await pg.query(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) values ($1,$2,$3,'cash',2500,'approved',$4)`, [T, B, tp, today]);
  // created yesterday, paid today (crosses midnight) — today's money, must be on the board
  const yest = new Date(NOW - DAY).toISOString();
  const ty = (await pg.query(`insert into tickets (tenant_id, branch_id, customer_id, status, created_at, paid_at) values ($1,$2,'${C}','paid',$3,$4) returning id`, [T, B, yest, today])).rows[0].id;
  await pg.query(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) values ($1,$2,$3,'card',1500,'approved',$4)`, [T, B, ty, today]);
  repo = new KyselyCheckoutRepository(kyselyFor(pg) as any);
  repo.now = () => NOW;
}, 120_000);

describe('checkout board state is bounded to open tickets + today', () => {
  it('lists the open ticket and today\'s two paid tickets — not the 40 paid three days ago', async () => {
    const s = await repo.query(ctx, { page: 1, pageSize: 100 } as any);
    expect(s.tickets.pagination.totalItems).toBe(3);
    expect(s.kpisFull.ticketsReadyForPayment).toBe(1);
    expect(s.kpisFull.paidTicketsToday).toBe(2);
  });
  it('hydrates only the bounded set (no per-ticket queries for history)', async () => {
    const hydrate = (repo as any).hydrate.bind(repo); let calls = 0;
    (repo as any).hydrate = (c: any, t: any) => { calls++; return hydrate(c, t); };
    try { await repo.query(ctx, { page: 1, pageSize: 20 } as any); } finally { (repo as any).hydrate = hydrate; }
    expect(calls).toBeLessThanOrEqual(3);
  });
});

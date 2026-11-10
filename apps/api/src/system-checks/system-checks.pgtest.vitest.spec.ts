// system-checks.pgtest — the shared read-only Check … System (extras arc, Nov 9 2026) on the REAL schema:
// every check of every page runs (none NOT_TESTED), planted problems are counted, another salon's rows never are,
// the branch scope narrows the counts, and nothing is written.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { SYSTEM_CHECK_DOMAINS } from '@aipowersalon/api-contracts/tenant';
import { SystemChecksService } from './system-checks.service';
import { SYSTEM_CHECKS } from './system-checks.registry';

const P = 'c8450000-0000-4000-8000-'; const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), X = id(2), B1 = id(3), B2 = id(4), BX = id(5);
let db: any; let svc: SystemChecksService;
const q = (s: any) => s.execute(db);
const count = (r: any, key: string) => r.checks.find((c: any) => c.key === key);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  svc = new SystemChecksService(db);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'sc-845', 'SC845', 'active'), (${X}, 'X', 'Other', 'sc-845x', 'SC845X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name) values (${B1}, ${T}, 'Main'), (${B2}, ${T}, 'Second'), (${BX}, ${X}, 'Other main')`);
  // expenses: parts that do not add up in B1, one future-dated in B2, and the same problems in the OTHER salon (never counted)
  await q(sql`insert into expenses (tenant_id, branch_id, category, amount_cents, subtotal_cents, tax_cents, incurred_on) values
    (${T}, ${B1}, 'supplies', 1500, 1000, 100, current_date), (${T}, ${B2}, 'supplies', 1200, null, null, current_date + 30), (${T}, ${B1}, 'rent', 9000, 9000, 0, current_date),
    (${X}, ${BX}, 'supplies', 700, 100, 0, current_date), (${X}, ${BX}, 'supplies', 100, null, null, current_date + 30)`);
  // deals: one redeemed past its cap, one ending before it starts
  await q(sql`insert into deals (tenant_id, branch_id, owner_type, title, discount_type, discount_percent, max_redemptions, redemption_count, status, starts_at, ends_at) values
    (${T}, ${B1}, 'salon', 'Fall 10%', 'percent', 10, 5, 7, 'active', now() - interval '2 days', now() + interval '5 days'),
    (${T}, ${B1}, 'salon', 'Backwards', 'percent', 10, null, 0, 'draft', now() + interval '5 days', now() + interval '1 day'),
    (${X}, ${BX}, 'salon', 'Other', 'percent', 10, 1, 9, 'active', now() - interval '2 days', now() + interval '5 days')`);
  // technicians: two active with the same phone
  await q(sql`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, is_active) values
    (${T}, ${B1}, 'A', 'One', 'A One', '+15550001111', true), (${T}, ${B1}, 'B', 'Two', 'B Two', '+15550001111', true)`);
  // reports: ticket 11 charged 5000 but only 4000 collected; ticket 12 reconciles but its cash payment carries a surcharge;
  // ticket 13 is the other salon's identical mismatch (never counted)
  await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values
    (${id(21)}, ${T}, ${B1}, 'C', 'One', 'C One', '+15550002221'), (${id(22)}, ${X}, ${BX}, 'C', 'X', 'C X', '+15550002222')`);
  await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at, subtotal_cents, tax_cents, discount_cents, total_cents) values
    (${id(11)}, ${T}, ${B1}, ${id(21)}, 'paid', now(), 5000, 0, 0, 5000), (${id(12)}, ${T}, ${B2}, ${id(21)}, 'paid', now(), 3000, 0, 0, 3000), (${id(13)}, ${X}, ${BX}, ${id(22)}, 'paid', now(), 5000, 0, 0, 5000)`);
  await q(sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, surcharge_cents, tip_cents, tax_cents, discount_cents, change_due_cents, status) values
    (${T}, ${B1}, ${id(11)}, 'card', 4000, 0, 0, 0, 0, 0, 'approved'), (${T}, ${B2}, ${id(12)}, 'cash', 3000, 100, 0, 0, 0, 0, 'approved'),
    (${X}, ${BX}, ${id(13)}, 'card', 4000, 0, 0, 0, 0, 0, 'approved')`);
  // ticket 12 carries a line for a service no longer in the catalog and with no category snapshot (unmapped); the other
  // salon's ticket 13 has the same (never counted); ticket 11 has no line at all
  await q(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values
    (${T}, ${B2}, ${id(12)}, ${id(31)}, 'Nail art', 3000, 15, 3000), (${X}, ${BX}, ${id(13)}, ${id(32)}, 'Nail art', 5000, 15, 5000)`);
});

describe('shared read-only Check … System', () => {
  it('every check of every page runs on the real schema (none NOT_TESTED)', async () => {
    for (const d of SYSTEM_CHECK_DOMAINS) {
      const r = await svc.run(d, { tenantId: T });
      expect(r.checks.map((c) => c.key), d).toEqual(SYSTEM_CHECKS[d].checks.map((c) => c.key));
      expect(r.checks.filter((c) => c.state === 'NOT_TESTED').map((c) => `${d}.${c.key}`)).toEqual([]);
    }
  });
  it('counts planted problems — and never another salon\'s rows', async () => {
    const e = await svc.run('expenses', { tenantId: T });
    expect(count(e, 'parts_mismatch')).toEqual({ key: 'parts_mismatch', state: 'WARNING', count: 1 });
    expect(count(e, 'future_dated')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(e.overall).toBe('WARNING');
    const dl = await svc.run('discounts', { tenantId: T });
    expect(count(dl, 'over_redeemed')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(count(dl, 'ends_before_starts')).toMatchObject({ state: 'FAILED', count: 1 });
    const tc = await svc.run('technicians', { tenantId: T });
    expect(count(tc, 'duplicate_phone')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(tc, 'no_app_account')).toMatchObject({ state: 'WARNING', count: 2 });
    const rp = await svc.run('reports', { tenantId: T });
    expect(count(rp, 'charged_vs_collected')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(rp, 'surcharge_not_card')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(count(rp, 'paid_without_service_lines')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(rp, 'unmapped_service_lines')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(rp.overall).toBe('FAILED');
    const rp1 = await svc.run('reports', { tenantId: T, branchId: B1 });
    expect(count(rp1, 'surcharge_not_card')).toMatchObject({ state: 'READY', count: 0 });

  });
  it('the branch scope narrows the counts', async () => {
    const b1 = await svc.run('expenses', { tenantId: T, branchId: B1 });
    expect(b1.branchId).toBe(B1);
    expect(count(b1, 'parts_mismatch').count).toBe(1);
    expect(count(b1, 'future_dated')).toMatchObject({ state: 'READY', count: 0 });
  });
  it('a clean page is READY; no session tenant is NOT_TESTED, never a pass', async () => {
    const m = await svc.run('memberships', { tenantId: T });
    expect(m.overall).toBe('READY');
    const none = await svc.run('expenses', {});
    expect(none.overall).toBe('NOT_TESTED');
    expect(none.checks.every((c) => c.state === 'NOT_TESTED' && c.count === null)).toBe(true);
  });
  it('writes nothing', async () => {
    const before = (await q(sql`select (select count(*) from expenses) + (select count(*) from deals) + (select count(*) from technicians) as n`)).rows[0].n;
    for (const d of SYSTEM_CHECK_DOMAINS) await svc.run(d, { tenantId: T });
    expect((await q(sql`select (select count(*) from expenses) + (select count(*) from deals) + (select count(*) from technicians) as n`)).rows[0].n).toBe(before);
  });
});

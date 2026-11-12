// deals-by-branch.pgtest — Extras · Deals 11: the deals dashboard compares verified (paid) usage and net discount cost by
// location, from deal_redemptions, and never reports associated revenue as lift.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyDealsRepository } from '../deals/deals.kysely.repository';
import { DealsService } from '../deals/deals.service';

const T = 'e6000000-0000-4000-8000-000000000001', B1 = 'e6000000-0000-4000-8000-0000000000b1', B2 = 'e6000000-0000-4000-8000-0000000000b2';
const OTHER_T = 'e6000000-0000-4000-8000-000000000002', OB = 'e6000000-0000-4000-8000-0000000000b3';
const ctx: any = { tenantId: T, branchId: B1, userId: 'e6000000-0000-4000-8000-0000000000f1', role: 'OWNER', permissions: [] };
let db: any; let svc: DealsService; let dealId: string; let otherDeal: string;

async function customer(tenant = T): Promise<string> {
  const id = randomUUID();
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${id}, ${tenant}, ${tenant === T ? B1 : OB}, 'C', 'X', 'C X')`.execute(db);
  return id;
}
async function use(o: { deal?: string; tenant?: string; branch: string | null; customer: string; cents: number; reversed?: number; status: string; paid?: boolean }) {
  await sql`insert into deal_redemptions (deal_id, tenant_id, branch_id, customer_id, amount_discounted_cents, reversed_cents, deal_version, status, redeemed_at)
            values (${o.deal ?? dealId}, ${o.tenant ?? T}, ${o.branch}, ${o.customer}, ${o.cents}, ${o.reversed ?? 0}, 1, ${o.status}, ${o.paid === false ? null : sql`now()`})`.execute(db);
}

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  for (const [id, slug] of [[T, 'bybranch'], [OTHER_T, 'other']]) await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${id}, 'E', 'Salon', ${slug}, ${slug.toUpperCase().slice(0, 5)}, 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, status, timezone) values (${B1}, ${T}, 'Main', 'active', 'America/New_York'), (${B2}, ${T}, 'Second', 'active', 'America/New_York'), (${OB}, ${OTHER_T}, 'Other', 'active', 'America/New_York')`.execute(db);
  dealId = randomUUID(); otherDeal = randomUUID();
  await sql`insert into deals (id, tenant_id, owner_type, kind, title, discount_type, discount_percent, status) values (${dealId}, ${T}, 'salon', 'deal', 'Spring', 'percent', 20, 'active'), (${otherDeal}, ${OTHER_T}, 'salon', 'deal', 'Other', 'percent', 20, 'active')`.execute(db);
  svc = new DealsService(new KyselyDealsRepository(db, new OutboxWriter()));
});

describe('dashboard.byBranch', () => {
  it('paid uses only, net of refunds, per location; unpaid applications and other tenants are excluded; no revenue field', async () => {
    const c1 = await customer(); const c2 = await customer();
    await use({ branch: B1, customer: c1, cents: 700, status: 'redeemed' });
    await use({ branch: B1, customer: c1, cents: 300, status: 'redeemed' });
    await use({ branch: B1, customer: c2, cents: 500, status: 'applied', paid: false });                 // never paid
    await use({ branch: B2, customer: c2, cents: 1200, reversed: 200, status: 'partially_reversed' });
    await use({ branch: B2, customer: c2, cents: 900, reversed: 900, status: 'reversed' });               // fully refunded
    await use({ branch: null, customer: c1, cents: 400, status: 'redeemed' });
    await use({ deal: otherDeal, tenant: OTHER_T, branch: null, customer: await customer(OTHER_T), cents: 9999, status: 'redeemed' });
    const dash = await svc.dashboard(ctx, 7);
    expect(dash.byBranch).toEqual([                                             // highest cost first, ties by name
      { branchId: B1, branchName: 'Main', uses: 2, customers: 1, netDiscountCents: 1000, avgDiscountCents: 500 },
      { branchId: B2, branchName: 'Second', uses: 1, customers: 1, netDiscountCents: 1000, avgDiscountCents: 1000 },
      { branchId: null, branchName: null, uses: 1, customers: 1, netDiscountCents: 400, avgDiscountCents: 400 },
    ]);
    for (const b of dash.byBranch) expect(Object.keys(b).some((k) => /revenue/i.test(k))).toBe(false);
  });
});

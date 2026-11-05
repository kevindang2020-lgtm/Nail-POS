// deal-producer.pgtest — deal.redeemed was declared since Constitution 8 and recorded by nothing. BUILD_PLAN Phase 5: a
// deal is put on a ticket (applied) and REDEEMED when the ticket is paid — in the transaction that marks the use redeemed
// and bumps the deal's count. A replayed payment hook records nothing and does not double-count.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyDealsRepository } from '@aipowersalon/deals';
import { seedRow } from './pgtest-seed';

const T = '32323232-3232-4323-8323-323232323232', B = '33333333-3232-4323-8323-323232323233', CU = '34343434-3434-4343-8343-343434343434';
const DEAL = '35353535-3535-4353-8353-353535353535', TICKET = '36363636-3636-4363-8363-363636363636';
const USER = '37373737-3737-4373-8373-373737373737';
let db: any; let repo: KyselyDealsRepository;

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'D', display_name: 'Deal Salon', tenant_slug: 'dealsalon', tenant_code: 'DEAL01', status: 'active' });
  await seedRow(pg, 'branches', { id: B, tenant_id: T, name: 'Main' });
  await seedRow(pg, 'customers', { id: CU, tenant_id: T, branch_id: B, first_name: 'D', last_name: 'L', full_name: 'D L', normalized_phone: '+16095550133', status: 'active' });
  await seedRow(pg, 'deals', { id: DEAL, tenant_id: T, owner_type: 'salon', title: 'Fall mani', discount_type: 'fixed', discount_cents: 1500, status: 'active' });
  repo = new KyselyDealsRepository(db, new OutboxWriter());
});

describe('deal.redeemed', () => {
  it('a paid ticket records it once, with the discount; a replayed payment hook records nothing and does not double-count', async () => {
    const app = await repo.ledger.apply({ tenantId: T, branchId: B, ticketId: TICKET, customerId: CU, dealId: DEAL, kind: 'deal', discountCents: 1500,
      lines: [{ lineId: 'l1', cents: 1500 }], terms: { title: 'Fall mani', discountType: 'fixed', discountCents: 1500 }, dealVersion: 1, userId: USER }, { maxRedemptions: null, maxPerCustomer: null, budgetCents: null });
    expect((await sql`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'deal.redeemed'`.execute(db)).rows[0]).toMatchObject({ n: 0 });   // applied ≠ redeemed
    const a = await repo.ledger.markTicketPaid(T, TICKET);
    const b = await repo.ledger.markTicketPaid(T, TICKET);
    expect(a.redeemed).toBe(1);
    expect(b.redeemed).toBe(0);
    const out = (await sql`SELECT aggregate_id, payload_json FROM outbox_events WHERE event_type = 'deal.redeemed'`.execute(db)).rows as any[];
    expect(out.map((r) => r.aggregate_id)).toEqual([app.redemptionId]);
    expect(out[0].payload_json).toMatchObject({ redemptionId: app.redemptionId, dealId: DEAL, customerId: CU, ticketId: TICKET, amountDiscountedCents: 1500 });
    expect(Number(((await sql`SELECT redemption_count FROM deals WHERE id = ${DEAL}`.execute(db)).rows[0] as any).redemption_count)).toBe(1);
  });
});

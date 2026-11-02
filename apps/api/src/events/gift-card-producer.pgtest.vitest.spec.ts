// gift-card-producer.pgtest — gift_card.issued / gift_card.redeemed were declared since Constitution 8 and recorded by
// nothing. They carry cents and ids only — never the card code, number or PIN.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyCheckoutRepository } from '@aipowersalon/checkout';

const T = '1e1e1e1e-1e1e-41e1-81e1-1e1e1e1e1e1e', B = '1f1f1f1f-1f1f-41f1-81f1-1f1f1f1f1f1f';
const ctx = { tenantId: T, branchId: B, userId: '20202020-2020-4202-8202-202020202020' } as any;
let db: any; let repo: KyselyCheckoutRepository;
const facts = async (type: string) => (await sql`SELECT tenant_id, aggregate_id, payload_json FROM outbox_events WHERE event_type = ${type} ORDER BY occurred_at`.execute(db)).rows as any[];

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','G','Gift Salon','gift','GIFT01','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main') ON CONFLICT (id) DO NOTHING;
  `);
  repo = new KyselyCheckoutRepository(db, new OutboxWriter());
});

describe('gift card facts', () => {
  it('issue -> gift_card.issued once (a retry with the same key records nothing); no code in the payload', async () => {
    await repo.issueGiftCard(ctx, { code: 'GIFT-ABC-123', amountCents: 5000, idempotencyKey: 'gc-1' });
    await repo.issueGiftCard(ctx, { code: 'GIFT-ABC-123', amountCents: 5000, idempotencyKey: 'gc-1' });
    const f = await facts('gift_card.issued');
    expect(f.length).toBe(1);
    expect(f[0]).toMatchObject({ tenant_id: T });
    expect(f[0].payload_json).toMatchObject({ amountCents: 5000, source: 'issue' });
    expect(JSON.stringify(f[0].payload_json)).not.toContain('GIFT-ABC-123');
  });
  it('redeem -> gift_card.redeemed booked at the card\'s salon, with the balance after; a refused redemption records nothing', async () => {
    expect(await repo.decrementGift(ctx, 'GIFT-ABC-123', 1500)).toBe(true);
    expect(await repo.decrementGift(ctx, 'GIFT-ABC-123', 999999)).toBe(false);          // over-redeem refused
    const f = await facts('gift_card.redeemed');
    expect(f.length).toBe(1);
    expect(f[0]).toMatchObject({ tenant_id: T });
    expect(f[0].payload_json).toMatchObject({ amountCents: 1500, balanceAfterCents: 3500, redeemingTenantId: T, crossTenant: false });
    expect(JSON.stringify(f[0].payload_json)).not.toContain('GIFT-ABC-123');
  });
});

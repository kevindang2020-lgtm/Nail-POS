// gift-cards-deliveries.pgtest — GIFT CARDS extras 13 "Secure digital delivery monitoring", against the REAL schema:
// the card detail lists each recorded SMS / email send of the claim link with sent / failed / pending status, the
// destination masked, a failure category (never the raw provider text) and whether the destination is opted out now.
// Another salon's deliveries are invisible; reading changes nothing.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { GiftCardsScreenRepository, deliveryFailure } from './gift-cards-screen.repository';

const P = 'f8a2b3c4-0000-4000-8000-0000002';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9'), U = id('e1');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.checkout.view'] } as any;
let pg: any; let r: GiftCardsScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
async function card(tenant: string, branch: string, code: string, last4: string) {
  return (await q(`insert into gift_cards (tenant_id, branch_id, code, card_number_last4, initial_balance_cents, balance_cents, purchased_cents, status) values ($1,$2,$3,$4,5000,5000,5000,'active') returning id`,
    [tenant, branch, code, last4])).rows[0].id as string;
}
async function delivery(tenant: string, cardId: string, channel: string, dest: string | null, status: string, o: { reason?: string; sid?: string; at: string }) {
  await q(`insert into gift_card_deliveries (tenant_id, gift_card_id, channel, destination, status, provider_message_id, failure_reason, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$8::timestamptz)`,
    [tenant, cardId, channel, dest, status, o.sid ?? null, o.reason ?? null, o.at]);
}

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus','gv-lotus','GVL001','active'), ($2,'Other LLC','Other','gv-other','GVL002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Cherry Hill','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, BX, T2]);
  r = new GiftCardsScreenRepository(kyselyFor(pg));
}, 180_000);

describe('Gift Cards — digital delivery monitoring (read-only, masked)', () => {
  it('a card never sent digitally has an empty delivery list', async () => {
    const c = await card(T, B, 'GC-PLAIN0001', '1010');
    expect((await r.detail(ctx, c)).deliveries).toEqual({ items: [], sent: 0, failed: 0, pending: 0, optedOut: 0 });
  });

  it('lists sent / failed / pending sends newest first, masked, with a failure category and the opt-out state', async () => {
    const c = await card(T, B, 'GC-SENT00001', '2020');
    await delivery(T, c, 'sms', '+12155550123', 'failed', { reason: 'Provider 21610: Attempt to send to unsubscribed recipient +12155550123', at: '2026-11-01T15:00:00Z' });
    await delivery(T, c, 'email', 'Ann.Lee@Example.com', 'sent', { sid: 'em_123', at: '2026-11-02T15:00:00Z' });
    await delivery(T, c, 'email', 'bo@example.com', 'pending', { at: '2026-11-03T15:00:00Z' });
    await q(`insert into notification_opt_outs (tenant_id, channel, address, reason, scope) values ($1,'sms','+12155550123','STOP','all'), ($1,'email','bo@example.com','unsub','marketing')`, [T]);
    const before = (await q(`select id, status, updated_at from gift_card_deliveries order by id`)).rows;

    const d = (await r.detail(ctx, c)).deliveries;
    expect(d.items.map((x: any) => [x.channel, x.status])).toEqual([['email', 'pending'], ['email', 'sent'], ['sms', 'failed']]);
    expect(d.items[0]).toMatchObject({ to: 'b•••@example.com', failure: null, optedOut: false });   // marketing-only unsubscribe ≠ blocked
    expect(d.items[1]).toMatchObject({ to: 'A•••@Example.com', failure: null, optedOut: false, at: '2026-11-02T15:00:00.000Z' });
    expect(d.items[2]).toMatchObject({ to: '(•••) •••-0123', failure: 'opted_out', optedOut: true });
    expect({ sent: d.sent, failed: d.failed, pending: d.pending, optedOut: d.optedOut }).toEqual({ sent: 1, failed: 1, pending: 1, optedOut: 1 });
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/2155550123|2155559999|Ann\.Lee|bo@example|em_123|21610|unsubscribed|GC-SENT/);   // no raw PII, provider id, provider text or code
    expect((await q(`select id, status, updated_at from gift_card_deliveries order by id`)).rows).toEqual(before);   // read-only
  });

  it('another salon cannot open the card (and so none of its deliveries)', async () => {
    const c = await card(T, B, 'GC-MINE00001', '3030');
    await delivery(T, c, 'sms', '+12155550456', 'sent', { at: '2026-11-05T15:00:00Z' });
    await expect(r.detail({ ...ctx, tenantId: T2, branchId: BX }, c)).rejects.toMatchObject({ code: 'GIFT_CARD_NOT_FOUND' });
  });

  it('failure categories never echo the provider text', () => {
    expect(deliveryFailure('SMS provider not configured')).toBe('not_configured');
    expect(deliveryFailure('21211 Invalid To phone number')).toBe('invalid_destination');
    expect(deliveryFailure('recipient opted out')).toBe('opted_out');
    expect(deliveryFailure('socket hang up')).toBe('provider_error');
    expect(deliveryFailure(null)).toBe('provider_error');
  });
});

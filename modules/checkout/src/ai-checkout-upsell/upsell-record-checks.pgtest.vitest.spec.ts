// upsell-record-checks.pgtest — Checkout Upsell 09 "Missed-service detection — two distinct workflows. Never confuse a
// financial mismatch with a sales opportunity: a service actually performed but not included on the ticket is a potential
// record discrepancy requiring human review." On the REAL migrated schema: the requested services come from the queue
// entry the ticket was opened from; a requested service missing from the ticket is a RECORD CHECK (separate list, no
// price, nothing added) and is never offered back as an add-on sales card.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { AiCheckoutUpsellService } from './ai-checkout-upsell.service';
import { KyselyRequestedServices, requestedList } from './ai-checkout-upsell.kysely';
import { detectRecordChecks } from './ai-checkout-upsell-core';

const id = (n: number) => `09090000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), T2 = id(2), B = id(3), B2 = id(4), BX = id(5);
const GEL = id(10), ART = id(11), PED = id(12);
const C1 = id(40), CX = id(41);
const Q1 = id(20), Q2 = id(21), QX = id(22), TK1 = id(30), TK2 = id(31), TK3 = id(32), TKX = id(33);
let pg: any; let db: any;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
const ctx = (o: any = {}): any => ({ tenantId: T, branchId: B, userId: id(9), role: 'MANAGER', permissions: ['pos.ai_checkout_upsell.view', 'pos.checkout.view'], deviceId: null, ...o });

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Pilot','rc-09','RC09','active'), ($2,'X','Other','rc-09x','RC09X','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'North','active','America/New_York'), ($4,$5,'Other','active','America/New_York')`, [B, T, B2, BX, T2]);
  const svcs = JSON.stringify([{ serviceId: GEL, serviceName: 'Gel Manicure', priceCents: 4500 }, { serviceId: ART, serviceName: 'Nail Art', priceCents: 1500 }, { serviceName: 'Paraffin Dip' }]);
  await q(`insert into pos_queue_items (id, tenant_id, branch_id, customer_name, is_vip, source, requested_services, priority, status) values
    ($1,$4,$5,'Linh',false,'appointment',$6::jsonb,'normal','in_service'), ($2,$4,$5,'Mai',false,'walk_in','[]'::jsonb,'normal','in_service'), ($3,$7,$8,'X',false,'walk_in',$6::jsonb,'normal','in_service')`,
  [Q1, Q2, QX, T, B, svcs, T2, BX]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$3,$4,'Linh','P','Linh P'), ($2,$5,$6,'X','Y','X Y')`, [C1, CX, T, B, T2, BX]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, queue_item_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, ticket_number, created_at, updated_at) values
    ($1,$5,$6,$12,$7,'serving',4500,0,0,4500,0,'T-1',now(),now()), ($2,$5,$6,$12,$8,'serving',4500,0,0,4500,0,'T-2',now(),now()), ($3,$5,$6,$12,null,'serving',4500,0,0,4500,0,'T-3',now(),now()),
    ($4,$9,$10,$13,$11,'serving',4500,0,0,4500,0,'T-X',now(),now())`, [TK1, TK2, TK3, TKX, T, B, Q1, Q2, T2, BX, QX, C1, CX]);
}, 180_000);

describe('Checkout Upsell 09 — missed-service detection (record checks vs sales)', () => {
  it('reads the requested services from the queue entry the ticket came from; tenant + branch scoped', async () => {
    const r = new KyselyRequestedServices(db);
    expect((await r.requested(ctx(), TK1)).map((x) => x.name)).toEqual(['Gel Manicure', 'Nail Art', 'Paraffin Dip']);
    expect(await r.requested(ctx(), TK2)).toEqual([]);           // walk-in that asked for nothing listed
    expect(await r.requested(ctx(), TK3)).toEqual([]);           // no queue entry at all
    expect(await r.requested(ctx(), TKX)).toEqual([]);           // another salon's ticket — nothing
    expect(await r.requested(ctx({ branchId: B2 }), TK1)).toEqual([]);   // another branch of the same salon — nothing
  });

  it('a requested service missing from the ticket is a record check (no price, confirm with the technician) — never a sales card', async () => {
    const tk = { checkoutId: TK1, branchId: B, customerId: null, status: 'serving', serviceLines: [{ serviceId: GEL, serviceName: 'Gel Manicure' }], cartAddOnIds: [], subtotalCents: 4500, technicianIds: [] };
    // the catalog would offer Nail Art (and Chrome) as add-ons for Gel — Nail Art is under record check, so it is NOT offered
    const addOns = { getAddOns: async () => [{ addOnId: ART, name: 'Nail Art', priceCents: 1500, durationDeltaMinutes: 0, isTaxable: true, isActive: true }, { addOnId: PED, name: 'Chrome', priceCents: 1000, durationDeltaMinutes: 0, isTaxable: true, isActive: true }] };
    const none: any = { async candidates() { return []; } };
    const svc = new AiCheckoutUpsellService({ getTicket: async () => tk } as any, addOns as any, none, none, { async state() { return null; } } as any,
      { async options() { return { enabled: false, allowedAmountsCents: [] }; } } as any, { async context() { return null; } } as any,
      undefined, undefined, null, undefined, undefined, undefined, undefined, new KyselyRequestedServices(db));
    const res = await svc.recommendations(ctx(), TK1);
    expect(res.recordChecks).toEqual([
      { kind: 'requested_not_on_ticket', serviceId: ART, serviceName: 'Nail Art', nextStep: 'confirm_with_technician' },
      { kind: 'requested_not_on_ticket', serviceId: null, serviceName: 'Paraffin Dip', nextStep: 'confirm_with_technician' },
    ]);
    expect(res.recordChecks!.some((r: any) => 'priceCents' in r)).toBe(false);
    expect(res.cards.map((c) => c.targetId)).toEqual([PED]);   // the sale list never carries the record gap
    // while payment is in progress the sales list is frozen, but the record check still shows
    const paying = new AiCheckoutUpsellService({ getTicket: async () => ({ ...tk, status: 'payment_in_progress' }) } as any, addOns as any, none, none, { async state() { return null; } } as any,
      { async options() { return { enabled: false, allowedAmountsCents: [] }; } } as any, { async context() { return null; } } as any,
      undefined, undefined, null, undefined, undefined, undefined, undefined, new KyselyRequestedServices(db));
    const frozen = await paying.recommendations(ctx(), TK1);
    expect(frozen.frozen).toBe(true);
    expect(frozen.cards).toEqual([]);
    expect(frozen.recordChecks).toHaveLength(2);
  });

  it('pure rule: matches by id, then by name; an unreadable source is unknown, not "nothing missing"', async () => {
    expect(detectRecordChecks([{ serviceId: GEL, name: 'Gel' }, { serviceId: null, name: ' gel  manicure ' }], { serviceIds: [GEL], serviceNames: ['Gel Manicure'] })).toEqual([]);
    expect(detectRecordChecks([{ serviceId: 'old-id', name: 'Gel Manicure' }], { serviceIds: [GEL], serviceNames: ['Gel Manicure'] })).toEqual([]);
    expect(detectRecordChecks([{ serviceId: ART, name: 'Nail Art' }, { serviceId: ART, name: 'Nail Art' }], { serviceIds: [], serviceNames: [] })).toHaveLength(1);
    expect(requestedList('[{"service_id":"s1","name":"Pedicure"}]')).toEqual([{ serviceId: 's1', name: 'Pedicure' }]);
    const broken = new AiCheckoutUpsellService({ getTicket: async () => ({ checkoutId: TK1, branchId: B, customerId: null, status: 'serving', serviceLines: [], cartAddOnIds: [], subtotalCents: 0 }) } as any,
      { getAddOns: async () => [] } as any, { async candidates() { return []; } } as any, { async candidates() { return []; } } as any, { async state() { return null; } } as any,
      { async options() { return { enabled: false, allowedAmountsCents: [] }; } } as any, { async context() { return null; } } as any,
      undefined, undefined, null, undefined, undefined, undefined, undefined, { requested: async () => { throw new Error('boom'); } });
    expect((await broken.recommendations(ctx(), TK1)).recordChecks).toBeUndefined();
  });
});

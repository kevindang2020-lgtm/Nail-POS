// ai-upsell-loyalty-redeem.pgtest — Checkout Upsell Assistant Settings 05 ("Loyalty redemption: use authoritative current
// points, tenant-funded tokens, exclusions and approved redemption transaction") on the REAL migrated schema.
// The upsell's loyalty card reads the loyalty module's redeem picker (balance + tier from the loyalty profile; each
// reward's exclusions from the same redeemBlock() the redemption enforces); a confirmed redeem goes through the loyalty
// module's ONE redemption transaction and then the checkout's reward-code path; a ticket that refuses the code gets the
// points back through the loyalty void. Retries never take points twice.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { LoyaltyProgramRepository, applyLoyaltyEntry } from '@aipowersalon/customers';
import { AiCheckoutUpsellService, type MutationDeps } from './ai-checkout-upsell.service';
import { InMemoryIdempotencyStore } from './ai-checkout-upsell.idempotency';
import { LoyaltyProgramRecoAdapter, LoyaltyProgramMutationAdapter, redemptionIdFor } from './ai-checkout-upsell.adapters';

const id = (n: number) => `51510000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), T2 = id(2), B = id(3), B2 = id(4), U = id(5);
const ANN = id(10), BEA = id(11), NEW = id(12), XC = id(13);
const R5 = id(20), R10P = id(21), RGOLD = id(22), RDEAR = id(23), ROFF = id(24), RX = id(25);
const TK1 = id(30), TK2 = id(31), TK3 = id(32);
let pg: any; let db: any; let repo: LoyaltyProgramRepository;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
const ctx = (o: any = {}): any => ({ tenantId: T, branchId: B, userId: U, role: 'MANAGER', permissions: ['pos.ai_checkout_upsell.view', 'pos.checkout.view', 'pos.loyalty.redeem', 'pos.checkout.redeem_reward'], deviceId: null, ...o });
const ticket = (o: any = {}): any => ({ checkoutId: TK1, branchId: B, customerId: ANN, status: 'serving', serviceLines: [{ serviceId: 'svc', serviceName: 'Gel' }], cartAddOnIds: [], subtotalCents: 6000, ...o });
const balance = async (c: string) => Number((await q(`select points_balance from customer_loyalty_profiles where tenant_id = $1 and customer_id = $2`, [T, c]))[0]?.points_balance ?? 0);

/** a stand-in for CheckoutService.applyRewardCode: reserves the code to the ticket exactly as the checkout repository does
 *  (status applied + ticket_id), or refuses when told to */
function fakeCheckout(refuse = false) {
  const applied: { ticketId: string; code: string }[] = [];
  return { applied, applyRewardCode: async (_c: any, ticketId: string, code: unknown) => {
    if (refuse) throw new Error('TICKET_HAS_REWARD');
    await q(`update loyalty_redemptions set status = 'applied', ticket_id = $1, applied_at = now() where tenant_id = $2 and code = $3`, [ticketId, T, String(code)]);
    applied.push({ ticketId, code: String(code) }); return {} as never;
  } };
}
function service(tk: any, checkout = fakeCheckout()) {
  const mut: MutationDeps = {
    idem: new InMemoryIdempotencyStore(),
    addOn: { addServiceLine: async () => ({ lineId: 'x' }) }, membership: { enroll: async () => ({ membershipId: 'x' }) },
    loyalty: new LoyaltyProgramMutationAdapter(repo, checkout as never),
    promotion: { apply: async () => ({ applied: true as const }) }, booking: { openBooking: async () => ({ bookingDraftId: 'x' }) },
    recalc: { recalculate: async () => ({ totalCents: 0, subtotalCents: 0, taxCents: 0 }) },
  };
  const none: any = { async candidates() { return []; } };
  const svc = new AiCheckoutUpsellService({ getTicket: async () => tk } as any, { getAddOns: async () => [] } as any, none, none,
    new LoyaltyProgramRecoAdapter(repo, db), { async options() { return { enabled: false, allowedAmountsCents: [] }; } } as any, { async context() { return null; } } as any,
    undefined, undefined, null, undefined, mut);
  return { svc, checkout };
}

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  repo = new LoyaltyProgramRepository(db as never, null);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Pilot','ul-05','UL05','active'), ($2,'X','Other','ul-05x','UL05X','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Other','active','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Mgr','m@ul.test','active','MANAGER')`, [U, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$5,$6,'Ann','Le','Ann Le'), ($2,$5,$6,'Bea','Vo','Bea Vo'),
    ($3,$5,$6,'Nu','Ng','Nu Ng'), ($4,$7,$8,'X','Y','X Y')`, [ANN, BEA, NEW, XC, T, B, T2, B2]);
  await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points) values ($1,$2,$3,'Regular',0,0), ($1,$2,$4,'Regular',0,0)`, [T, B, ANN, BEA]);
  await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points) values ($1,$2,$3,'Gold',0,0)`, [T2, B2, XC]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, ticket_number, created_at, updated_at) values
    ($1,$4,$5,$6,'serving',6000,0,0,6000,0,'T-1',now(),now()), ($2,$4,$5,$7,'serving',6000,0,0,6000,0,'T-2',now(),now()), ($3,$4,$5,$6,'serving',6000,0,0,6000,0,'T-3',now(),now())`, [TK1, TK2, TK3, T, B, ANN, BEA]);
  await q(`insert into loyalty_rewards (id, tenant_id, title, points_cost, active, reward_type, value_cents, percent, eligible_tiers) values
    ($1,$7,'$5 off',200,true,'amount_off',500,0,null), ($2,$7,'10% off',300,true,'percent_off',0,10,null), ($3,$7,'Gold $20',100,true,'amount_off',2000,0,'{Gold}'),
    ($4,$7,'$90 off',999999,true,'amount_off',9000,0,null), ($5,$7,'Old $50',10,false,'amount_off',5000,0,null), ($6,$8,'Other salon $40',1,true,'amount_off',4000,0,null)`, [R5, R10P, RGOLD, RDEAR, ROFF, RX, T, T2]);
  // Ann earns 500 points the only way points arrive: one ledger entry
  await db.transaction().execute((trx: any) => applyLoyaltyEntry(trx, { tenantId: T, branchId: B, customerId: ANN, entryType: 'adjust', delta: 500, reason: 'seed', sourceTable: 'tenant_approval_requests', sourceId: id(90), legacyType: 'bonus_approved' }));
  await db.transaction().execute((trx: any) => applyLoyaltyEntry(trx, { tenantId: T2, branchId: B2, customerId: XC, entryType: 'adjust', delta: 9999, reason: 'seed', sourceTable: 'tenant_approval_requests', sourceId: id(91), legacyType: 'bonus_approved' }));
}, 180_000);

describe('Checkout Upsell Assistant Settings 05 — loyalty redemption', () => {
  it('the card uses the authoritative balance, salon-funded rewards only, and every exclusion the redemption enforces', async () => {
    const st = await new LoyaltyProgramRecoAdapter(repo, db).state(ctx(), ticket());
    expect(st.redeem).toMatchObject({ enrolled: true, balancePoints: 500, cartEligible: true });
    const ids = st.redeem.rewards.map((r) => r.rewardId).sort();
    expect(ids).toEqual([R5, R10P].sort());   // not: Gold-only (tier), $90 (points), inactive, another salon's
    expect(st.redeem.rewards.find((r) => r.rewardId === R10P)!.valueCents).toBe(600);   // checkout's own rule: 10% of $60
    const { svc } = service(ticket());
    const rec = await svc.recommendations(ctx(), TK1);
    const card = rec.cards.find((c: any) => c.type === 'loyalty_redemption')!;
    expect(card.targetId).toBe(R10P);   // the best reward Ann can actually afford
    expect(card.reason).toContain('500 points');
  });

  it('confirmed redeem = the loyalty transaction (points off once) + the checkout reward-code path; a retry takes nothing more', async () => {
    const { svc, checkout } = service(ticket());
    const r: any = await svc.redeemLoyalty(ctx(), TK1, R5, { confirm: true, idempotencyKey: 'tap-1' });
    expect(r.redeemed).toBe(true);
    expect(await balance(ANN)).toBe(300);
    const red = (await q(`select id, status, ticket_id, points_spent from loyalty_redemptions where tenant_id = $1 and customer_id = $2`, [T, ANN]));
    expect(red).toHaveLength(1);
    expect(red[0]).toMatchObject({ status: 'applied', ticket_id: TK1, points_spent: 200 });
    expect(checkout.applied).toHaveLength(1);
    await svc.redeemLoyalty(ctx(), TK1, R5, { confirm: true, idempotencyKey: 'tap-1' });   // double tap
    expect(await balance(ANN)).toBe(300);
    // the same request key reaching a fresh process also lands on the same redemption (the redemption id is derived from it)
    const { svc: again } = service(ticket());
    await again.redeemLoyalty(ctx(), TK1, R5, { confirm: true, idempotencyKey: 'tap-1' });
    expect(await balance(ANN)).toBe(300);
    expect((await q(`select count(*)::int n from loyalty_redemptions where tenant_id = $1 and customer_id = $2`, [T, ANN]))[0].n).toBe(1);
    // one reward per ticket: that ticket now gets no loyalty card
    expect((await new LoyaltyProgramRecoAdapter(repo, db).state(ctx(), ticket())).redeem.cartEligible).toBe(false);
  });

  it('a ticket that refuses the code gives the points back through the loyalty void (history kept, never deleted)', async () => {
    const { svc } = service(ticket({ checkoutId: TK3 }), fakeCheckout(true));
    await expect(svc.redeemLoyalty(ctx(), TK3, R5, { confirm: true, idempotencyKey: 'tap-2' })).rejects.toThrow('TICKET_HAS_REWARD');
    expect(await balance(ANN)).toBe(300);
    const v = (await q(`select status from loyalty_redemptions where tenant_id = $1 and customer_id = $2 and status = 'void'`, [T, ANN]));
    expect(v).toHaveLength(1);
    expect((await q(`select count(*)::int n from loyalty_ledger where tenant_id = $1 and customer_id = $2 and source_table = 'loyalty_redemption_voids'`, [T, ANN]))[0].n).toBe(1);
  });

  it('refuses what the authoritative state refuses; never another salon, never a customer without the program', async () => {
    const { svc } = service(ticket({ checkoutId: TK2, customerId: BEA }));
    await expect(svc.redeemLoyalty(ctx(), TK2, R5, { confirm: true, idempotencyKey: 'b1' })).rejects.toThrow('LOYALTY_NOT_ELIGIBLE');   // Bea has 0 points → no unblocked reward
    await expect(svc.redeemLoyalty(ctx(), TK2, RGOLD, { confirm: true, idempotencyKey: 'b2' })).rejects.toThrow('LOYALTY_NOT_ELIGIBLE');   // tier excluded
    expect((await new LoyaltyProgramRecoAdapter(repo, db).state(ctx(), ticket({ customerId: NEW }))).redeem.enrolled).toBe(false);
    const other = await new LoyaltyProgramRecoAdapter(repo, db).state(ctx({ tenantId: T2, branchId: B2 }), ticket({ customerId: ANN }));
    expect(other.redeem).toMatchObject({ enrolled: false, balancePoints: 0 });
    expect(other.redeem.rewards).toEqual([]);
    expect(redemptionIdFor('k')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(redemptionIdFor('k')).toBe(redemptionIdFor('k'));
    expect(redemptionIdFor('k')).not.toBe(redemptionIdFor('k2'));
  });
});

describe('Checkout Upsell Assistant Settings 05 — a race the card could not see', () => {
  it('stock taken between the card and the tap: the loyalty transaction refuses, mapped to the upsell taxonomy; no points move', async () => {
    const RLAST = id(26);
    await q(`insert into loyalty_rewards (id, tenant_id, title, points_cost, active, reward_type, value_cents, stock_total) values ($1,$2,'Last one',10,true,'amount_off',100,1)`, [RLAST, T]);
    const tk = ticket({ checkoutId: TK2, customerId: ANN });
    // the card's read happens first (reward available), then someone else takes the last unit
    const reco = new LoyaltyProgramRecoAdapter(repo, db);
    const stale = await reco.state(ctx(), tk);
    expect(stale.redeem.rewards.some((r) => r.rewardId === RLAST)).toBe(true);
    await q(`insert into loyalty_redemptions (id, tenant_id, customer_id, reward_id, reward_title, points_spent, code, status, reward_type, value_cents, percent) values ($1,$2,$3,$4,'Last one',10,'RDMOTHER1','issued','amount_off',100,0)`, [id(27), T, BEA, RLAST]);
    const mut = new LoyaltyProgramMutationAdapter(repo, fakeCheckout() as never);
    const before = await balance(ANN);
    await expect(mut.redeem(ctx(), { customerId: ANN, rewardId: RLAST, checkoutId: TK2, requestKey: 'race-1' })).rejects.toThrow('LOYALTY_NOT_ELIGIBLE');
    expect(await balance(ANN)).toBe(before);
  });
});

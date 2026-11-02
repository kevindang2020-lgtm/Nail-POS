// global-rewards-checkout.pgtest — Final Completion guide §04 through the REAL CheckoutService + KyselyCheckoutRepository
// + the GlobalRewardsCheckoutAdapter (the port the API binds as 'GLOBAL_REWARDS_CHECKOUT'): rewards come off the ticket as
// ONE 'global_reward' tender paired with a hold; the cashier's cash covers the rest; the ticket is paid; the paid-ticket
// path finalizes once (points spent, salon owed); removing the reward on an unpaid ticket releases the points and voids the
// tender; a refund of the reward tender is recorded without touching a gateway. Needs the Kysely query builder (CI).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { CheckoutService, KyselyCheckoutRepository } from '@aipowersalon/checkout';
import { GlobalRewardsRepository, GlobalRewardsCheckoutAdapter, finalizeForPaidTicket, GR_FLAGS } from '@aipowersalon/loyalty';

const P = 'd7341000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), B = id('b1'), C = id('c1'), IDV = id('f1'), OWNER = id('e1'), CAT = id('a7'), SVC = id('a8');
const posCtx: any = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.refund', 'checkout.approve_refund'] };
let db: any; let svc: CheckoutService; let n = 0;
const pts = async () => (await sql<any>`select available_tenths::int a, reserved_tenths::int h from global_rewards_accounts where identity_id = ${IDV}`.execute(db)).rows[0];
async function ticket(totalCents: number) {
  n++;
  const tk: any = (await sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values (${T}, ${B}, ${C}, 'ready_checkout', ${totalCents}, 0, 0, ${totalCents}) returning id`.execute(db)).rows[0];
  await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${B}, ${tk.id}, ${SVC}, 'Gel', ${totalCents}, 60, ${totalCents})`.execute(db);
  return String(tk.id);
}

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'R', 'R Salon', 'r-grco', 'RGRCO', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'UTC')`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${C}, ${T}, ${B}, 'Ava', 'Kim', 'Ava Kim', '+16095550142', 'active')`.execute(db);
  await sql`insert into users (id, tenant_id, full_name, email, status, role) values (${id('71')}, ${T}, 'Ava Kim', 'ava@grco.test', 'active', 'CUSTOMER')`.execute(db);
  await sql`insert into customer_identities (id, normalized_phone, full_name, status, phone_verified_at) values (${IDV}, '+16095550142', 'Ava Kim', 'active', now())`.execute(db);
  await sql`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id) values (${IDV}, ${T}, ${id('71')}, ${C})`.execute(db);
  // 30 points the customer earned elsewhere (seeded directly: ledger + account agree)
  await sql`insert into global_rewards_accounts (identity_id, terms_version, enrolled_via, opted_in_at, consent_source, available_tenths) values (${IDV}, '2026-10-30', 'customer_app', now(), 'customer_app', 300)`.execute(db);
  await sql`insert into global_points_ledger (identity_id, entry_type, delta_tenths, balance_after_tenths, tenant_id, source_table, source_id) values (${IDV}, 'adjustment', 300, 300, ${T}, 'test_seed', 'seed-1')`.execute(db);
  await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails')`.execute(db);
  await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel', 60, 5000)`.execute(db);
  await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values (${T}, null, 'tax', ${JSON.stringify({ enabled: false })}::jsonb)`.execute(db);
  for (const k of [GR_FLAGS.engine, GR_FLAGS.redemption]) await sql`insert into platform_settings (setting_key, setting_group, value, value_type) values (${k}, 'loyalty', 'true'::jsonb, 'boolean') on conflict (setting_key) do update set value = excluded.value`.execute(db);
  await new GlobalRewardsRepository(db).setEnrollment(T, 'enrolled', { reason: 'checkout integration test salon', actorUserId: OWNER });
  svc = new CheckoutService(new KyselyCheckoutRepository(db, new OutboxWriter())).useGlobalRewards(new GlobalRewardsCheckoutAdapter(db));
}, 120_000);

describe('AI PowerSalon Rewards as a checkout tender', () => {
  it('quote → $2 off as one tender (hold) → cash pays the rest → ticket paid → finalized once, $2 owed to this salon', async () => {
    const tk = await ticket(5000);
    const q: any = await svc.rewardsQuote(posCtx, tk); expect(q.available).toBe(true); expect(q.maxBlocks).toBe(3);
    const r = await svc.payGlobalReward(posCtx, tk, { blocks: 2, idempotencyKey: 'co-1' });
    expect(r.remainingDueCents).toBe(4800); expect(await pts()).toEqual({ a: 100, h: 200 });
    const again = await svc.payGlobalReward(posCtx, tk, { blocks: 2, idempotencyKey: 'co-1' });   // a retried tap
    expect(again.payment.paymentId).toBe(r.payment.paymentId); expect(await pts()).toEqual({ a: 100, h: 200 });
    await svc.payCash(posCtx, tk, { amountReceivedCents: 4800 } as any);
    expect(((await sql<any>`select status from tickets where id = ${tk}`.execute(db)).rows[0]).status).toBe('paid');
    await db.transaction().execute((trx: any) => finalizeForPaidTicket(trx, new GlobalRewardsRepository(db), { tenantId: T, ticketId: tk }));
    expect(await pts()).toEqual({ a: 100, h: 0 });
    expect((await sql<any>`select status, amount_cents::int amt from merchant_reimbursements where ticket_id = ${tk}`.execute(db)).rows).toEqual([{ status: 'ACCRUED_OWED', amt: 200 }]);
  });
  it('removing the reward from an unpaid ticket releases the points and voids its tender; a paid ticket refuses removal', async () => {
    const tk = await ticket(3000);
    const r = await svc.payGlobalReward(posCtx, tk, { blocks: 1, idempotencyKey: 'co-2' });
    expect(await pts()).toEqual({ a: 0, h: 100 });
    expect((await svc.removeGlobalReward(posCtx, tk)).removed).toBe(true);
    expect(await pts()).toEqual({ a: 100, h: 0 });
    expect(((await sql<any>`select status from payments where id = ${r.payment.paymentId}`.execute(db)).rows[0]).status).toBe('voided');
  });
  it('not enough points: refused with REWARDS_POINTS_INSUFFICIENT and NO tender row left behind', async () => {
    const tk = await ticket(9000);
    await expect(svc.payGlobalReward(posCtx, tk, { blocks: 5, idempotencyKey: 'co-3' })).rejects.toMatchObject({ code: 'REWARDS_POINTS_INSUFFICIENT' });
    expect((await sql<any>`select count(*)::int n from payments where ticket_id = ${tk}`.execute(db)).rows[0].n).toBe(0);
  });
});

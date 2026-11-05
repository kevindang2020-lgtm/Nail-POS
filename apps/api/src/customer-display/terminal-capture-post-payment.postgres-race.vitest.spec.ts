// terminal-capture-post-payment.postgres-race — Phase 15 round 3, on real Postgres (a pool, so the runs really interleave):
// the POS post-payment work for a terminal-paid ticket (CheckoutService.runPostPaymentWork = afterPaid) run SIX times at
// once — a retried approval, a reconcile, a manual "book" — activates the gift card once, redeems the deal once, writes the
// compensation snapshot once and books the membership commission once. The last one had no concurrency guard (it read
// "nothing booked yet" and appended): it is now appended under a per-ticket lock, one row per service line.
// Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { CheckoutService, KyselyCheckoutRepository, InMemoryTerminalLeases } from '@aipowersalon/checkout';
import { DealsCheckoutService, KyselyDealsLedger } from '@aipowersalon/deals';
import { CompensationService, KyselyCompensationPorts } from '@aipowersalon/workforce';
import { MembershipCompService, KyselyMembershipCompRepository } from '@aipowersalon/memberships';
import { TerminalCaptureService } from './terminal-capture.service';

const url = process.env.PG_RACE_URL;
const T = 'a7500000-0000-4000-8000-0000000000a1', B = 'b7500000-0000-4000-8000-0000000000a1', C = 'c7500000-0000-4000-8000-0000000000a1';
const TERM = 'd7500000-0000-4000-8000-0000000000a1', CAT = 'e7500000-0000-4000-8000-0000000000a1', SVC = 'e7500000-0000-4000-8000-0000000000a2';
const TECH = 'f7500000-0000-4000-8000-0000000000a1', DEAL = '97500000-0000-4000-8000-0000000000a1';
let db: Kysely<any>; let pool: pg.Pool;
const one = async (q: any) => (await q.execute(db)).rows[0] as any;
const count = async (q: any) => Number((await one(q)).n);
const cleanup = async () => {
  for (const t of ['outbox_events', 'checkout_locks', 'payments', 'ticket_service_lines', 'customer_display_sessions', 'ticket_compensation_snapshots', 'ticket_tip_allocations', 'compensation_adjustments', 'membership_redemptions', 'deal_redemptions', 'gift_card_transactions', 'gift_cards'])
    await sql`DELETE FROM ${sql.table(t)} WHERE tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`DELETE FROM tickets WHERE tenant_id = ${T}`.execute(db).catch(() => undefined);
};

describe.skipIf(!url)('terminal-paid post-payment work, run concurrently on real Postgres', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 10 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'TH', 'TH', 'th-salon', 'THSL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C}, ${T}, ${B}, 'Ana', 'Lee', 'Ana Lee') on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Kim', 'Tran', 'Kim Tran') on conflict (id) do nothing`.execute(db);
    await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails') on conflict (id) do nothing`.execute(db);
    await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 45, 5000) on conflict (id) do nothing`.execute(db);
    await sql`insert into deals (id, tenant_id, owner_type, title, discount_type, discount_percent, status) values (${DEAL}, ${T}, 'salon', 'Ten off', 'percent', 10, 'active') on conflict (id) do nothing`.execute(db);
    await sql`delete from tenant_settings where tenant_id = ${T}`.execute(db);
    await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values (${T}, null, 'payments-checkout', ${JSON.stringify({ customerDisplayCaptureMode: 'terminal' })}::jsonb)`.execute(db);
    await sql`delete from pos_payment_terminals where tenant_id = ${T}`.execute(db);
    await sql`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn) values (${TERM}, ${T}, ${B}, 'Front', 'paired', 'HSNH1')`.execute(db);
    await sql`delete from tenant_payment_config where tenant_id = ${T}`.execute(db);
    await sql`insert into tenant_payment_config (tenant_id, merchant_id, bolt_base_url, bolt_api_key_enc) values (${T}, 'M1', 'https://bolt.test', 'enc')`.execute(db);
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
    for (const t of ['tenant_payment_config', 'pos_payment_terminals', 'tenant_settings', 'deals', 'services', 'service_categories', 'technicians', 'customers', 'branches'])
      await sql`DELETE FROM ${sql.table(t)} WHERE tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`DELETE FROM tenants WHERE id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('six post-payment runs at once on one terminal-paid ticket double nothing', async () => {
    const outbox = new OutboxWriter(); const logged: string[] = [];
    const tk: any = await one(sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values (${T}, ${B}, ${C}, 'open', 5000, 0, 0, 5000) returning id`);
    const line: any = await one(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot)
              values (${T}, ${B}, ${tk.id}, ${SVC}, ${TECH}, 'Gel Manicure', 5000, 45, 5000, 'percent', 40) returning id`);
    await sql`insert into gift_cards (tenant_id, code, status, purchased_cents, initial_balance_cents, balance_cents, sale_ticket_id) values (${T}, 'GC-RACE-H1', 'pending_payment', 2500, 2500, 0, ${tk.id})`.execute(db);
    await sql`insert into deal_redemptions (deal_id, tenant_id, customer_id, ticket_id, amount_discounted_cents, deal_version, status) values (${DEAL}, ${T}, ${C}, ${tk.id}, 500, 1, 'applied')`.execute(db);
    await sql`insert into membership_redemptions (tenant_id, customer_membership_id, ticket_id, service_line_id, technician_id, commission_basis_snapshot)
              values (${T}, gen_random_uuid(), ${tk.id}, ${line.id}, ${TECH}, ${JSON.stringify({ techCents: 1800, ownerCents: 1200, eligibleCents: 3000, basis: 'allocated' })})`.execute(db);
    const s: any = await one(sql`insert into customer_display_sessions (tenant_id, branch_id, public_token_hash, ticket_id) values (${T}, ${B}, ${'h1h' + Date.now()}, ${tk.id}) returning id`);
    const row: any = { id: String(s.id), tenantId: T, branchId: B, ticketId: String(tk.id), paymentMethod: 'card', selectedTipCents: 0 };
    // record the approval WITHOUT post-payment work, then race six runs of it
    const bare = new TerminalCaptureService(db as any, () => ({ authCard: async () => ({ approved: true, retref: 'RR-H1', respstat: 'A' }) } as any), (x) => x, undefined, new InMemoryTerminalLeases(), undefined, outbox, { error: (m: string) => { logged.push(m); } });
    expect(await bare.capture(row)).toMatchObject({ outcome: 'approved' });
    const before = Number((await one(sql`select redemption_count from deals where id = ${DEAL}`)).redemption_count);
    const checkout = () => new CheckoutService(new KyselyCheckoutRepository(db as any, outbox), undefined, undefined, undefined, undefined, undefined,
      new CompensationService(new KyselyCompensationPorts(db as any)), new MembershipCompService(new KyselyMembershipCompRepository(db as any)))
      .useDeals(new DealsCheckoutService({} as any, new KyselyDealsLedger(db as any, outbox))).useMoneyPathLog({ error: (m: string) => { logged.push(m); } });
    const runs = await Promise.all(Array.from({ length: 6 }, () => checkout().runPostPaymentWork({ tenantId: T, branchId: B }, String(tk.id))));
    expect(runs.every((r) => r.ran)).toBe(true);
    expect(await one(sql`select status, balance_cents from gift_cards where sale_ticket_id = ${tk.id}`)).toEqual({ status: 'active', balance_cents: 2500 });
    expect(await count(sql`select count(*) as n from gift_card_transactions where tenant_id = ${T} and type = 'activate'`)).toBe(1);
    expect(await count(sql`select count(*) as n from outbox_events where tenant_id = ${T} and event_type = 'gift_card.issued'`)).toBe(1);
    expect((await one(sql`select status from deal_redemptions where ticket_id = ${tk.id}`)).status).toBe('redeemed');
    expect(Number((await one(sql`select redemption_count from deals where id = ${DEAL}`)).redemption_count)).toBe(before + 1);
    expect(await count(sql`select count(*) as n from outbox_events where tenant_id = ${T} and event_type = 'deal.redeemed'`)).toBe(1);
    expect(await count(sql`select count(*) as n from ticket_compensation_snapshots where ticket_id = ${tk.id}`)).toBe(1);
    expect(await count(sql`select count(*) as n from compensation_adjustments where ticket_id = ${tk.id} and reason like 'Membership service commission%'`)).toBe(1);
    expect(Number((await one(sql`select amount_cents from compensation_adjustments where ticket_id = ${tk.id}`)).amount_cents)).toBe(1800);
  });

  it('two membership-commission bookings at once append the line once', async () => {
    const tk: any = await one(sql`insert into tickets (tenant_id, branch_id, customer_id, status) values (${T}, ${B}, ${C}, 'paid') returning id`);
    const lineId = '17500000-0000-4000-8000-0000000000a9';
    const ctx: any = { tenantId: T, branchId: B, userId: null, role: 'OWNER', permissions: [] };
    const entry = { technicianId: TECH, serviceLineId: lineId, amountCents: 900, reason: 'Membership service commission · allocated basis', redemptionId: 'r1' };
    const written = await Promise.all(Array.from({ length: 4 }, () => new KyselyMembershipCompRepository(db as any).appendAdjustments(ctx, String(tk.id), [entry])));
    expect(written.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await count(sql`select count(*) as n from compensation_adjustments where ticket_id = ${tk.id}`)).toBe(1);
  });
});

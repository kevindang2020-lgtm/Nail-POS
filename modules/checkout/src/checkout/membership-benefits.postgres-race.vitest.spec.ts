// membership-benefits.postgres-race.vitest.spec.ts — Decision 15 membership step on real Postgres: the redemption read
// carries the benefit type + the value the balance paid; end to end the ticket gets $25 off the gel (dollar credit) and
// 10% off the pedicure only (not retail); paused / past-due / cancelled memberships give nothing, grace keeps it.
// Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { membershipDiscountRequests } from './membership-benefits';

const url = process.env.PG_RACE_URL;
const T = 'a1500000-0000-4000-8000-0000000000a1', B = 'b1500000-0000-4000-8000-0000000000b1', C = 'c1500000-0000-4000-8000-0000000000c1';
const TK = 'd1500000-0000-4000-8000-0000000000d1', PL = 'e1500000-0000-4000-8000-0000000000e1', PV = 'f1500000-0000-4000-8000-0000000000f1';
const CM = 'a1500000-0000-4000-8000-0000000000c2', BCR = 'a1500000-0000-4000-8000-0000000000b2', BPC = 'a1500000-0000-4000-8000-0000000000b3';
const LG = 'a1500000-0000-4000-8000-0000000000e2', LP = 'a1500000-0000-4000-8000-0000000000e3', LO = 'a1500000-0000-4000-8000-0000000000e4';
const ctx = { tenantId: T, branchId: B, userId: 'u', role: 'MANAGER', permissions: [] } as any;
let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyCheckoutRepository;

describe.skipIf(!url)('membership benefits on real Postgres (Decision 15)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyCheckoutRepository(db as any);
    for (const t of ['membership_redemptions', 'customer_memberships', 'membership_benefits', 'ticket_service_lines', 'tickets']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'D15', 'D15', 'd15-salon', 'D15S', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C}, ${T}, ${B}, 'Mae', 'Lin', 'Mae Lin') on conflict (id) do nothing`.execute(db);
    await sql`insert into membership_plans (id, tenant_id, name) values (${PL}, ${T}, 'VIP') on conflict (id) do nothing`.execute(db);
    await sql`insert into membership_plan_versions (id, tenant_id, plan_id, version_number) values (${PV}, ${T}, ${PL}, 1) on conflict (id) do nothing`.execute(db);
    await sql`insert into membership_benefits (id, tenant_id, plan_version_id, benefit_type, label, value_cents, percent, category_snapshot) values
      (${BCR}, ${T}, ${PV}, 'dollar_credit', '$25 credit', 2500, 0, null), (${BPC}, ${T}, ${PV}, 'percent_discount', '10% pedicures', 0, 10, 'Pedicure')`.execute(db);
    await sql`insert into customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status) values (${CM}, ${T}, ${B}, ${C}, ${PL}, ${PV}, 'active')`.execute(db);
    await sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values (${TK}, ${T}, ${B}, ${C}, 'open', 12500, 0, 0, 12500)`.execute(db);
    await sql`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_name_snapshot, price_cents_snapshot, line_total_cents, duration_minutes_snapshot, category_snapshot, service_id, product_id, line_kind) values
      (${LG}, ${T}, ${B}, ${TK}, 'Gel', 6000, 6000, 45, 'Nails', ${PL}, null, 'service'),
      (${LP}, ${T}, ${B}, ${TK}, 'Pedicure', 5000, 5000, 45, 'Pedicure', ${PV}, null, 'service'),
      (${LO}, ${T}, ${B}, ${TK}, 'Cuticle oil', 1500, 1500, 0, 'Pedicure', null, ${C}, 'retail')`.execute(db);
    await sql`insert into membership_redemptions (tenant_id, branch_id, customer_membership_id, ticket_id, service_line_id, benefit_id, standard_value_cents, allocated_value_cents, upgrade_charge_cents) values
      (${T}, ${B}, ${CM}, ${TK}, ${LG}, ${BCR}, 6000, 2500, 0)`.execute(db);
  });
  afterAll(async () => { for (const t of ['membership_redemptions', 'customer_memberships', 'membership_benefits', 'ticket_service_lines', 'tickets']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('the redemption read carries the benefit type and what the balance paid', async () => {
    expect(await repo.membershipRedemptionsForTicket(ctx, TK)).toEqual([expect.objectContaining({ serviceLineId: LG, benefitType: 'dollar_credit', allocatedValueCents: 2500, standardValueCents: 6000 })]);
  });

  it('end to end: $25 off the gel (credit), 10% off the pedicure only — nothing off retail', async () => {
    const inputs = await repo.memberDiscountInputs(ctx, TK);
    expect(inputs.lines.find((l) => l.serviceLineId === LO)!.isRetail).toBe(true);
    const r = membershipDiscountRequests(inputs.lines, await repo.membershipRedemptionsForTicket(ctx, TK), inputs.benefits);
    expect(r.map((d) => [d.id, d.amountCents])).toEqual([[expect.stringMatching(/^membership-/), 2500], ['membership-benefit-' + BPC, 500]]);
  });

  it('paused, past-due or cancelled memberships give no member discount; grace still does', async () => {
    for (const [status, n] of [['paused', 0], ['past_due', 0], ['canceled', 0], ['grace', 1], ['active', 1]] as const) {
      await sql`update customer_memberships set status = ${status} where id = ${CM}`.execute(db);
      expect([status, (await repo.memberDiscountInputs(ctx, TK)).benefits.length]).toEqual([status, n]);
    }
  });
});

// membership-benefit.postgres-race.vitest.spec.ts — D6 Membership guide (Nov 3 2026): two tablets redeem / reserve the
// member's LAST service credit at the same moment on real PostgreSQL (PGlite is one connection and cannot overlap two
// transactions). Before the per-membership lock both passed the balance check and the credit was spent twice.
// Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { MembershipEnrollService } from './membership-enroll.service';
import { KyselyMembershipEnrollRepository } from './membership-enroll.kysely.repository';

const url = process.env.PG_RACE_URL;
const T = randomUUID(), B = randomUUID(), C = randomUUID(), P = randomUUID(), V = randomUUID(), BEN = randomUUID(), M = randomUUID(), TK = randomUUID();
const ctx: any = { tenantId: T, branchId: B, userId: '', role: 'MANAGER', permissions: ['pos.memberships.redeem', 'pos.memberships.view', 'pos.memberships.manage'] };

describe.skipIf(!url)('membership benefit on real Postgres', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 3 }) }) });
  const dbs = url ? [mk(), mk()] : [];
  const svcs = dbs.map((d) => new MembershipEnrollService(new KyselyMembershipEnrollRepository(d as any)));
  const q = (s: any) => s.execute(dbs[0]);
  const available = async () => (await svcs[0].getMembershipBenefits(ctx, M)).benefits[0].serviceCreditsAvailable;
  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'MB', 'MB', ${'mb-' + T.slice(0, 8)}, ${'MB' + T.slice(0, 6)}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C}, ${T}, ${B}, 'A', 'B', 'A B')`);
    await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id) values (${TK}, ${T}, ${B}, ${C})`);
    await q(sql`insert into membership_plans (id, tenant_id, name, status) values (${P}, ${T}, 'Gold', 'active')`);
    await q(sql`insert into membership_plan_versions (id, plan_id, tenant_id, version_number) values (${V}, ${P}, ${T}, 1)`);
    await q(sql`insert into membership_benefits (id, plan_version_id, tenant_id, benefit_type, label, credits_per_cycle) values (${BEN}, ${V}, ${T}, 'service_credit', 'Pedicure', 1)`);
    await q(sql`insert into customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, member_number) values (${M}, ${T}, ${B}, ${C}, ${P}, ${V}, 'active', ${'M-' + T.slice(0, 6)})`);
    await q(sql`insert into membership_credit_ledger (tenant_id, customer_membership_id, benefit_id, entry_type, quantity, amount_cents, reason) values (${T}, ${M}, ${BEN}, 'issued', 1, 0, 'enrollment')`);
  });
  afterAll(async () => { for (const d of dbs) await d.destroy(); });

  it('two redeems of the last credit at once: exactly one succeeds, the other is refused, balance is 0 (never -1)', async () => {
    expect(await available()).toBe(1);
    const res = await Promise.allSettled([svcs[0].redeemBenefit(ctx, { membershipId: M, benefitId: BEN, ticketId: TK }), svcs[1].redeemBenefit(ctx, { membershipId: M, benefitId: BEN, ticketId: TK })]);
    expect(res.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect((res.find((r) => r.status === 'rejected') as any).reason.apiCode).toBe('MEMBERSHIP_CREDITS_INSUFFICIENT');
    expect(await available()).toBe(0);
  });

  it('two reserves of one new credit at once: exactly one hold', async () => {
    await q(sql`insert into membership_credit_ledger (tenant_id, customer_membership_id, benefit_id, entry_type, quantity, amount_cents, reason) values (${T}, ${M}, ${BEN}, 'issued', 1, 0, 'test')`);
    const res = await Promise.allSettled([svcs[0].reserveBenefit(ctx, { membershipId: M, benefitId: BEN, ticketId: TK }), svcs[1].reserveBenefit(ctx, { membershipId: M, benefitId: BEN, ticketId: TK })]);
    expect(res.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(await available()).toBe(0);
  });

  it('release racing the redeem of the same reservation: it is closed once (the credit does not come back)', async () => {
    await q(sql`insert into membership_credit_ledger (tenant_id, customer_membership_id, benefit_id, entry_type, quantity, amount_cents, reason) values (${T}, ${M}, ${BEN}, 'issued', 1, 0, 'test')`);
    const { reservationRef } = await svcs[0].reserveBenefit(ctx, { membershipId: M, benefitId: BEN, ticketId: TK });
    const res = await Promise.allSettled([svcs[0].redeemBenefit(ctx, { membershipId: M, benefitId: BEN, reservationRef, ticketId: TK }), svcs[1].releaseBenefit(ctx, reservationRef)]);
    expect(res.every((r) => r.status === 'fulfilled' || ['RESERVATION_CLOSED', 'RESERVATION_NOT_FOUND'].includes((r as any).reason?.apiCode))).toBe(true);
    const closes = Number((await q(sql`select count(*)::int n from membership_credit_ledger where reservation_ref = ${reservationRef} and entry_type in ('released', 'redeemed')`)).rows[0].n);
    expect(closes).toBe(1);
  });
});

// membership-cycle-credits.pgtest — D6 Membership guide (Nov 3 2026): a successful renewal never issued the new cycle's
// credits (a member paid every month and kept only the first month's). Pins the SQL: one 'issued' row per crediting
// benefit (service / add-on → quantity, dollar → amount, discounts → nothing), at most once per cycle.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyMembershipBillingRepository } from './membership-billing.kysely.repository';

const T = '7e000000-0000-4000-8000-000000000001', B = '7e000000-0000-4000-8000-0000000000b1', C = '7e000000-0000-4000-8000-0000000000d1';
const P = '7e000000-0000-4000-8000-0000000000e1', V = '7e000000-0000-4000-8000-0000000000f1', M = '7e000000-0000-4000-8000-0000000000a1';
let repo: KyselyMembershipBillingRepository; let pg: any;
beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','X','X','memcyc','MEMCYC1','active');
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','One');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C}','${T}','${B}','A','B','A B');
    INSERT INTO membership_plans (id, tenant_id, name, status) VALUES ('${P}','${T}','Gold','active');
    INSERT INTO membership_plan_versions (id, plan_id, tenant_id, version_number) VALUES ('${V}','${P}','${T}',1);
    INSERT INTO membership_benefits (plan_version_id, tenant_id, benefit_type, label, credits_per_cycle, value_cents, percent) VALUES
      ('${V}','${T}','service_credit','Pedicure',2,0,0), ('${V}','${T}','dollar_credit','$25',0,2500,0), ('${V}','${T}','percent_discount','10% off',0,0,10);
    INSERT INTO customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, member_number) VALUES ('${M}','${T}','${B}','${C}','${P}','${V}','active','M-CYC1');`);
  repo = new KyselyMembershipBillingRepository(kyselyFor(pg));
}, 120_000);

describe('renewal issues the cycle credits', () => {
  it('one row per crediting benefit, once per cycle', async () => {
    expect(await repo.issueCycleCredits(T, M, V, '2026-12-01T00:00:00.000Z')).toBe(2);
    expect(await repo.issueCycleCredits(T, M, V, '2026-12-01T00:00:00.000Z')).toBe(0);   // replay
    expect(await repo.issueCycleCredits(T, M, V, '2027-01-01T00:00:00.000Z')).toBe(2);   // next cycle
    const rows = (await pg.query(`SELECT quantity, amount_cents::int AS a FROM membership_credit_ledger WHERE customer_membership_id = '${M}' AND reason = 'renewal:2026-12-01T00:00:00.000Z' ORDER BY quantity`)).rows;
    expect(rows).toEqual([{ quantity: 0, a: 2500 }, { quantity: 2, a: 0 }]);
  });
});

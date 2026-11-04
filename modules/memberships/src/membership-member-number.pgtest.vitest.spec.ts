// membership-member-number.pgtest — D6 Membership guide (Nov 3 2026): the member number was the first 6 characters of the
// customer id, so the same customer enrolled twice got the same number. Numbers are now random, checked under a per-salon
// lock, and unique per salon (migration 785).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyMembershipEnrollRepository } from './membership-enroll.kysely.repository';

const T = '7d000000-0000-4000-8000-000000000001', T2 = '7d000000-0000-4000-8000-000000000002', B = '7d000000-0000-4000-8000-0000000000b1';
const C = '7d000000-0000-4000-8000-0000000000d1', P = '7d000000-0000-4000-8000-0000000000e1', P2 = '7d000000-0000-4000-8000-0000000000e2';
const V = '7d000000-0000-4000-8000-0000000000f1', V2 = '7d000000-0000-4000-8000-0000000000f2';
const ctx = (tenantId = T) => ({ tenantId, branchId: B, userId: '', role: 'MANAGER', permissions: [] });
const args = (planId: string, memberNumber: string) => ({ customerId: C, planId, planVersionId: planId === P ? V : V2, status: 'pending', assignedTechnicianId: null, memberNumber,
  startedAt: new Date(), currentPeriodStart: new Date(), currentPeriodEnd: null, nextBillingAt: null, termEndAt: null, autoRenew: false, autoRenewConsentAt: null, agreementVersion: null, enrolledChannel: 'pos' });
let repo: KyselyMembershipEnrollRepository; let pg: any;
beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','X','X','memnum','MEMNUM1','active'), ('${T2}','Y','Y','memnum2','MEMNUM2','active');
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','One');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C}','${T}','${B}','A','B','A B');
    INSERT INTO membership_plans (id, tenant_id, name, status) VALUES ('${P}','${T}','Gold','active'), ('${P2}','${T}','Silver','active');
    INSERT INTO membership_plan_versions (id, plan_id, tenant_id, version_number) VALUES ('${V}','${P}','${T}',1), ('${V2}','${P2}','${T}',1);`);
  repo = new KyselyMembershipEnrollRepository(kyselyFor(pg));
}, 120_000);

describe('member numbers are unique per salon', () => {
  it('a number already used in this salon is drawn again; the stored number is the one returned', async () => {
    const a = await repo.insertMembership(ctx() as any, args(P, 'M-SAME0001') as any);
    const b = await repo.insertMembership(ctx() as any, args(P2, 'M-SAME0001') as any);
    expect(a.memberNumber).toBe('M-SAME0001');
    expect(b.memberNumber).not.toBe('M-SAME0001');
    expect(b.memberNumber).toMatch(/^M-[A-Z0-9]+$/);
    const rows = (await pg.query(`SELECT member_number FROM customer_memberships WHERE id = '${b.membershipId}'`)).rows;
    expect(rows[0].member_number).toBe(b.memberNumber);
  });
  it('the database refuses a duplicate within a salon (index from migration 785)', async () => {
    await expect(pg.query(`INSERT INTO customer_memberships (tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, member_number) VALUES ('${T}','${B}','${C}','${P}','${V}','pending','M-SAME0001')`)).rejects.toThrow(/duplicate key/);
  });
});

describe('D6: enrollment is atomic', () => {
  it('a failure while issuing the first credits leaves no membership behind (it used to stay active with no credits)', async () => {
    const { MembershipEnrollService } = await import('./membership-enroll.service');
    const C2 = '7d000000-0000-4000-8000-0000000000d2';
    await pg.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C2}','${T}','${B}','Z','Y','Z Y');
      UPDATE membership_plans SET current_version_id = '${V}' WHERE id = '${P}';
      INSERT INTO membership_benefits (plan_version_id, tenant_id, benefit_type, label, credits_per_cycle) VALUES ('${V}','${T}','service_credit','Pedicure',1);
      CREATE OR REPLACE FUNCTION _fail_credit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'credit write failed'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER _fail_credit BEFORE INSERT ON membership_credit_ledger FOR EACH ROW EXECUTE FUNCTION _fail_credit();`);
    const svc = new MembershipEnrollService(repo);
    const plan = await repo.getPlanForEnroll(ctx() as any, P);
    if (!plan || plan.status !== 'active' || !plan.planVersionId) { await pg.exec(`DROP TRIGGER _fail_credit ON membership_credit_ledger`); return expect(plan).toBeTruthy(); }
    try {
      await expect(svc.enroll(ctx() as any, { customerId: C2, planId: P, autoRenewConsent: true })).rejects.toThrow(/credit write failed/);
    } finally { await pg.exec(`DROP TRIGGER _fail_credit ON membership_credit_ledger`); }
    expect((await pg.query(`SELECT count(*)::int n FROM customer_memberships WHERE customer_id = '${C2}'`)).rows[0].n).toBe(0);
  });
});

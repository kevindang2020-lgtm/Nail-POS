// surcharge-enrollment.pgtest — Fiserv master build §9.2: Super Admin records what FISERV enrolled (rate 100–300 bps +
// Fiserv's written reference) on the merchant that charges a branch, or withdraws it. Validated, branch-scoped, audited.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { SuperAdminMerchantAccountsRepository } from './super-admin-merchant-accounts.kysely.repository';
import { SuperAdminMerchantAccountsService } from './super-admin-merchant-accounts.service';

const T = 'f3aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OTHER = 'f4aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BR = 'f3111111-1111-4111-8111-111111111111', BR_OTHER = 'f4111111-1111-4111-8111-111111111111';
const ADMIN = { userId: 'f3999999-9999-4999-8999-999999999999', email: 'sa@aipowersalon.test' };
let pg: any; let svc: SuperAdminMerchantAccountsService;
const q = async (s: string, p: any[] = []) => (await pg.query(s, p)).rows as any[];

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'A','Enroll Salon','enroll-salon','ENRSAL','active'), ($2,'B','Other Salon','other-salon','OTHSAL','active')`, [T, OTHER]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active'), ($3,$4,'Elsewhere','active')`, [BR, T, BR_OTHER, OTHER]);
  await q(`insert into tenant_payment_config (tenant_id, processor, status, environment, merchant_id) values ($1,'fiserv','active','sandbox','MID-E')`, [T]);
  svc = new SuperAdminMerchantAccountsService(new SuperAdminMerchantAccountsRepository(kyselyFor(pg) as never));
}, 180000);

describe('Super Admin → surcharge enrollment', () => {
  it('records Fiserv\'s rate and reference on the tenant default merchant, audited', async () => {
    expect(await svc.setSurchargeEnrollment(ADMIN, T, { enrolled: true, rateBps: 275, reference: 'FSV-ENR-1', reason: 'Fiserv email Nov 5' }))
      .toEqual({ ok: true, enrolled: true, rateBps: 275, branchId: null });
    expect(await q(`select surcharge_enrolled, surcharge_rate_bps, surcharge_reference from tenant_payment_config where tenant_id = $1`, [T]))
      .toEqual([{ surcharge_enrolled: true, surcharge_rate_bps: 275, surcharge_reference: 'FSV-ENR-1' }]);
    const a = await q(`select action, metadata from audit_events where tenant_id = $1 and action = 'surcharge_enrollment_recorded'`, [T]);
    expect(a).toHaveLength(1);
    expect(a[0].metadata).toMatchObject({ previous: { enrolled: false, rateBps: null }, rateBps: 275, reference: 'FSV-ENR-1', reason: 'Fiserv email Nov 5' });
  });

  it('refuses a rate outside 1.00%–3.00%, a missing reference, and a missing reason — nothing changes', async () => {
    await expect(svc.setSurchargeEnrollment(ADMIN, T, { enrolled: true, rateBps: 350, reference: 'X', reason: 'r' })).rejects.toThrow(/100–300/);
    await expect(svc.setSurchargeEnrollment(ADMIN, T, { enrolled: true, rateBps: 50, reference: 'X', reason: 'r' })).rejects.toThrow(/100–300/);
    await expect(svc.setSurchargeEnrollment(ADMIN, T, { enrolled: true, rateBps: 300, reason: 'r' })).rejects.toThrow(/reference/);
    await expect(svc.setSurchargeEnrollment(ADMIN, T, { enrolled: true, rateBps: 300, reference: 'X' })).rejects.toThrow(/reason/);
    expect((await q(`select surcharge_rate_bps from tenant_payment_config where tenant_id = $1`, [T]))[0].surcharge_rate_bps).toBe(275);
  });

  it('another salon\'s branch is refused; a branch with no merchant of its own is refused', async () => {
    await expect(svc.setSurchargeEnrollment(ADMIN, T, { enrolled: true, rateBps: 200, reference: 'X', reason: 'r', branchId: BR_OTHER })).rejects.toThrow(/does not belong/);
    await expect(svc.setSurchargeEnrollment(ADMIN, T, { enrolled: true, rateBps: 200, reference: 'X', reason: 'r', branchId: BR })).rejects.toThrow(/no merchant account of its own/);
  });

  it('withdrawal clears the rate and reference', async () => {
    expect(await svc.setSurchargeEnrollment(ADMIN, T, { enrolled: false, reason: 'Fiserv withdrew' })).toEqual({ ok: true, enrolled: false, rateBps: null, branchId: null });
    expect(await q(`select surcharge_enrolled, surcharge_rate_bps, surcharge_reference from tenant_payment_config where tenant_id = $1`, [T]))
      .toEqual([{ surcharge_enrolled: false, surcharge_rate_bps: null, surcharge_reference: null }]);
  });
});

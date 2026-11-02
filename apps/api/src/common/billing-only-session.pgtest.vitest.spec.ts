// Constitution 7 §19 on the real schema: the owner of a BILLING-suspended salon gets a billing-only session; the gate
// lets it reach billing only, and lifts once the salon is active again.
import { describe, it, expect, beforeAll } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyAuthUserRepository, decideLogin } from '@aipowersalon/identity';
import { SuspendedAccessGuard, billingOnlyAllows } from './suspended-access.guard';
import { seedRow } from '../events/pgtest-seed';

const T = '6f6f6f6f-6f6f-46f6-86f6-6f6f6f6f6f6f', O = '70707070-7070-4707-8707-707070707070';
let db: any;
function guardCtx(path: string, restriction: string | null) {
  const req = { ctx: { tenantId: T, userId: O, role: 'OWNER', permissions: [], ...(restriction ? { restriction } : {}) }, route: { path } };
  return { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) } as any;
}
beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'B', display_name: 'Billing Hold', tenant_slug: 'billinghold', tenant_code: 'BILL01', status: 'active' });
  await seedRow(pg, 'users', { id: O, tenant_id: T, email: 'owner@billinghold.test', role: 'OWNER', status: 'active' });
  await sql`update tenants set lifecycle_state = 'SUSPENDED', suspension_reason_code = 'BILLING' where id = ${T}`.execute(db);
});

describe('billing-only session (§19)', () => {
  it('the login lookup returns the suspension cause, and the owner\'s decision is billing-only', async () => {
    const l = await new KyselyAuthUserRepository(db).findTenantUserForLogin('BILL01', { kind: 'email', value: 'owner@billinghold.test' } as any);
    expect(l).toMatchObject({ tenantFound: true, tenantStatus: 'suspended', suspensionReasonCode: 'BILLING' });
    const d = decideLogin({ tenantFound: true, tenantStatus: l.tenantStatus, userFound: true, passwordValid: true, userStatus: 'active', subscriptionStatus: 'past_due',
      mfaRequired: false, mfaSatisfied: true, branchCount: 1, role: l.user?.role, suspensionReasonCode: l.suspensionReasonCode });
    expect(d).toMatchObject({ outcome: 'SUCCESS', restriction: 'SUSPENDED_BILLING_ONLY' });
  });
  it('the gate: billing and sign-in routes pass; everything else is refused; unrestricted sessions are untouched', async () => {
    const g = new SuspendedAccessGuard(db);
    expect(await g.canActivate(guardCtx('/tenant/account/invoices', 'SUSPENDED_BILLING_ONLY'))).toBe(true);
    expect(await g.canActivate(guardCtx('/tenant/account/invoices/:id/pay', 'SUSPENDED_BILLING_ONLY'))).toBe(true);
    expect(await g.canActivate(guardCtx('/auth/me', 'SUSPENDED_BILLING_ONLY'))).toBe(true);
    await expect(g.canActivate(guardCtx('/pos/checkout', 'SUSPENDED_BILLING_ONLY'))).rejects.toThrow(ForbiddenException);
    await expect(g.canActivate(guardCtx('/owner/reports/revenue', 'SUSPENDED_BILLING_ONLY'))).rejects.toThrow(ForbiddenException);
    expect(await g.canActivate(guardCtx('/pos/checkout', null))).toBe(true);
    expect(billingOnlyAllows('/tenant/account/invoices-evil')).toBe(false);          // a look-alike prefix is not billing
  });
  it('once the salon is active again the gate lifts for the same session', async () => {
    await sql`update tenants set lifecycle_state = 'ACTIVE' where id = ${T}`.execute(db);
    expect(await new SuspendedAccessGuard(db).canActivate(guardCtx('/pos/checkout', 'SUSPENDED_BILLING_ONLY'))).toBe(true);
  });
});

// ── §19: data export follows the suspension cause ─────────────────────────────────────────────────────────────────
describe('billing-only data export (§19)', () => {
  const F = '7f7f7f7f-7f7f-47f7-87f7-7f7f7f7f7f7f';
  function ctxFor(tenantId: string, path: string, method = 'GET') {
    const req = { ctx: { tenantId, userId: O, role: 'OWNER', permissions: [], restriction: 'SUSPENDED_BILLING_ONLY' }, route: { path }, method };
    return { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) } as any;
  }
  it('BILLING: the salon\'s own GET exports are reachable; other POS routes and non-GET exports are not', async () => {
    await sql`update tenants set lifecycle_state = 'SUSPENDED', suspension_reason_code = 'BILLING' where id = ${T}`.execute(db);
    const g = new SuspendedAccessGuard(db);
    expect(await g.canActivate(ctxFor(T, '/pos/reports/:reportId/export'))).toBe(true);
    expect(await g.canActivate(ctxFor(T, '/pos/customers/export-xlsx'))).toBe(true);
    await expect(g.canActivate(ctxFor(T, '/pos/customers/export', 'POST'))).rejects.toThrow(ForbiddenException);
    await expect(g.canActivate(ctxFor(T, '/pos/reports/daily'))).rejects.toThrow(ForbiddenException);
    await expect(g.canActivate(ctxFor(T, '/super-admin/billing/export'))).rejects.toThrow(ForbiddenException);   // not the salon's own data
  });
  it('FRAUD: exports stay closed', async () => {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${F}, 'F', 'Fraud Salon', 'fraudsalon', 'FRAU02', 'active')`.execute(db);
    await sql`update tenants set lifecycle_state = 'SUSPENDED', suspension_reason_code = 'FRAUD' where id = ${F}`.execute(db);
    await expect(new SuspendedAccessGuard(db).canActivate(ctxFor(F, '/pos/reports/:reportId/export'))).rejects.toThrow(ForbiddenException);
  });
});

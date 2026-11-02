// The developer's commission authorization codes, hardened in the Sep 2026 merge (real schema).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CommissionSecurityService, hashCommissionAuthCode, newCommissionAuthCode } from '@aipowersalon/workforce';

const A = '84848484-8484-4848-8848-848484848484', B = '85858585-8585-4858-8858-858585858585';
let db: any;
beforeAll(async () => { const pg = await migratedPglite(); db = kyselyFor(pg); });
const issue = async (tenant: string, code: string, hoursLeft = 24) =>
  sql`insert into admin_commission_auth_codes (tenant_id, code_enc, generated_by_user_id, generated_by_name, expires_at)
      values (${tenant}, ${hashCommissionAuthCode(code)}, 'sa-1', 'Super Admin', now() + (${hoursLeft} * interval '1 hour'))`.execute(db);
const verify = (tenant: string, code: string) => CommissionSecurityService.verifyAuthorization(db, tenant, 'MANAGER', code);

describe('commission authorization codes', () => {
  it('codes are random, 10 characters after the prefix, and stored only as a hash', async () => {
    const a = newCommissionAuthCode(), b = newCommissionAuthCode();
    expect(a).toMatch(/^AUTH-COMM-[A-HJ-NP-Z2-9]{10}$/); expect(a).not.toBe(b);
    await issue(A, a);
    const stored = (await sql<any>`select code_enc from admin_commission_auth_codes where tenant_id = ${A}`.execute(db)).rows[0].code_enc;
    expect(stored).toMatch(/^sha256:[0-9a-f]{64}$/); expect(stored).not.toContain(a);
  });
  it('works once, for its own salon only', async () => {
    const c = newCommissionAuthCode(); await issue(A, c);
    await expect(verify(B, c)).rejects.toBeTruthy();                       // another salon cannot use it
    expect(await verify(A, c)).toMatchObject({ authorizedByName: 'Super Admin' });
    await expect(verify(A, c)).rejects.toThrow(/already been used/);        // single use
  });
  it('an expired code is refused; two simultaneous uses cannot both succeed', async () => {
    const e = newCommissionAuthCode(); await issue(A, e, -1);
    await expect(verify(A, e)).rejects.toThrow(/expired/);
    const r = newCommissionAuthCode(); await issue(A, r);
    const out = await Promise.allSettled([verify(A, r), verify(A, r)]);
    expect(out.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  });
});

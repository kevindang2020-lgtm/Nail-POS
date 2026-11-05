// rule-activation-auth-code.pgtest — merge Oct 12 2026 (other chat's 473 + rule-activation test, adapted). Our tree ALREADY
// stores commission authorization codes hashed (code_enc = sha256, Sep 2026 merge), tenant-scoped, spent by one conditional
// UPDATE — 473 is not needed. What the port ADDS: activating an owner rule version (it prices every future line) requires
// a code exactly like the POS commission edits (platform principal exempt), and the change is recorded with the MASKED code.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CommissionSecurityService, hashCommissionAuthCode, newCommissionAuthCode, maskCommissionAuthCode } from '../technicians/commission-security.service';
import { KyselyCompensationRulesRepo } from './compensation-rules.repository';
import { CompensationRulesService } from './compensation-rules.service';

const P = 'c0ac0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const TA = id('a1'), TB = id('a2'), OWNER = id('e1');
let pg: any; let db: any;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];

async function mint(tenantId: string): Promise<string> {
  const code = newCommissionAuthCode();
  await q(`insert into admin_commission_auth_codes (tenant_id, code_enc, generated_by_user_id, generated_by_name, expires_at) values ($1,$2,'sa','Super Admin', now() + interval '1 day')`, [tenantId, hashCommissionAuthCode(code)]);
  return code;
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, default_commission_percent) values ($1,'Auth A','Auth A','auth-a','AUTA01','active',null), ($2,'Auth B','Auth B','auth-b','AUTB01','active',42)`, [TA, TB]);
}, 180_000);

describe('rule activation requires the commission authorization code (mandate §72/§122)', () => {
  it('the row holds only the hash; another tenant\'s code and a wrong code are refused; the code is one-time', async () => {
    const code = await mint(TA);
    const row = (await q(`select code_enc from admin_commission_auth_codes where tenant_id = $1`, [TA]))[0];
    expect(row.code_enc).toBe(hashCommissionAuthCode(code));
    expect(row.code_enc).not.toContain(code.slice(-6));
    await expect(CommissionSecurityService.verifyAuthorization(db, TB, 'OWNER', code)).rejects.toThrow(/Invalid Admin Authorization Code/);
    await expect(CommissionSecurityService.verifyAuthorization(db, TA, 'OWNER', 'AUTH-COMM-ZZZZZZZZZZ')).rejects.toThrow(/Invalid/);
    const ok = await CommissionSecurityService.verifyAuthorization(db, TA, 'OWNER', code);
    expect(ok.codeUsed).toBe(maskCommissionAuthCode(code));
    expect(ok.codeUsed).not.toContain(code.slice(-4));
    await expect(CommissionSecurityService.verifyAuthorization(db, TA, 'OWNER', code)).rejects.toThrow(/already been used/);
  });

  it('OWNER activation without / with a wrong code is refused and nothing activates; with a code it activates and is recorded masked; a platform principal is exempt', async () => {
    const repo = new KyselyCompensationRulesRepo(db);
    const svc = new CompensationRulesService(repo, db);
    const ctx = { tenantId: TA, branchId: null, userId: OWNER, role: 'OWNER' };
    const pol = await repo.createPolicy(ctx, {}, 'default', { commissionType: 'percent', commissionValue: 60, effectiveStart: new Date().toISOString() });
    const vId = pol.versions[0].id;
    await expect(svc.activate(ctx, vId)).rejects.toThrow(/Admin Authorization Code is required/);
    await expect(svc.activate(ctx, vId, 'AUTH-COMM-ZZZZZZZZZZ')).rejects.toThrow(/Invalid Admin Authorization Code/);
    expect((await repo.getPolicy(ctx, pol.id))!.versions[0].status).not.toBe('active');
    const code = await mint(TA);
    expect((await svc.activate(ctx, vId, code)).status).toBe('active');
    const log = await q(`select target_type, new_commission_percent, auth_code_used from commission_change_audit_logs where tenant_id = $1`, [TA]);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ target_type: 'rule_version', auth_code_used: maskCommissionAuthCode(code) });
    expect(Number(log[0].new_commission_percent)).toBe(60);
    const v2 = await repo.addVersion(ctx, pol.id, { commissionType: 'percent', commissionValue: 65, effectiveStart: new Date().toISOString() });
    expect((await svc.activate({ ...ctx, role: 'SUPER_ADMIN' }, v2!.id)).status).toBe('active');
  });

  it('seedDefaultTemplate uses the TENANT default rate (42), not a hardcoded 60', async () => {
    const svc = new CompensationRulesService(new KyselyCompensationRulesRepo(db), db);
    const p = await svc.seedDefaultTemplate({ tenantId: TB, branchId: null, userId: id('e2') });
    expect(p.versions[0].commissionValue).toBe(42);
    expect(p.label).toBe('Standard 42/58 split');
  });
});

// global-rewards-dual-control.pgtest — Batch C decision 1 (Nov 6 2026; migration 824) on the REAL schema: a second Super
// Admin approves a global rule publish / program update when one exists; a single Super Admin self-approves (audited);
// a pause-only change is never held. The maker/checker here is a faithful stand-in for PlatformApprovals (same contract:
// required() reads platform_settings, runOrRequest files a request, execute runs as the requester).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { GlobalRewardsRepository } from './global-rewards.repository';
import { GlobalRewardsService } from './global-rewards.service';
import { GlobalRewardsError } from './global-rewards-core';
import { GR_GLOBAL_RULE_ACTION, GR_PROGRAM_ACTION, isPauseOnly, otherEligibleApprovers, type ApprovalsLike } from './global-rewards-dual-control';

const P = 'c8240000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const SA1 = id(1), SA2 = id(2), AUD = id(3);
let db: any; let svc: GlobalRewardsService; let repo: GlobalRewardsRepository;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const me = { userId: SA1, permissions: ['super_admin.billing.manage'] };
const filed: any[] = [];
const actions = new Map<string, any>();
const approvals: ApprovalsLike = {
  register(a) { actions.set(a.key, a); },
  registered() { return [...actions.values()]; },
  async required(k) { const r = await q(sql`select value from platform_settings where setting_key = ${`approvals.${k}.required`}`); return r[0]?.value === true || r[0]?.value === 'true'; },
  async runOrRequest(key, payload, reason, actor, target) { filed.push({ key, payload, reason, actor, target }); return { executed: false, approvalId: 'ap-' + filed.length, expiresAt: '2026-11-07T00:00:00.000Z' }; },
};
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof GlobalRewardsError ? e.code : (e as Error).message; } }
const rules = async () => (await repo.globalVersions()).length;
const rule = (pts: number) => ({ spendIncrementCents: 1000, pointTenthsPerIncrement: pts, reason: 'November promotion for global salons' });

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  repo = new GlobalRewardsRepository(db); svc = new GlobalRewardsService(repo, null, null).useApprovals(approvals);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role, platform_role) values (${SA1}, null, 'Kevin', 'k@dc.test', 'active', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN')`);
}, 240_000);
beforeEach(async () => { filed.length = 0; await q(sql`delete from users where id in (${SA2}, ${AUD})`); });

describe('Batch C decision 1 — dual control on the global loyalty rule and program', () => {
  it('DC-01 migration 824 turns the policy ON for both actions; both are registered as approvable', async () => {
    expect(await approvals.required(GR_GLOBAL_RULE_ACTION)).toBe(true);
    expect(await approvals.required(GR_PROGRAM_ACTION)).toBe(true);
    expect(approvals.registered().map((a) => a.key).sort()).toEqual([GR_GLOBAL_RULE_ACTION, GR_PROGRAM_ACTION].sort());
  });
  it('DC-02 the only Super Admin is never locked out: the publish runs now as an audited self-approval', async () => {
    const before = await rules();
    const r: any = await svc.publishGlobalControlled(rule(6), me);
    expect(r.pending).toBeUndefined();
    expect(await rules()).toBe(before + 1);
    expect(filed).toHaveLength(0);
    const a = await q(sql`select metadata_json from audit_logs where action_type = 'approval_self_approved' and entity_id = ${GR_GLOBAL_RULE_ACTION} order by created_at desc limit 1`);
    expect(a[0].metadata_json).toMatchObject({ action: GR_GLOBAL_RULE_ACTION, reason: 'November promotion for global salons' });
  });
  it('DC-03 a platform account that cannot approve (auditor) does not count; a second Super Admin does', async () => {
    await q(sql`insert into users (id, tenant_id, full_name, email, status, role, platform_role) values (${AUD}, null, 'Audit', 'a@dc.test', 'active', 'SUPER_ADMIN', 'PLATFORM_AUDITOR')`);
    expect(await otherEligibleApprovers(db, SA1)).toBe(0);
    await q(sql`insert into users (id, tenant_id, full_name, email, status, role, platform_role) values (${SA2}, null, 'Second', 's@dc.test', 'active', 'SUPER_ADMIN', 'PLATFORM_FINANCE')`);
    expect(await otherEligibleApprovers(db, SA1)).toBe(1);
    await q(sql`update users set status = 'suspended' where id = ${SA2}`);
    expect(await otherEligibleApprovers(db, SA1)).toBe(0);                 // a suspended account cannot approve
  });
  it('DC-04 with a second Super Admin the publish becomes a REQUEST — nothing changes until another person approves; approval runs it as the requester', async () => {
    await q(sql`insert into users (id, tenant_id, full_name, email, status, role, platform_role) values (${SA2}, null, 'Second', 's@dc.test', 'active', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN')`);
    const before = await rules();
    const r: any = await svc.publishGlobalControlled(rule(7), me);
    expect(r).toMatchObject({ pending: true, approvalId: 'ap-1' });
    expect(await rules()).toBe(before);
    expect(filed[0]).toMatchObject({ key: GR_GLOBAL_RULE_ACTION, reason: 'November promotion for global salons', actor: { userId: SA1 } });
    await actions.get(GR_GLOBAL_RULE_ACTION).execute(filed[0].payload, { userId: SA1, permissions: ['super_admin.billing.manage'] });   // what approval does
    expect(await rules()).toBe(before + 1);
    // an invalid rule is refused now, never filed for a second person
    expect(await code(svc.publishGlobalControlled({ ...rule(7), spendIncrementCents: -5 }, me))).not.toBe('ok');
    expect(filed).toHaveLength(1);
  });
  it('DC-05 program: a pause-only change is the emergency stop (never held); un-pausing / limits are held and need a reason', async () => {
    await q(sql`insert into users (id, tenant_id, full_name, email, status, role, platform_role) values (${SA2}, null, 'Second', 's@dc.test', 'active', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN')`);
    expect(isPauseOnly({ earn_paused: true })).toBe(true);
    expect(isPauseOnly({ earn_paused: false })).toBe(false);
    expect(isPauseOnly({ earn_paused: true, max_purchase_tokens: 5 })).toBe(false);
    const v0 = (await repo.program()) as any;
    await svc.updateProgramControlled({ earn_paused: true }, Number(v0.version), null, me);
    const v1 = (await repo.program()) as any;
    expect(v1.earnPaused).toBe(true);
    expect(filed).toHaveLength(0);
    expect(await code(svc.updateProgramControlled({ earn_paused: false }, Number(v1.version), null, me))).toBe('VALIDATION_FAILED');
    const r: any = await svc.updateProgramControlled({ earn_paused: false }, Number(v1.version), 'resume earning after the incident', me);
    expect(r.pending).toBe(true);
    expect(((await repo.program()) as any).earnPaused).toBe(true);           // still paused until approved
    await actions.get(GR_PROGRAM_ACTION).execute(filed[0].payload, { userId: SA1, permissions: [] });
    expect(((await repo.program()) as any).earnPaused).toBe(false);
  });
  it('DC-06 policy turned off (Super Admin → Approvals): changes run at once, as before', async () => {
    await q(sql`insert into users (id, tenant_id, full_name, email, status, role, platform_role) values (${SA2}, null, 'Second', 's@dc.test', 'active', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN')`);
    await q(sql`update platform_settings set value = 'false'::jsonb where setting_key = ${`approvals.${GR_GLOBAL_RULE_ACTION}.required`}`);
    try {
      const before = await rules();
      const r: any = await svc.publishGlobalControlled(rule(8), me);
      expect(r.pending).toBeUndefined(); expect(await rules()).toBe(before + 1); expect(filed).toHaveLength(0);
    } finally { await q(sql`update platform_settings set value = 'true'::jsonb where setting_key = ${`approvals.${GR_GLOBAL_RULE_ACTION}.required`}`); }
  });
});

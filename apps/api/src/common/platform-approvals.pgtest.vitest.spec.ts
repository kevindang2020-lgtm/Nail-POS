// Constitution 7 §119 / §120 / §182 on the real schema — maker/checker for critical platform actions.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { platformPermissionsFor } from '@aipowersalon/permissions';
import { PlatformApprovals } from '@aipowersalon/platform';

const MAKER = '80808080-8080-4808-8808-808080808080', CHECKER = '81818181-8181-4818-8818-818181818181';
const all = platformPermissionsFor('PLATFORM_SUPER_ADMIN') as string[];
let db: any; let approvals: PlatformApprovals; const executed: any[] = [];
beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  approvals = new PlatformApprovals(db);
  approvals.register({ key: 'plan.limit_override', label: 'Tenant plan-limit override', requiredPermission: 'super_admin.plans.manage',
    execute: async (p) => { executed.push(p); return { applied: p }; } });
});

describe('platform approvals', () => {
  it('policy OFF (default): the action runs immediately — a single operator is never locked out', async () => {
    expect(await approvals.runOrRequest('plan.limit_override', { tenantId: 't1', input: { metric: 'customers', limit: 5000 } }, '', { userId: MAKER, permissions: all }, 't1'))
      .toMatchObject({ executed: true });
    expect(executed).toHaveLength(1);
  });
  it('policy ON: the change becomes a request (reason required) and nothing runs yet', async () => {
    await sql`insert into platform_settings (setting_key, setting_group, value, value_type) values ('approvals.plan.limit_override.required', 'approvals', 'true'::jsonb, 'boolean')`.execute(db);
    await expect(approvals.runOrRequest('plan.limit_override', { tenantId: 't1', input: {} }, 'x', { userId: MAKER, permissions: all }, 't1')).rejects.toBeTruthy();
    const r: any = await approvals.runOrRequest('plan.limit_override', { tenantId: 't1', input: { metric: 'customers', limit: 9000 } }, 'large salon onboarding, approved by sales', { userId: MAKER, permissions: all }, 't1');
    expect(r).toMatchObject({ executed: false });
    expect(executed).toHaveLength(1);
    expect((await approvals.list()).rows.map((x) => [x.id, x.status])).toEqual([[r.approvalId, 'pending']]);
  });
  it('the requester cannot approve their own; an approver without the permission cannot; another holder can — and it executes', async () => {
    const id = (await approvals.list()).rows[0].id;
    await expect(approvals.approve(id, { userId: MAKER, permissions: all })).rejects.toMatchObject({ response: { code: 'separation' } });
    await expect(approvals.approve(id, { userId: CHECKER, permissions: platformPermissionsFor('PLATFORM_SUPPORT') as string[] })).rejects.toMatchObject({ response: { code: 'forbidden' } });
    expect(await approvals.approve(id, { userId: CHECKER, permissions: all }, 'checked with finance')).toMatchObject({ ok: true, status: 'executed' });
    expect(executed.at(-1)).toEqual({ tenantId: 't1', input: { metric: 'customers', limit: 9000 } });
    await expect(approvals.approve(id, { userId: CHECKER, permissions: all })).rejects.toMatchObject({ response: { code: 'not_pending' } });   // once
    expect((await sql<any>`select action_type from audit_logs where entity_type = 'platform_approval' order by created_at`.execute(db)).rows.map((r: any) => r.action_type)).toEqual(['approval_requested', 'approval_approved']);
  });
  it('the database refuses self-approval even if the service were bypassed; rejected and expired requests never run', async () => {
    const r: any = await approvals.runOrRequest('plan.limit_override', { tenantId: 't2', input: {} }, 'another override to review', { userId: MAKER, permissions: all }, 't2');
    await expect(sql`update platform_approvals set approved_by = ${MAKER} where id = ${r.approvalId}`.execute(db)).rejects.toBeTruthy();
    expect(await approvals.reject(r.approvalId, { userId: CHECKER, permissions: all }, 'not justified by usage')).toMatchObject({ status: 'rejected' });
    const e: any = await approvals.runOrRequest('plan.limit_override', { tenantId: 't3', input: {} }, 'will expire before review', { userId: MAKER, permissions: all }, 't3');
    await sql`update platform_approvals set expires_at = now() - interval '1 minute' where id = ${e.approvalId}`.execute(db);
    await expect(approvals.approve(e.approvalId, { userId: CHECKER, permissions: all })).rejects.toMatchObject({ response: { code: 'expired' } });
    expect(executed).toHaveLength(2);
  });
});

describe('approval policy', () => {
  it('lists each action with its current requirement; changing it needs platform_roles.manage and a reason, and is recorded', async () => {
    expect((await approvals.policies())[0]).toMatchObject({ action: 'plan.limit_override', required: true });
    await expect(approvals.setPolicy('plan.limit_override', false, 'back to one operator', { userId: CHECKER, permissions: platformPermissionsFor('PLATFORM_ADMIN') as string[] })).rejects.toMatchObject({ response: { code: 'forbidden' } });
    await expect(approvals.setPolicy('plan.limit_override', false, 'x', { userId: CHECKER, permissions: all })).rejects.toBeTruthy();
    expect((await approvals.setPolicy('plan.limit_override', false, 'back to one operator for now', { userId: CHECKER, permissions: all }))[0]).toMatchObject({ required: false });
    expect((await sql<any>`select count(*)::int n from platform_setting_changes where setting_key = 'approvals.plan.limit_override.required'`.execute(db)).rows[0].n).toBe(1);
  });
});

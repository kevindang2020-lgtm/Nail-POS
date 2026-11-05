// super-admin-ai-scheduling-optimizer-core.vitest.spec — BUILD_PLAN Phase 7 (agent B): Super Admin oversight of the AI
// Scheduling Optimizer. Counts only; applied split manual vs AUTOMATED (the old overview called every manual application
// an "automatic action"); a salon's detail only inside an ACTIVE canonical support session (this admin, this salon);
// every write needs a reason and goes through the engine with a system context; the platform switch is audited.
import { describe, it, expect, vi } from 'vitest';
import { buildOverview, activeSupportSession, actionReason, MIN_ACTION_REASON } from './super-admin-ai-scheduling-optimizer-core';
import { SuperAdminAiSchedulingOptimizerService, saSchedCtx } from './super-admin-ai-scheduling-optimizer.service';
import type { SaSchedRead } from './super-admin-ai-scheduling-optimizer.repository';

const T = '66666666-0000-4000-8000-000000000001';
const ADMIN = '66666666-0000-4000-8000-0000000000ad';
const OTHER_ADMIN = '66666666-0000-4000-8000-0000000000ae';
const REC = '66666666-0000-4000-8000-0000000000a1';
const NOW = Date.parse('2026-10-08T12:00:00Z');
const session = (over: any = {}) => ({ id: '66666666-0000-4000-8000-0000000000s1'.replace('s1', '51'), tenant_id: T, admin_user_id: ADMIN, ended_at: null, expires_at: new Date(NOW + 600_000).toISOString(), ...over });

describe('core', () => {
  it('splits applied by the automated flag and counts failures', () => {
    const o = buildOverview({ enabledTenants: 3, killedTenants: 1, platformKilled: false, runs: [{ status: 'completed', n: 5 }, { status: 'failed', n: 2 }], runsLast24h: 4,
      recommendations: [{ status: 'applied', automated: false, n: 7 }, { status: 'applied', automated: true, n: 2 }, { status: 'application_failed', automated: false, n: 1 }, { status: 'review_required', automated: false, n: 4 }],
      proposals: [{ status: 'customer_notified', n: 2 }], conflictsOpen: 3, understaffingOpen: 1, explanations: [{ source: 'llm', n: 6 }, { source: 'template', n: 9 }], llmCostMicroUsd30d: 1234, now: new Date(NOW) });
    expect(o.applied).toEqual({ manual: 7, automated: 2, failed: 1 });
    expect(o.runs).toEqual({ total: 7, completed: 5, failed: 2, last24h: 4 });
    expect(o.recommendations).toEqual({ applied: 9, application_failed: 1, review_required: 4 });
    expect(o.explanations).toEqual({ llm: 6, template: 9 });
    expect(o).toMatchObject({ enabledTenants: 3, killedTenants: 1, conflictsOpen: 3, understaffingOpen: 1, llmCostMicroUsd30d: 1234, proposals: { customer_notified: 2 } });
    expect(Object.keys(o)).not.toContain('appointments');
  });
  it('an active support session = this admin, this salon, not ended, not expired', () => {
    expect(activeSupportSession([session()], ADMIN, T, NOW)).toBeTruthy();
    expect(activeSupportSession([session()], OTHER_ADMIN, T, NOW)).toBeNull();
    expect(activeSupportSession([session({ tenant_id: '66666666-0000-4000-8000-000000000009' })], ADMIN, T, NOW)).toBeNull();
    expect(activeSupportSession([session({ ended_at: new Date(NOW).toISOString() })], ADMIN, T, NOW)).toBeNull();
    expect(activeSupportSession([session({ expires_at: new Date(NOW - 1).toISOString() })], ADMIN, T, NOW)).toBeNull();
    expect(activeSupportSession([session()], null, T, NOW)).toBeNull();
  });
  it('a reason must be at least MIN_ACTION_REASON characters', () => {
    expect(actionReason('x'.repeat(MIN_ACTION_REASON - 1))).toBeNull();
    expect(actionReason('  ' + 'x'.repeat(MIN_ACTION_REASON) + '  ')).toBe('x'.repeat(MIN_ACTION_REASON));
  });
});

function fakeRead(over: Partial<SaSchedRead> = {}) {
  const r: SaSchedRead & { audits: any[] } = {
    audits: [],
    overview: async () => ({ enabledTenants: 0, killedTenants: 0, platformKilled: false, runs: [], runsLast24h: 0, recommendations: [], proposals: [], conflictsOpen: 0, understaffingOpen: 0, explanations: [], llmCostMicroUsd30d: 0 }),
    tenants: vi.fn(async () => []),
    supportSessions: vi.fn(async () => [session()]),
    detail: async () => ({ exists: true, settings: { enabled: true, killed: false, automationEnabled: true, allowedAutoActions: 2, version: 5 }, runs: [], failedApplications: [], recommendationsByStatus: { applied: 1 } }),
    recommendation: async () => ({ id: REC, status: 'application_failed', version: 6 }),
    platformKilled: vi.fn(async () => false),
    setPlatformKilled: vi.fn(async () => undefined),
    audit: vi.fn(async (row: any) => { r.audits.push(row); }),
    ...over,
  } as any;
  return r;
}

describe('SuperAdminAiSchedulingOptimizerService', () => {
  const engine = () => ({ retry: vi.fn(async () => ({ ok: 1 })), rollback: vi.fn(async () => ({ ok: 2 })), setTenantKillSwitch: vi.fn(async () => ({ ok: 3 })) });
  it('detail only inside an active support session (403 SUPPORT_SESSION_REQUIRED otherwise); viewing is audited', async () => {
    const read = fakeRead();
    const svc = new SuperAdminAiSchedulingOptimizerService(read, engine(), () => NOW);
    const d = await svc.tenantDetail({ userId: ADMIN }, T);
    expect(d).toMatchObject({ tenantId: T, settings: { enabled: true, killed: false, automationAllowed: true, version: 5 }, recommendationsByStatus: { applied: 1 } });
    expect(d.supportSessionId).toBe(session().id);
    expect(read.supportSessions).toHaveBeenCalledWith(T, ADMIN);
    expect(read.audits[0]).toMatchObject({ tenantId: T, userId: ADMIN, action: 'super_admin_ai_scheduling_detail_viewed' });
    const none = new SuperAdminAiSchedulingOptimizerService(fakeRead({ supportSessions: async () => [] }), engine(), () => NOW);
    await expect(none.tenantDetail({ userId: ADMIN }, T)).rejects.toMatchObject({ status: 403, code: 'SUPPORT_SESSION_REQUIRED' });
    const otherAdmins = new SuperAdminAiSchedulingOptimizerService(fakeRead({ supportSessions: async () => [session({ admin_user_id: OTHER_ADMIN })] }), engine(), () => NOW);
    await expect(otherAdmins.tenantDetail({ userId: ADMIN }, T)).rejects.toMatchObject({ code: 'SUPPORT_SESSION_REQUIRED' });
  });
  it('platform killed → automationAllowed false in the detail', async () => {
    const svc = new SuperAdminAiSchedulingOptimizerService(fakeRead({ platformKilled: async () => true }), engine(), () => NOW);
    expect((await svc.tenantDetail({ userId: ADMIN }, T)).settings.automationAllowed).toBe(false);
  });
  it('retry / rollback: reason + support session, through the engine with a SYSTEM context and the current version; audited', async () => {
    const read = fakeRead(); const e = engine();
    const svc = new SuperAdminAiSchedulingOptimizerService(read, e, () => NOW);
    await expect(svc.recommendationAction({ userId: ADMIN }, T, REC, 'retry', 'short')).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    expect(e.retry).not.toHaveBeenCalled();
    const out = await svc.recommendationAction({ userId: ADMIN }, T, REC, 'retry', 'booking provider outage resolved');
    expect(out).toMatchObject({ ok: true, action: 'retry', result: { ok: 1 } });
    const [ctx, id, body] = e.retry.mock.calls[0];
    expect(ctx).toMatchObject({ tenantId: T, role: 'SYSTEM', actor: 'system', permissions: ['ai_scheduling.view', 'ai_scheduling.apply'] });
    expect(ctx.role).not.toBe('SUPER_ADMIN');
    expect([id, body]).toEqual([REC, { expectedVersion: 6 }]);
    expect(read.audits.at(-1)).toMatchObject({ action: 'super_admin_ai_scheduling_retry', entityId: REC, metadata: { reason: 'booking provider outage resolved', version: 6 } });
    await svc.recommendationAction({ userId: ADMIN }, T, REC, 'rollback', 'customer called to revert the move');
    expect(e.rollback).toHaveBeenCalledTimes(1);
    const noSession = new SuperAdminAiSchedulingOptimizerService(fakeRead({ supportSessions: async () => [] }), e, () => NOW);
    await expect(noSession.recommendationAction({ userId: ADMIN }, T, REC, 'retry', 'booking provider outage resolved')).rejects.toMatchObject({ code: 'SUPPORT_SESSION_REQUIRED' });
    const missing = new SuperAdminAiSchedulingOptimizerService(fakeRead({ recommendation: async () => null }), e, () => NOW);
    await expect(missing.recommendationAction({ userId: ADMIN }, T, REC, 'retry', 'booking provider outage resolved')).rejects.toMatchObject({ status: 404 });
  });
  it('disable → the engine\'s tenant kill switch (system ctx with configure), audited', async () => {
    const read = fakeRead(); const e = engine();
    await new SuperAdminAiSchedulingOptimizerService(read, e, () => NOW).disable({ userId: ADMIN }, T, 'runaway automation at this salon');
    expect(e.setTenantKillSwitch.mock.calls[0][0]).toMatchObject({ tenantId: T, permissions: ['ai_scheduling.view', 'ai_scheduling.configure'] });
    expect(e.setTenantKillSwitch.mock.calls[0].slice(1)).toEqual([true, 'Super Admin: runaway automation at this salon']);
    expect(read.audits.at(-1)).toMatchObject({ action: 'super_admin_ai_scheduling_tenant_disabled', tenantId: T });
  });
  it('platform switch: boolean + reason, written through the repository (history + audit)', async () => {
    const read = fakeRead();
    const svc = new SuperAdminAiSchedulingOptimizerService(read, engine(), () => NOW);
    await expect(svc.platformSwitch({ userId: ADMIN }, 'yes', 'a perfectly long reason')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(svc.platformSwitch({ userId: ADMIN }, true, 'short')).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await svc.platformSwitch({ userId: ADMIN }, true, 'provider incident across the platform');
    expect(read.setPlatformKilled).toHaveBeenCalledWith(ADMIN, true, 'provider incident across the platform');
  });
  it('no engine in the process → 503 for actions; no database → 503', async () => {
    await expect(new SuperAdminAiSchedulingOptimizerService(fakeRead(), null, () => NOW).disable({ userId: ADMIN }, T, 'runaway automation at this salon')).rejects.toMatchObject({ status: 503 });
    await expect(new SuperAdminAiSchedulingOptimizerService(null, null).overview()).rejects.toMatchObject({ status: 503 });
  });
  it('saSchedCtx is a system context, never the admin\'s session', () => {
    expect(saSchedCtx(T, ['ai_scheduling.view'])).toEqual({ tenantId: T, branchId: null, userId: 'system:super_admin', role: 'SYSTEM', permissions: ['ai_scheduling.view'], actor: 'system' });
  });
});

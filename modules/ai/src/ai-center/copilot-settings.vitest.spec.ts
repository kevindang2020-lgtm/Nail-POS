// copilot-settings.vitest.spec.ts — per-tenant Copilot toggles. Verifies the pure overlay onto defaults (ignoring
// junk), the no-DB default path, and that patch requires ai.manage.
import { describe, it, expect, vi } from 'vitest';
import { mergeCopilotSettings, overlayCopilotSettings, DEFAULT_COPILOT_SETTINGS, CopilotSettingsService } from './copilot-settings.service';

describe('mergeCopilotSettings / overlayCopilotSettings', () => {
  it('returns defaults for empty/absent stored value', () => {
    expect(mergeCopilotSettings(null)).toEqual(DEFAULT_COPILOT_SETTINGS);
    expect(mergeCopilotSettings({})).toEqual(DEFAULT_COPILOT_SETTINGS);
  });
  it('overlays only known boolean keys, ignoring junk', () => {
    const m = mergeCopilotSettings({ enabled: false, allowCancel: false, nonsense: 'x', allowCreate: 'yes' as any });
    expect(m.enabled).toBe(false);
    expect(m.allowCancel).toBe(false);
    expect(m.allowCreate).toBe(true);   // junk string ignored → default kept
    expect((m as any).nonsense).toBeUndefined();
  });
  it('branch overlay wins over the tenant base, other keys fall through (spec §47 hierarchy)', () => {
    const tenant = mergeCopilotSettings({ allowCancel: false, allowSendMessage: false });   // tenant-wide base
    const effective = overlayCopilotSettings(tenant, { allowCancel: true });                 // sparse branch override
    expect(effective.allowCancel).toBe(true);           // branch overrides tenant
    expect(effective.allowSendMessage).toBe(false);     // not overridden → tenant value falls through
    expect(effective.allowCreate).toBe(true);           // untouched → default
  });
});

describe('CopilotSettingsService', () => {
  const audit = { record: vi.fn(async () => ({})) };
  it('returns defaults when there is no database', async () => {
    const s = new CopilotSettingsService(null as any, audit as any);
    expect(await s.get({ tenantId: 't', userId: 'u', role: 'MANAGER', permissions: [] })).toEqual(DEFAULT_COPILOT_SETTINGS);
  });
  it('patch requires ai.manage', async () => {
    const s = new CopilotSettingsService(null as any, audit as any);
    await expect(s.patch({ tenantId: 't', userId: 'u', role: 'RECEPTION', permissions: [] }, { enabled: false })).rejects.toThrow(/ai.manage/i);
  });
  it('branch-level patch requires a branch', async () => {
    const s = new CopilotSettingsService(null as any, audit as any);
    await expect(s.patch({ tenantId: 't', userId: 'u', role: 'MANAGER', permissions: ['ai.manage'], branchId: null }, { enabled: false }, 'branch')).rejects.toThrow(/branch/i);
  });
  it('with no DB, patch persists nothing and returns effective defaults (honest) + audits', async () => {
    const s = new CopilotSettingsService(null as any, audit as any);
    const out = await s.patch({ tenantId: 't', userId: 'u', role: 'MANAGER', permissions: ['ai.manage'] }, { allowSendMessage: false });
    expect(out).toEqual(DEFAULT_COPILOT_SETTINGS);   // nothing persisted without a DB
    expect(audit.record).toHaveBeenCalled();
  });
  it('caches effective settings within TTL and rebuilds after invalidation (scale: one DB read per action becomes one per 30s)', async () => {
    const s = new CopilotSettingsService({} as any, audit as any);   // truthy db so get() proceeds to computeEffective
    const compute = vi.fn(async () => ({ ...DEFAULT_COPILOT_SETTINGS, allowCancel: false }));
    (s as any).computeEffective = compute;
    const ctx = { tenantId: 't', userId: 'u', role: 'MANAGER', permissions: [] };
    await s.get(ctx); await s.get(ctx);
    expect(compute).toHaveBeenCalledTimes(1);          // second read served from cache
    (s as any).invalidateTenant('t');
    await s.get(ctx);
    expect(compute).toHaveBeenCalledTimes(2);          // rebuilt after invalidation
  });
});

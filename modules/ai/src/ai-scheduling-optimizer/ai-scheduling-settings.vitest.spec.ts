// ai-scheduling-settings.vitest.spec.ts — automation is off by default; kill switches (tenant or branch) force it off;
// only safe auto-actions survive the allowlist; the per-action gate requires automation-allowed + listed + confident.
import { describe, it, expect } from 'vitest';
import { resolveSettings, isAutoActionAllowed, rowsToLayers, PLATFORM_DEFAULTS, SAFE_AUTO_ACTIONS, type SettingsRow } from './ai-scheduling-settings';

const enable = (config: any, o: Partial<SettingsRow> = {}): SettingsRow => ({ level: 'tenant', branch_id: null, enabled: true, kill_switch: null, config, ...o });

describe('automation safety', () => {
  it('is off by default and requires explicit enablement', () => {
    const def = resolveSettings({ platform: PLATFORM_DEFAULTS });
    expect(def.config.automationEnabled).toBe(false);
    expect(def.automationAllowed).toBe(false);
    expect(def.config.humanReviewRequired).toBe(true);
    expect(resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: enable({ automationEnabled: true, allowedAutoActions: ['open_empty_slot'] }) }).automationAllowed).toBe(true);
  });
  it('kill switches force automation off', () => {
    const kt = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: enable({ automationEnabled: true, allowedAutoActions: ['open_empty_slot'] }, { kill_switch: true }) });
    expect(kt.killed).toBe(true);
    expect(kt.automationAllowed).toBe(false);
    expect(kt.config.automationEnabled).toBe(false);
    const kb = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: enable({ automationEnabled: true, allowedAutoActions: ['open_empty_slot'] }), branch: { level: 'branch', branch_id: 'b1', enabled: true, kill_switch: true, config: null } });
    expect(kb.automationAllowed).toBe(false);
  });
  it('drops unsafe auto-actions and gates each action', () => {
    const unsafe = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: enable({ automationEnabled: true, allowedAutoActions: ['move_confirmed_appointment', 'open_empty_slot'] }) });
    expect(unsafe.config.allowedAutoActions).not.toContain('move_confirmed_appointment');
    const enabled = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: enable({ automationEnabled: true, allowedAutoActions: ['open_empty_slot'] }) });
    expect(isAutoActionAllowed(enabled, 'open_empty_slot', 0.9)).toBe(true);
    expect(isAutoActionAllowed(enabled, 'open_empty_slot', 0.5)).toBe(false);
    expect(isAutoActionAllowed(enabled, 'close_unavailable_tech', 0.9)).toBe(false);
    expect(isAutoActionAllowed(enabled, 'cancel_appointment', 0.99)).toBe(false);
    expect(SAFE_AUTO_ACTIONS).toHaveLength(6);
  });
});

describe('clamps + layers', () => {
  it('clamps confidence, merges weights, splits layers', () => {
    expect(resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: enable({ confidenceThreshold: 0.1 }) }).config.confidenceThreshold).toBe(0.5);
    expect(resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: enable({ weights: { ...PLATFORM_DEFAULTS.weights, waitReduction: 9 } }) }).config.weights.waitReduction).toBe(9);
    const rows: SettingsRow[] = [{ level: 'tenant', branch_id: null, enabled: true, kill_switch: null, config: null }, { level: 'branch', branch_id: 'b1', enabled: true, kill_switch: null, config: null }];
    expect(rowsToLayers(rows, { branchId: 'b1' }).branch?.branch_id).toBe('b1');
  });
});

// BUILD_PLAN Phase 7 — TTLs, weight clamps, the patch sanitizer and the platform kill switch.
import { sanitizeConfigPatch } from './ai-scheduling-settings';
describe('phase 7: ttl + weights + patch sanitizer + platform switch', () => {
  it('recommendation / proposal TTLs default to 30 min / 24 h and clamp to 5–1440 / 1–168', () => {
    expect(PLATFORM_DEFAULTS.recommendationTtlMin).toBe(30);
    expect(PLATFORM_DEFAULTS.proposalTtlHours).toBe(24);
    expect(resolveSettings({ tenant: enable({ recommendationTtlMin: 1 }) }).config.recommendationTtlMin).toBe(5);
    expect(resolveSettings({ tenant: enable({ recommendationTtlMin: 99999 }) }).config.recommendationTtlMin).toBe(1440);
    expect(resolveSettings({ tenant: enable({ proposalTtlHours: 0 }) }).config.proposalTtlHours).toBe(1);
    expect(resolveSettings({ tenant: enable({ proposalTtlHours: 500 }) }).config.proposalTtlHours).toBe(168);
  });
  it('weights clamp to 0–10 and ignore unknown / non-numeric keys', () => {
    const r = resolveSettings({ tenant: enable({ weights: { waitReduction: 99, gapFit: -4, bogus: 3, utilization: 'x' } as any }) });
    expect(r.config.weights.waitReduction).toBe(10);
    expect(r.config.weights.gapFit).toBe(0);
    expect((r.config.weights as any).bogus).toBeUndefined();
    expect(r.config.weights.utilization).toBe(PLATFORM_DEFAULTS.weights.utilization);
  });
  it('sanitizeConfigPatch keeps only known keys, clamped, and never stores humanReviewRequired', () => {
    const p = sanitizeConfigPatch({ minLeadTimeMin: -5, bogus: 1, humanReviewRequired: false, allowedAutoActions: ['open_empty_slot', 'cancel_all'], weights: { idleReduction: 50 } } as any);
    expect(p).toEqual({ minLeadTimeMin: 0, allowedAutoActions: ['open_empty_slot'], weights: { idleReduction: 10 } });
  });
  it('the platform switch kills generation-time automation and is reported', () => {
    const r = resolveSettings({ tenant: enable({ automationEnabled: true, allowedAutoActions: ['open_empty_slot'] }), platformKilled: true });
    expect(r.platformKilled).toBe(true);
    expect(r.automationAllowed).toBe(false);
  });
});

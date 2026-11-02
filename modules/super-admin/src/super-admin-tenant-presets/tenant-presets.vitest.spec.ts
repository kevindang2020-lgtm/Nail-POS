import { describe, it, expect, beforeEach } from 'vitest';
import { isPresetScope, validatePresetName, sanitizeSettings, settingsCount, SCOPE_LABEL } from './tenant-preset-core';
import { TenantPresetsService, PresetError } from './tenant-presets.service';
import { InMemoryTenantPresetsRepo } from './tenant-presets.repository';

describe('tenant-preset-core', () => {
  it('validates scope + name', () => {
    expect(isPresetScope('tenant')).toBe(true);
    expect(isPresetScope('nope')).toBe(false);
    expect(validatePresetName('Standard')).toBeNull();
    expect(validatePresetName('x')).toMatch(/at least 2/i);
  });
  it('sanitizes settings + counts', () => {
    const s = sanitizeSettings({ a: 1, b: 'x', c: () => 1, d: undefined });
    expect(s).toEqual({ a: 1, b: 'x' }); // functions/undefined dropped
    expect(settingsCount(s)).toBe(2);
    expect(sanitizeSettings(['not', 'an', 'object'])).toEqual({});
    expect(SCOPE_LABEL.onboarding).toBe('Default Onboarding Prefs.');
  });
});

const CTX = { userId: 'sa-1', email: 'a@x.io', role: 'SUPER_ADMIN' };

describe('TenantPresetsService', () => {
  let svc: TenantPresetsService; let repo: InMemoryTenantPresetsRepo;
  beforeEach(() => { repo = new InMemoryTenantPresetsRepo(); svc = new TenantPresetsService(repo); });

  it('creates presets, validating name + scope', async () => {
    const p = await svc.create(CTX, { name: 'Standard Salon', scope: 'tenant', settings: { trialDays: 14, taxRate: 8.5 } });
    expect(p.scope).toBe('tenant');
    expect(settingsCount(p.settings)).toBe(2);
    await expect(svc.create(CTX, { name: 'x', scope: 'tenant' })).rejects.toThrow(/at least 2/i);
    await expect(svc.create(CTX, { name: 'Bad', scope: 'nope' })).rejects.toThrow(/scope/i);
  });

  it('enforces a single default preset per scope', async () => {
    const a = await svc.create(CTX, { name: 'Alpha', scope: 'tenant', makeDefault: true });
    expect(a.isDefault).toBe(true);
    const b = await svc.create(CTX, { name: 'Beta', scope: 'tenant' });
    await svc.makeDefault(CTX, b.id);
    const list = await svc.list('tenant');
    expect(list.filter((p) => p.isDefault)).toHaveLength(1); // only one default per scope
    expect(list.find((p) => p.isDefault)!.id).toBe(b.id);
  });

  it('reports defaults per scope for the panel rows (honest null when unset)', async () => {
    const d0 = await svc.defaultsByScope();
    expect(d0.tenant).toBeNull();
    expect(d0.branch).toBeNull();
    await svc.create(CTX, { name: 'Std', scope: 'tenant', settings: { a: 1, b: 2, c: 3 }, makeDefault: true });
    const d1 = await svc.defaultsByScope();
    expect(d1.tenant).toEqual({ id: expect.any(String), name: 'Std', count: 3 });
  });

  it('builds table rows with scope labels + counts', async () => {
    await svc.create(CTX, { name: 'Onb', scope: 'onboarding', settings: { welcome: true } });
    const rows = await svc.tableRows();
    expect(rows[0]).toMatchObject({ name: 'Onb', scope: 'onboarding', scopeLabel: 'Default Onboarding Prefs.', count: 1 });
  });

  it('404s an unknown preset', async () => {
    await expect(svc.get('nope')).rejects.toThrow(PresetError);
  });
});

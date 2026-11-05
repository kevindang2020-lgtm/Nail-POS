import { describe, it, expect } from 'vitest';
import {
  ProfileService, DEFAULT_UI_PREFS, ALLOWED_LANDINGS,
  rowToUiPrefs, sanitizeUiPrefsPatch, mergeUiPrefs,
} from './profile.service';

// Like the other per-user prefs: raw-sql read/write fail soft to defaults on the harness fake db; the pure
// mapping/sanitize/merge logic is exercised directly. Live upsert is covered by the migration-136 PG smoke.
const ctx = { tenantId: 't1', userId: 'u1', role: 'OWNER' };

describe('ui-prefs pure helpers', () => {
  it('rowToUiPrefs maps default_landing; missing → overview default', () => {
    expect(rowToUiPrefs({ default_landing: 'customers' }).defaultLanding).toBe('customers');
    expect(rowToUiPrefs({}).defaultLanding).toBe('overview');
  });

  it('rowToUiPrefs rejects an unknown landing value → safe default', () => {
    expect(rowToUiPrefs({ default_landing: 'evil-route' }).defaultLanding).toBe('overview');
  });

  it('sanitizeUiPrefsPatch keeps only a valid landing, drops everything else', () => {
    expect(sanitizeUiPrefsPatch({ defaultLanding: 'reports', bogus: 1, tenantId: 'hax' })).toEqual({ defaultLanding: 'reports' });
    expect(sanitizeUiPrefsPatch({ defaultLanding: 'not-a-route' })).toEqual({});
    expect(sanitizeUiPrefsPatch({ defaultLanding: 123 })).toEqual({});
  });

  it('sanitizeUiPrefsPatch returns {} for non-object input', () => {
    expect(sanitizeUiPrefsPatch(null)).toEqual({});
    expect(sanitizeUiPrefsPatch(7)).toEqual({});
  });

  it('every ALLOWED_LANDINGS value survives sanitize (allow-list ↔ helpers stay in sync)', () => {
    for (const v of ALLOWED_LANDINGS) expect(sanitizeUiPrefsPatch({ defaultLanding: v })).toEqual({ defaultLanding: v });
  });

  it('mergeUiPrefs overlays patch without mutating the base', () => {
    const base = { ...DEFAULT_UI_PREFS };
    const merged = mergeUiPrefs(base, { defaultLanding: 'messages' });
    expect(merged.defaultLanding).toBe('messages');
    expect(base.defaultLanding).toBe('overview');
  });
});

describe('ProfileService ui-pref methods (fail-soft without a live db)', () => {
  it('getUiPrefs returns the overview default with no db or session', async () => {
    expect(await new ProfileService(null as any).getUiPrefs(ctx)).toEqual(DEFAULT_UI_PREFS);
    expect(await new ProfileService(null as any).getUiPrefs({})).toEqual(DEFAULT_UI_PREFS);
  });

  it('updateUiPrefs echoes the merged (sanitized) pref even when the write cannot run', async () => {
    expect(await new ProfileService(null as any).updateUiPrefs(ctx, { defaultLanding: 'reports' })).toEqual({ defaultLanding: 'reports' });
  });

  it('updateUiPrefs with an invalid/garbage patch returns the unchanged default', async () => {
    expect(await new ProfileService(null as any).updateUiPrefs(ctx, { defaultLanding: 'evil-route' })).toEqual(DEFAULT_UI_PREFS);
    expect(await new ProfileService(null as any).updateUiPrefs(ctx, 'x' as any)).toEqual(DEFAULT_UI_PREFS);
  });
});

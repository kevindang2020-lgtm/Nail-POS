// tenant-preset-core.ts — pure helpers for tenant/branch/onboarding default presets. No DB.

export const PRESET_SCOPES = ['tenant', 'branch', 'onboarding'] as const;
export type PresetScope = typeof PRESET_SCOPES[number];
export const SCOPE_LABEL: Record<PresetScope, string> = { tenant: 'Default Tenant Settings', branch: 'Default Branch Settings', onboarding: 'Default Onboarding Prefs.' };

export function isPresetScope(s: string): s is PresetScope { return (PRESET_SCOPES as readonly string[]).includes(s); }

export function validatePresetName(name: string): string | null {
  const n = (name || '').trim();
  if (n.length < 2) return 'Name must be at least 2 characters.';
  if (n.length > 80) return 'Name must be 80 characters or fewer.';
  if (/<\s*script/i.test(n)) return 'Name must not contain script.';
  return null;
}

/** Accept only a flat object of JSON-serialisable scalar/array/object values; cap the number of keys. */
export function sanitizeSettings(input: unknown, maxKeys = 200): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (n >= maxKeys) break;
    if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'undefined') continue;
    out[k] = v; n += 1;
  }
  return out;
}

export function settingsCount(settings: Record<string, unknown> | null | undefined): number {
  return settings && typeof settings === 'object' ? Object.keys(settings).length : 0;
}

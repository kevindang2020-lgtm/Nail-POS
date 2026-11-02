import { describe, it, expect } from 'vitest';
import {
  ProfileService, DEFAULT_LOGIN_ALERTS,
  rowToLoginAlerts, sanitizeLoginAlertsPatch, mergeLoginAlerts,
} from './profile.service';

// The login-alert read/write use raw sql, which the harness fake db can't execute — so getLoginAlerts/
// updateLoginAlerts fail soft to defaults here (the live upsert is covered by the migration-133 PG smoke).
// The mapping/sanitize/merge logic is pure and is exercised directly below.
const ctx = { tenantId: 't1', userId: 'u1', role: 'OWNER' };

describe('login-alert pure helpers', () => {
  it('rowToLoginAlerts maps snake_case columns to camelCase and fills missing with secure defaults', () => {
    const prefs = rowToLoginAlerts({ enabled: false, new_device: true, suspicious_blocked: false /* others absent */ });
    expect(prefs.enabled).toBe(false);
    expect(prefs.newDevice).toBe(true);
    expect(prefs.suspiciousBlocked).toBe(false);
    // absent columns fall back to the security-forward default (true)
    expect(prefs.newLocation).toBe(true);
    expect(prefs.passwordChanged).toBe(true);
    expect(prefs.recoveryCodesChanged).toBe(true);
  });

  it('rowToLoginAlerts coerces truthy/falsy db values (0/1, null) to booleans', () => {
    const prefs = rowToLoginAlerts({ enabled: 1 as any, new_device: 0 as any, email_changed: null as any });
    expect(prefs.enabled).toBe(true);
    expect(prefs.newDevice).toBe(false);
    expect(prefs.emailChanged).toBe(true); // null is treated as "absent" → default true
  });

  it('sanitizeLoginAlertsPatch keeps only known boolean keys and drops everything else', () => {
    const clean = sanitizeLoginAlertsPatch({ enabled: false, newDevice: true, bogus: true, passwordChanged: 'yes', userId: 'hax', twofaChanged: false });
    expect(clean).toEqual({ enabled: false, newDevice: true, twofaChanged: false });
  });

  it('sanitizeLoginAlertsPatch returns {} for non-object / null input', () => {
    expect(sanitizeLoginAlertsPatch(null)).toEqual({});
    expect(sanitizeLoginAlertsPatch('enabled')).toEqual({});
    expect(sanitizeLoginAlertsPatch(42)).toEqual({});
  });

  it('mergeLoginAlerts overlays a patch onto a base without mutating the base', () => {
    const base = { ...DEFAULT_LOGIN_ALERTS };
    const merged = mergeLoginAlerts(base, { enabled: false, newLocation: false });
    expect(merged.enabled).toBe(false);
    expect(merged.newLocation).toBe(false);
    expect(merged.newDevice).toBe(true);
    expect(base.enabled).toBe(true); // base untouched
  });
});

describe('ProfileService login-alert methods (fail-soft without a live db)', () => {
  it('getLoginAlerts returns secure defaults with no db or no session', async () => {
    expect(await new ProfileService(null as any).getLoginAlerts(ctx)).toEqual(DEFAULT_LOGIN_ALERTS);
    expect(await new ProfileService(null as any).getLoginAlerts({})).toEqual(DEFAULT_LOGIN_ALERTS);
  });

  it('updateLoginAlerts echoes the merged (sanitized) prefs even when the write cannot run', async () => {
    const out = await new ProfileService(null as any).updateLoginAlerts(ctx, { enabled: false, newDevice: false, bogus: 1 });
    expect(out).toEqual({ ...DEFAULT_LOGIN_ALERTS, enabled: false, newDevice: false });
  });

  it('updateLoginAlerts with an empty/garbage patch returns unchanged defaults', async () => {
    expect(await new ProfileService(null as any).updateLoginAlerts(ctx, {})).toEqual(DEFAULT_LOGIN_ALERTS);
    expect(await new ProfileService(null as any).updateLoginAlerts(ctx, 'nope' as any)).toEqual(DEFAULT_LOGIN_ALERTS);
  });
});

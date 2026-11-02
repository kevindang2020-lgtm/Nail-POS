import { describe, it, expect } from 'vitest';
import {
  ProfileService, DEFAULT_NOTIFICATION_PREFS,
  rowToNotificationPrefs, sanitizeNotificationPrefsPatch, mergeNotificationPrefs,
} from './profile.service';

// Like login alerts: raw-sql read/write fail soft to defaults on the harness fake db; the pure
// mapping/sanitize/merge logic is exercised directly. Live upsert is covered by the migration-134 PG smoke.
const ctx = { tenantId: 't1', userId: 'u1', role: 'OWNER' };

describe('notification-prefs pure helpers', () => {
  it('rowToNotificationPrefs maps snake_case columns to camelCase, missing → secure default (true)', () => {
    const prefs = rowToNotificationPrefs({ sms_notifications: false, low_stock_alerts: false /* others absent */ });
    expect(prefs.smsNotifications).toBe(false);
    expect(prefs.lowStockAlerts).toBe(false);
    expect(prefs.emailNotifications).toBe(true);
    expect(prefs.bookingAlerts).toBe(true);
    expect(prefs.weeklyReportSummaries).toBe(true);
  });

  it('rowToNotificationPrefs coerces 0/1/null', () => {
    const prefs = rowToNotificationPrefs({ sms_notifications: 1 as any, push_notifications: 0 as any, booking_alerts: null as any });
    expect(prefs.smsNotifications).toBe(true);
    expect(prefs.pushNotifications).toBe(false);
    expect(prefs.bookingAlerts).toBe(true); // null treated as absent → default
  });

  it('sanitizeNotificationPrefsPatch keeps only known boolean keys, drops the rest', () => {
    const clean = sanitizeNotificationPrefsPatch({ smsNotifications: false, payrollApprovals: true, bogus: true, tenantId: 'hax', emailNotifications: 'on' });
    expect(clean).toEqual({ smsNotifications: false, payrollApprovals: true });
  });

  it('sanitizeNotificationPrefsPatch returns {} for non-object input', () => {
    expect(sanitizeNotificationPrefsPatch(null)).toEqual({});
    expect(sanitizeNotificationPrefsPatch(7)).toEqual({});
  });

  it('mergeNotificationPrefs overlays patch without mutating the base', () => {
    const base = { ...DEFAULT_NOTIFICATION_PREFS };
    const merged = mergeNotificationPrefs(base, { smsNotifications: false });
    expect(merged.smsNotifications).toBe(false);
    expect(merged.emailNotifications).toBe(true);
    expect(base.smsNotifications).toBe(true);
  });
});

describe('ProfileService notification-pref methods (fail-soft without a live db)', () => {
  it('getNotificationPrefs returns all-on defaults with no db or session', async () => {
    expect(await new ProfileService(null as any).getNotificationPrefs(ctx)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(await new ProfileService(null as any).getNotificationPrefs({})).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it('updateNotificationPrefs echoes the merged (sanitized) prefs even when the write cannot run', async () => {
    const out = await new ProfileService(null as any).updateNotificationPrefs(ctx, { smsNotifications: false, lowStockAlerts: false, bogus: 1 });
    expect(out).toEqual({ ...DEFAULT_NOTIFICATION_PREFS, smsNotifications: false, lowStockAlerts: false });
  });

  it('updateNotificationPrefs with empty/garbage patch returns unchanged defaults', async () => {
    expect(await new ProfileService(null as any).updateNotificationPrefs(ctx, {})).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(await new ProfileService(null as any).updateNotificationPrefs(ctx, 'x' as any)).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });
});

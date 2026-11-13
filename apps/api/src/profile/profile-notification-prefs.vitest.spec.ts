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

describe('extras Customer Notifications 08 (round 10): personal quiet hours', () => {
  it('a patch sets both times, or clears both with null; half a window, equal times or a bad format are ignored', () => {
    expect(sanitizeNotificationPrefsPatch({ quietHoursStart: '22:00', quietHoursEnd: '07:00' })).toEqual({ quietHoursStart: '22:00', quietHoursEnd: '07:00' });
    expect(sanitizeNotificationPrefsPatch({ quietHoursStart: null, quietHoursEnd: null })).toEqual({ quietHoursStart: null, quietHoursEnd: null });
    for (const bad of [{ quietHoursStart: '22:00' }, { quietHoursStart: '22:00', quietHoursEnd: '22:00' }, { quietHoursStart: '25:00', quietHoursEnd: '07:00' }, { quietHoursStart: '22:00', quietHoursEnd: null }])
      expect(sanitizeNotificationPrefsPatch(bad)).toEqual({});
  });
  it('rowToNotificationPrefs reads both columns or neither; the default is off', () => {
    expect(rowToNotificationPrefs({ quiet_start: '21:30', quiet_end: '06:00' })).toMatchObject({ quietHoursStart: '21:30', quietHoursEnd: '06:00' });
    expect(rowToNotificationPrefs({ quiet_start: '21:30', quiet_end: null })).toMatchObject({ quietHoursStart: null, quietHoursEnd: null });
    expect(DEFAULT_NOTIFICATION_PREFS).toMatchObject({ quietHoursStart: null, quietHoursEnd: null });
  });
  it('the one window rule (api-contracts inQuietHours): overnight wraps midnight, the end minute is outside', async () => {
    const { inQuietHours } = await import('@aipowersalon/api-contracts/tenant');
    expect(inQuietHours(23 * 60, '22:00', '07:00')).toBe(true); expect(inQuietHours(6 * 60 + 59, '22:00', '07:00')).toBe(true);
    expect(inQuietHours(7 * 60, '22:00', '07:00')).toBe(false); expect(inQuietHours(12 * 60, '22:00', '07:00')).toBe(false);
    expect(inQuietHours(13 * 60, '12:00', '14:00')).toBe(true); expect(inQuietHours(14 * 60, '12:00', '14:00')).toBe(false);
    expect(inQuietHours(600, null, null)).toBe(false); expect(inQuietHours(600, '10:00', '10:00')).toBe(false);
  });
});

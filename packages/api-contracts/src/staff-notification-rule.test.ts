// staff-notification-rule.test.ts — extras round 11: the ONE staff notification-preference rule (tenant/me-prefs.ts).
import { describe, it, expect } from 'vitest';
import {
  staffNotificationAllowed, staffCategoryForPush, rowToNotificationPrefs, DEFAULT_NOTIFICATION_PREFS, NOTIFICATION_SWITCH_EFFECT,
  NOTIFICATION_PREF_COLUMNS, STAFF_NOTIFY_CATEGORIES, type NotificationPrefs,
} from './tenant/me-prefs';

const all = (over: Partial<NotificationPrefs> = {}): NotificationPrefs => ({ ...DEFAULT_NOTIFICATION_PREFS, ...over });

describe('staffNotificationAllowed', () => {
  it('no saved row (null) and all-on prefs send on every channel and category', () => {
    for (const ch of ['sms', 'email', 'push'] as const) for (const c of STAFF_NOTIFY_CATEGORIES) {
      expect(staffNotificationAllowed(null, ch, c).allowed).toBe(true);
      expect(staffNotificationAllowed(all(), ch, c)).toEqual({ allowed: true, reason: null, switchOff: null });
    }
  });
  it('a channel switch off holds that channel only, with reason staff_pref_off', () => {
    const p = all({ smsNotifications: false });
    expect(staffNotificationAllowed(p, 'sms', 'general')).toEqual({ allowed: false, reason: 'staff_pref_off', switchOff: 'smsNotifications' });
    expect(staffNotificationAllowed(p, 'email', 'general').allowed).toBe(true);
    expect(staffNotificationAllowed(p, 'push', 'booking').allowed).toBe(true);
    expect(staffNotificationAllowed(all({ pushNotifications: false }), 'push', 'booking').switchOff).toBe('pushNotifications');
    expect(staffNotificationAllowed(all({ emailNotifications: false }), 'email', 'weekly_report').switchOff).toBe('emailNotifications');
  });
  it('a category switch off holds that category on every channel; other categories still go', () => {
    const p = all({ bookingAlerts: false });
    for (const ch of ['sms', 'email', 'push'] as const) expect(staffNotificationAllowed(p, ch, 'booking')).toEqual({ allowed: false, reason: 'staff_pref_off', switchOff: 'bookingAlerts' });
    expect(staffNotificationAllowed(p, 'push', 'general').allowed).toBe(true);
    expect(staffNotificationAllowed(all({ payrollApprovals: false }), 'push', 'payroll_approval').switchOff).toBe('payrollApprovals');
    expect(staffNotificationAllowed(all({ missedCallAlerts: false }), 'sms', 'missed_call').switchOff).toBe('missedCallAlerts');
    expect(staffNotificationAllowed(all({ lowStockAlerts: false }), 'email', 'low_stock').switchOff).toBe('lowStockAlerts');
    expect(staffNotificationAllowed(all({ weeklyReportSummaries: false }), 'email', 'weekly_report').switchOff).toBe('weeklyReportSummaries');
  });
  it('general alerts obey only the channel switch (a category switch never silences them)', () => {
    const p = all({ bookingAlerts: false, missedCallAlerts: false, lowStockAlerts: false, payrollApprovals: false, weeklyReportSummaries: false });
    expect(staffNotificationAllowed(p, 'push', 'general').allowed).toBe(true);
  });
  it('security and account notices ALWAYS go, even with every switch off', () => {
    const off = all({ smsNotifications: false, emailNotifications: false, pushNotifications: false, bookingAlerts: false });
    for (const ch of ['sms', 'email', 'push'] as const) {
      expect(staffNotificationAllowed(off, ch, 'security').allowed).toBe(true);
      expect(staffNotificationAllowed(off, ch, 'account_notice').allowed).toBe(true);
    }
  });
  it('the channel switch is reported first when both are off', () => {
    expect(staffNotificationAllowed(all({ pushNotifications: false, bookingAlerts: false }), 'push', 'booking').switchOff).toBe('pushNotifications');
  });
});

describe('staffCategoryForPush', () => {
  it('maps typed pushes to what they are about', () => {
    expect(staffCategoryForPush('SECURITY')).toBe('security');
    expect(staffCategoryForPush('APPOINTMENT_CONFIRMATION', 'appointment_created')).toBe('booking');
    expect(staffCategoryForPush('BOOKING_CHANGE')).toBe('booking');
    expect(staffCategoryForPush('NEW_CUSTOMER', 'customer_arrived')).toBe('booking');
    expect(staffCategoryForPush('BUSINESS_ALERT', 'appointment_cancelled')).toBe('booking');
    expect(staffCategoryForPush('BUSINESS_ALERT', 'community_advisory')).toBe('general');
    expect(staffCategoryForPush('APPROVAL_REQUIRED', 'schedule_proposal')).toBe('booking');
    expect(staffCategoryForPush('PAYROLL', 'payroll_ready_for_review')).toBe('payroll_approval');
    expect(staffCategoryForPush('PAYROLL', 'payroll_submitted')).toBe('payroll_approval');
    expect(staffCategoryForPush('PAYROLL', 'payroll_returned')).toBe('payroll_approval');
    expect(staffCategoryForPush('PAYROLL', 'payroll_paid')).toBe('general');
    expect(staffCategoryForPush('QUEUE_ASSIGNMENT', 'queue_assignment')).toBe('general');
    expect(staffCategoryForPush(undefined)).toBe('general');
  });
});

describe('row mapping + switch effect', () => {
  it('rowToNotificationPrefs: missing → on, false → off, quiet hours both or neither', () => {
    expect(rowToNotificationPrefs({ sms_notifications: false })).toMatchObject({ smsNotifications: false, emailNotifications: true });
    expect(rowToNotificationPrefs({ quiet_start: '22:00', quiet_end: null })).toMatchObject({ quietHoursStart: null, quietHoursEnd: null });
  });
  it('every switch has a declared effect, and only switches with a live sender claim to be enforced', () => {
    expect(Object.keys(NOTIFICATION_SWITCH_EFFECT).sort()).toEqual(NOTIFICATION_PREF_COLUMNS.map(([f]) => f).sort());
    expect(NOTIFICATION_SWITCH_EFFECT.missedCallAlerts).toBe('no_sender');
    expect(NOTIFICATION_SWITCH_EFFECT.pushNotifications).toBe('enforced');
  });
});

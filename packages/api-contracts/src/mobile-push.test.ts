import { describe, it, expect } from 'vitest';
import { PUSH_CATEGORIES, PUSH_CATEGORY_NAMES, categoryTargetsApp, pushRouteData, routeFromPushData, PUSH_ROUTES, isPushApp, PUSH_PAYLOAD_SCHEMA_VERSION, pushPayloadVersion, parseNotificationMarkRequest, NOTIFICATION_MARK_MAX } from './mobile-push';

describe('§60 typed push categories', () => {
  it('has the constitution’s customer, technician and owner categories', () => {
    for (const c of ['APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'BOOKING_CHANGE', 'DEAL', 'LOYALTY', 'SECURITY',
      'QUEUE_ASSIGNMENT', 'SCHEDULE_CHANGE', 'NEW_CUSTOMER', 'SERVICE_ALERT',
      'BUSINESS_ALERT', 'PAYMENT_ALERT', 'QUEUE_CONGESTION', 'AI_INSIGHT', 'APPROVAL_REQUIRED']) expect(PUSH_CATEGORY_NAMES).toContain(c);
  });
  it('every category routes to a known in-app route and targets only known apps', () => {
    for (const c of PUSH_CATEGORY_NAMES) {
      expect(PUSH_ROUTES).toContain(PUSH_CATEGORIES[c].route);
      for (const a of PUSH_CATEGORIES[c].apps) expect(isPushApp(a)).toBe(true);
    }
  });
});

describe('per-app targeting', () => {
  it('a technician queue push never reaches the customer app on the same person’s phone', () => {
    expect(categoryTargetsApp('QUEUE_ASSIGNMENT', 'tech')).toBe(true);
    expect(categoryTargetsApp('QUEUE_ASSIGNMENT', 'customer')).toBe(false);
    expect(categoryTargetsApp('APPOINTMENT_REMINDER', 'tech')).toBe(false);
    expect(categoryTargetsApp('APPROVAL_REQUIRED', 'manager')).toBe(true);
    expect(categoryTargetsApp('SECURITY', 'owner')).toBe(true);
  });
  it('a legacy token with no app id is still delivered to', () => { expect(categoryTargetsApp('QUEUE_ASSIGNMENT', null)).toBe(true); });
});

describe('§62 safe routes', () => {
  it('the server writes category + route + whitelisted id params only', () => {
    const d = pushRouteData('BOOKING_CHANGE', { appointmentId: 'a1', customerName: 'Jane Doe', other: 'x' } as any);
    expect(d).toEqual({ v: '1', category: 'BOOKING_CHANGE', route: 'appointment', appointmentId: 'a1' });
  });
  it('an id that is not an id is dropped (no URL, no script)', () => {
    expect(pushRouteData('BOOKING_CHANGE', { appointmentId: 'https://evil.example/x' })).toEqual({ v: '1', category: 'BOOKING_CHANGE', route: 'appointment' });
  });
  it('the client reads only closed-list routes', () => {
    expect(routeFromPushData({ category: 'QUEUE_ASSIGNMENT', route: 'queue', queueItemId: 'q1' })).toEqual({ name: 'queue', params: { queueItemId: 'q1' } });
    expect(routeFromPushData({ route: 'admin-panel' })).toBeNull();
    expect(routeFromPushData({ category: 'APPROVAL_REQUIRED' })).toEqual({ name: 'approvals', params: {} });
    expect(routeFromPushData({})).toBeNull();
    expect(routeFromPushData(null)).toBeNull();
  });
});

describe('extras Customer Notifications 01 (round 10): payload schema version + one read / acknowledge contract', () => {
  it('every typed push carries v; a legacy payload (no v) still routes; a NEWER version is never guessed at', () => {
    expect(pushRouteData('QUEUE_ASSIGNMENT', { queueItemId: 'q1' }).v).toBe(String(PUSH_PAYLOAD_SCHEMA_VERSION));
    expect(pushPayloadVersion({})).toBe(1); expect(pushPayloadVersion({ v: 'x' })).toBe(1); expect(pushPayloadVersion({ v: '2' })).toBe(2);
    expect(routeFromPushData({ category: 'QUEUE_ASSIGNMENT', route: 'queue', queueItemId: 'q1' })).toEqual({ name: 'queue', params: { queueItemId: 'q1' } });   // legacy
    expect(routeFromPushData({ ...pushRouteData('QUEUE_ASSIGNMENT', { queueItemId: 'q1' }) })).toEqual({ name: 'queue', params: { queueItemId: 'q1' } });
    expect(routeFromPushData({ v: String(PUSH_PAYLOAD_SCHEMA_VERSION + 1), category: 'QUEUE_ASSIGNMENT', route: 'queue', queueItemId: 'q1' })).toBeNull();
  });
  it('a mark request: 1–200 well-formed unique ids and read | acknowledge, else refused', () => {
    expect(parseNotificationMarkRequest({ notificationIds: ['n1', 'n2'], action: 'read' })).toEqual({ notificationIds: ['n1', 'n2'], action: 'read' });
    expect(parseNotificationMarkRequest({ notificationIds: ['n1'], action: 'acknowledge' })?.action).toBe('acknowledge');
    expect(parseNotificationMarkRequest({ notificationIds: ['n1', 'n1'], action: 'read' })).toEqual({ notificationIds: ['n1'], action: 'read' });   // deduplicated
    for (const bad of [null, {}, { notificationIds: [], action: 'read' }, { notificationIds: ['n1'], action: 'delete' }, { notificationIds: ['n1', 42], action: 'read' },
      { notificationIds: ['https://x'], action: 'read' }, { notificationIds: Array.from({ length: NOTIFICATION_MARK_MAX + 1 }, (_, i) => 'n' + i), action: 'read' }])
      expect(parseNotificationMarkRequest(bad)).toBeNull();
  });
});

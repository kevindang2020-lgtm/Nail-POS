import { describe, it, expect } from 'vitest';
import { PUSH_CATEGORIES, PUSH_CATEGORY_NAMES, categoryTargetsApp, pushRouteData, routeFromPushData, PUSH_ROUTES, isPushApp } from './mobile-push';

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
    expect(d).toEqual({ category: 'BOOKING_CHANGE', route: 'appointment', appointmentId: 'a1' });
  });
  it('an id that is not an id is dropped (no URL, no script)', () => {
    expect(pushRouteData('BOOKING_CHANGE', { appointmentId: 'https://evil.example/x' })).toEqual({ category: 'BOOKING_CHANGE', route: 'appointment' });
  });
  it('the client reads only closed-list routes', () => {
    expect(routeFromPushData({ category: 'QUEUE_ASSIGNMENT', route: 'queue', queueItemId: 'q1' })).toEqual({ name: 'queue', params: { queueItemId: 'q1' } });
    expect(routeFromPushData({ route: 'admin-panel' })).toBeNull();
    expect(routeFromPushData({ category: 'APPROVAL_REQUIRED' })).toEqual({ name: 'approvals', params: {} });
    expect(routeFromPushData({})).toBeNull();
    expect(routeFromPushData(null)).toBeNull();
  });
});

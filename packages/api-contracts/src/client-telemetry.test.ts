import { describe, it, expect } from 'vitest';
import { sanitizeAnalyticsEvent, sanitizePerfMark, sanitizeTelemetryBatch, normaliseClientRoute, ANALYTICS_EVENTS, TELEMETRY_LIMITS } from './client-telemetry';

// The privacy proof (Constitution 6 §116, §118; Kevin's Phase 13 rule): analytics carry ALLOW-LISTED props only. Every
// PII-shaped thing a screen could hand to track() is dropped — by key (not on the list) and by value (an allowed key
// whose value looks like an email, a phone, a card, a uuid or free text).
const PII = {
  email: 'jane.doe@example.com', phone: '+1 (856) 555-0142', name: 'Jane Doe', customerName: 'Jane Doe', fullName: 'Jane Doe',
  password: 'hunter2', otp: '123456', card: '4111 1111 1111 1111', note: 'allergic to acetone', token: 'eyJhbGciOi.x.y',
  customerId: '7d5b5c2e-1b7c-4f43-9a8e-0b8e7b1c2d3e', address: '1 Main St',
};

describe('client telemetry — analytics allowlist', () => {
  it('drops an event that is not on the list', () => {
    expect(sanitizeAnalyticsEvent('customer_profile_viewed', { screen: 'home' })).toBeNull();
    expect(sanitizeAnalyticsEvent('__proto__', {})).toBeNull();
  });

  it('keeps only allow-listed props; every PII key is dropped', () => {
    const e = sanitizeAnalyticsEvent('booking_started', { source: 'home', ...PII });
    expect(e).toEqual({ name: 'booking_started', props: { source: 'home' } });
    const json = JSON.stringify(e);
    for (const v of Object.values(PII)) expect(json).not.toContain(v);
  });

  it('a prop listed for ANOTHER event is dropped', () => {
    expect(sanitizeAnalyticsEvent('booking_started', { source: 'home', language: 'en', screen: '/home' })?.props).toEqual({ source: 'home' });
  });

  it('drops PII-shaped VALUES even under an allowed key', () => {
    for (const v of Object.values(PII)) {
      const e = sanitizeAnalyticsEvent('booking_started', { source: v });
      expect(e?.props).toEqual({});
    }
  });

  it('normalises a screen route: ids and query strings never leave', () => {
    expect(sanitizeAnalyticsEvent('screen_viewed', { screen: '/appointments/7d5b5c2e-1b7c-4f43-9a8e-0b8e7b1c2d3e?phone=8565550142#x' }))
      .toEqual({ name: 'screen_viewed', props: { screen: '/appointments/:id' } });
    expect(normaliseClientRoute('/tickets/12345/edit')).toBe('/tickets/:n/edit');
  });

  it('booleans and small finite numbers pass; big numbers (an id, a phone as a number) do not', () => {
    expect(sanitizeAnalyticsEvent('notification_opened', { category: 'appointment', fromBackground: true })?.props)
      .toEqual({ category: 'appointment', fromBackground: true });
    expect(sanitizeAnalyticsEvent('booking_completed_ui', { source: 'deal', services: 3 })?.props).toEqual({ source: 'deal', services: 3 });
    expect(sanitizeAnalyticsEvent('booking_completed_ui', { source: 'deal', services: 8565550142 })?.props).toEqual({ source: 'deal' });
  });

  it('every allow-listed prop name is itself not PII-shaped', () => {
    for (const props of Object.values(ANALYTICS_EVENTS)) for (const p of props) expect(p).not.toMatch(/name|email|phone|card|password|otp|token|note|address/i);
  });
});

describe('client telemetry — perf marks and batches', () => {
  it('keeps known metrics with bounded ms and allow-listed labels only', () => {
    expect(sanitizePerfMark({ metric: 'api_latency', ms: 123.4, labels: { timeoutClass: 'fast', outcome: 'ok', url: '/customers/jane@x.com' } }))
      .toEqual({ metric: 'api_latency', ms: 123, labels: { timeoutClass: 'fast', outcome: 'ok' } });
    expect(sanitizePerfMark({ metric: 'api_latency', ms: -1 })).toBeNull();
    expect(sanitizePerfMark({ metric: 'api_latency', ms: Number.NaN })).toBeNull();
    expect(sanitizePerfMark({ metric: 'heap_dump', ms: 5 })).toBeNull();
    expect(sanitizePerfMark({ metric: 'launch_to_first_screen', ms: 900, labels: { screen: '/visit/123' } })?.labels).toEqual({ screen: '/visit/:n' });
  });

  it('a batch keeps app/version/platform labels, drops unknown apps, caps sizes', () => {
    const many = Array.from({ length: 200 }, () => ({ name: 'screen_viewed', props: { screen: '/home' } }));
    const b = sanitizeTelemetryBatch({ app: 'tech', version: '1.6.0', platform: 'android', events: many, perf: [], email: PII.email });
    expect(b?.app).toBe('tech'); expect(b?.platform).toBe('android'); expect(b?.version).toBe('1.6.0');
    expect(b?.events.length).toBe(TELEMETRY_LIMITS.eventsPerBatch);
    expect(JSON.stringify(b)).not.toContain(PII.email);
    expect(sanitizeTelemetryBatch({ app: 'evil', version: '1', platform: 'ios', events: [] })).toBeNull();
    expect(sanitizeTelemetryBatch({ app: 'owner', version: '<script>', platform: 'symbian', events: [] }))
      .toMatchObject({ version: 'unknown', platform: 'unknown' });
  });
});

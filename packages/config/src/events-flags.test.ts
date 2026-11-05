import { describe, it, expect } from 'vitest';
import { eventPublisherEnabled, projectionDeliversRealtime } from './events-flags';

describe('realtime delivery path (Constitution 8 / 13 §343)', () => {
  it('development and tests: off unless EVENT_PUBLISHER_ENABLED is truthy', () => {
    expect(eventPublisherEnabled({})).toBe(false);
    expect(eventPublisherEnabled({ NODE_ENV: 'test' })).toBe(false);
    for (const v of ['1', 'true', 'YES', ' on ']) expect(eventPublisherEnabled({ EVENT_PUBLISHER_ENABLED: v })).toBe(true);
  });
  it('production (Oct 3 2026): ON by default; only an explicit off switches it off', () => {
    expect(eventPublisherEnabled({ NODE_ENV: 'production' })).toBe(true);
    for (const v of ['0', 'false', 'NO', ' off ']) expect(eventPublisherEnabled({ NODE_ENV: 'production', EVENT_PUBLISHER_ENABLED: v })).toBe(false);
    expect(projectionDeliversRealtime(true, { NODE_ENV: 'production' })).toBe(true);
  });
  it('an outbox alone does NOT mean the projection delivers — the publisher must be on (the bug this fixes)', () => {
    expect(projectionDeliversRealtime(true, {})).toBe(false);
    expect(projectionDeliversRealtime(true, { EVENT_PUBLISHER_ENABLED: '1' })).toBe(true);
    expect(projectionDeliversRealtime(false, { EVENT_PUBLISHER_ENABLED: '1' })).toBe(false);
  });
  it('POST_RESTORE_HOLD suppresses publisher even in production until acknowledged', () => {
    expect(eventPublisherEnabled({ NODE_ENV: 'production', POST_RESTORE_HOLD: '1' })).toBe(false);
    expect(eventPublisherEnabled({ NODE_ENV: 'production', POST_RESTORE_HOLD: 'true' })).toBe(false);
    expect(eventPublisherEnabled({ NODE_ENV: 'production', POST_RESTORE_HOLD: 'off' })).toBe(true);
  });
});


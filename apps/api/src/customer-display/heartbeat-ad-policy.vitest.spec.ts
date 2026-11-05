// heartbeat-ad-policy — G7 Global Advertising (Nov 5 2026): the display's heartbeat carries the advertising policy it
// APPLIED; only a well-formed acknowledgment is kept (anything else is simply not an ACK, never an error).
import { describe, it, expect } from 'vitest';
import { parseHeartbeat } from './display-devices.service';

const base = { mode: 'advertisement', appVersion: '1.2.3', screen: { width: 1920, height: 1080, pixelRatio: 1 }, profile: 'CUSTOMER_DISPLAY_23_LANDSCAPE' };
describe('heartbeat advertising acknowledgment', () => {
  it('keeps a valid { version, mode }', () => {
    expect(parseHeartbeat({ ...base, adPolicy: { version: 3, mode: 'PLATFORM_ONLY' } }).adPolicy).toEqual({ version: 3, mode: 'PLATFORM_ONLY' });
  });
  it('drops a malformed or absent one', () => {
    expect(parseHeartbeat(base).adPolicy).toBeNull();
    expect(parseHeartbeat({ ...base, adPolicy: { version: 'x', mode: 'PLATFORM_ONLY' } }).adPolicy).toBeNull();
    expect(parseHeartbeat({ ...base, adPolicy: { version: 2, mode: 'MIXED' } }).adPolicy).toBeNull();
  });
});

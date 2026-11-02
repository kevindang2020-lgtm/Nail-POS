// display-device-rules.test.ts — 23-inch dual-screen spec §8, §85, §87, §97: the device rules the server, the POS and the
// display all read. Pinned here directly — the service tests use them, but a precedence slip (MAINTENANCE vs CHECKOUT, an
// OFFLINE display reported as busy) or a mask that leaks one digit more must fail at the rule itself.
import { describe, it, expect } from 'vitest';
import {
  DISPLAY_ONLINE_WINDOW_MS, DISPLAY_HEARTBEAT_MS, formatPairingCode, normalizePairingCode, displayProfileFor, displayDeviceState,
  maskPhone, maskEmail, type DisplayDeviceFacts,
} from './display-device-rules';

const NOW = Date.parse('2026-10-06T15:00:00Z');
const facts = (over: Partial<DisplayDeviceFacts> = {}): DisplayDeviceFacts => ({ revoked: false, maintenance: false, lastSeenMs: NOW - 1_000, reportedMode: null, hasActiveSession: false, ...over });

describe('pairing codes (§8)', () => {
  it('shown as two groups of four; whatever staff type is read back as the 8 digits, or refused', () => {
    expect(formatPairingCode('48291374')).toBe('4829 1374');
    for (const typed of ['48291374', '4829 1374', ' 4829-1374 ', '4829\t1374']) expect(normalizePairingCode(typed)).toBe('48291374');
    for (const bad of ['1234', '482913745', '4829 137a', '', null, undefined, 48291374.5]) expect(normalizePairingCode(bad)).toBeNull();
  });
});

describe('the device state (§85) — one rule for every screen', () => {
  it('REVOKED, then MAINTENANCE, then OFFLINE, then what it is doing', () => {
    expect(displayDeviceState(facts({ revoked: true, maintenance: true, hasActiveSession: true }), NOW)).toBe('REVOKED');
    expect(displayDeviceState(facts({ maintenance: true, hasActiveSession: true, reportedMode: 'checkout' }), NOW)).toBe('MAINTENANCE');
    expect(displayDeviceState(facts({ maintenance: true, lastSeenMs: null }), NOW)).toBe('MAINTENANCE');   // the owner's switch shows even while it is off
    expect(displayDeviceState(facts({ lastSeenMs: null, hasActiveSession: true }), NOW)).toBe('OFFLINE');   // a checkout on a dead screen is not "busy"
  });
  it('online for the window after its last word — not a millisecond longer', () => {
    expect(DISPLAY_ONLINE_WINDOW_MS).toBeGreaterThan(2 * DISPLAY_HEARTBEAT_MS);   // two missed beats before it is called offline
    expect(displayDeviceState(facts({ lastSeenMs: NOW - DISPLAY_ONLINE_WINDOW_MS }), NOW)).toBe('ONLINE');
    expect(displayDeviceState(facts({ lastSeenMs: NOW - DISPLAY_ONLINE_WINDOW_MS - 1 }), NOW)).toBe('OFFLINE');
  });
  it('a checkout attached on the server is CHECKOUT whatever the display last said; otherwise its own report', () => {
    expect(displayDeviceState(facts({ hasActiveSession: true, reportedMode: 'advertisement' }), NOW)).toBe('CHECKOUT');
    expect(displayDeviceState(facts({ reportedMode: 'checkout' }), NOW)).toBe('CHECKOUT');
    expect(displayDeviceState(facts({ reportedMode: 'check_in' }), NOW)).toBe('CHECK_IN');
    expect(displayDeviceState(facts({ reportedMode: 'advertisement' }), NOW)).toBe('ADVERTISEMENT');
    expect(displayDeviceState(facts({ reportedMode: 'idle' }), NOW)).toBe('ONLINE');
    expect(displayDeviceState(facts(), NOW)).toBe('ONLINE');
  });
});

describe('the display profile (§87–§88) — from the viewport, never from inches', () => {
  it('a landscape screen of at least 1366×768 runs the 23-inch layout; smaller landscape and portrait do not', () => {
    expect(displayProfileFor(1920, 1080)).toBe('CUSTOMER_DISPLAY_23_LANDSCAPE');
    expect(displayProfileFor(1366, 768)).toBe('CUSTOMER_DISPLAY_23_LANDSCAPE');
    expect(displayProfileFor(1365, 768)).toBe('LANDSCAPE');
    expect(displayProfileFor(1280, 800)).toBe('LANDSCAPE');
    expect(displayProfileFor(768, 1024)).toBe('PORTRAIT_TABLET');
    expect(displayProfileFor(0, 0)).toBe('LANDSCAPE');
  });
});

describe('receipt destinations are masked (§97) — the screen faces the room', () => {
  it('a phone shows its last four digits only; anything unusable is no destination at all', () => {
    for (const p of ['+1 (215) 555-0142', '2155550142', '215.555.0142']) expect(maskPhone(p)).toBe('(•••) •••-0142');
    for (const bad of ['555012', '', null, undefined, 'call me']) expect(maskPhone(bad)).toBeNull();
    expect(maskPhone('2155550142')).not.toMatch(/215|555/);
  });
  it('an email shows its first letter and its domain only', () => {
    expect(maskEmail('sophia.lee@gmail.com')).toBe('s•••@gmail.com');
    expect(maskEmail('  Sophia.Lee@Gmail.COM ')).toBe('S•••@gmail.com');
    expect(maskEmail('sophia.lee@gmail.com')).not.toContain('ophia');
    for (const bad of ['not-an-email', 'a@b', '@gmail.com', 'two words@x.com', '', null]) expect(maskEmail(bad)).toBeNull();
  });
});

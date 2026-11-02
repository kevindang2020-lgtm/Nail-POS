import { describe, it, expect } from 'vitest';
import { terminalOperationalStatus } from './payment-terminals';

const NOW = new Date('2026-10-13T12:00:00Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe('terminalOperationalStatus (§12 / §50) — one normalized status, fixed clock', () => {
  it('DISABLED wins over everything (a disabled terminal with a live lease is still disabled)', () => {
    expect(terminalOperationalStatus({ paired: true, disabledAt: ago(1), leaseHolder: 'ticket:1', lastSeenAt: ago(1) }, NOW)).toBe('DISABLED');
  });
  it('unpaired → OFFLINE', () => { expect(terminalOperationalStatus({ paired: false, lastSeenAt: ago(1) }, NOW)).toBe('OFFLINE'); });
  it('a charge holding the lease → PROCESSING; another holder → BUSY', () => {
    expect(terminalOperationalStatus({ paired: true, leaseHolder: 'ticket:abc', lastSeenAt: ago(1) }, NOW)).toBe('PROCESSING');
    expect(terminalOperationalStatus({ paired: true, leaseHolder: 'display:s1', lastSeenAt: ago(1) }, NOW)).toBe('PROCESSING');
    expect(terminalOperationalStatus({ paired: true, leaseHolder: 'test:u1', lastSeenAt: ago(1) }, NOW)).toBe('BUSY');
  });
  it('never heard from → UNKNOWN; answered within 15 min → ONLINE; older → DEGRADED', () => {
    expect(terminalOperationalStatus({ paired: true }, NOW)).toBe('UNKNOWN');
    expect(terminalOperationalStatus({ paired: true, lastSeenAt: ago(14) }, NOW)).toBe('ONLINE');
    expect(terminalOperationalStatus({ paired: true, lastSeenAt: ago(16) }, NOW)).toBe('DEGRADED');
  });
  it('a failed ping AFTER the last success → OFFLINE; a failed ping BEFORE a later success does not count', () => {
    expect(terminalOperationalStatus({ paired: true, lastSeenAt: ago(30), lastPingAt: ago(2), lastPingOk: false }, NOW)).toBe('OFFLINE');
    expect(terminalOperationalStatus({ paired: true, lastSeenAt: ago(1), lastPingAt: ago(2), lastPingOk: false }, NOW)).toBe('ONLINE');
    expect(terminalOperationalStatus({ paired: true, lastPingAt: ago(2), lastPingOk: false }, NOW)).toBe('OFFLINE');
  });
  it('ignores garbage timestamps instead of guessing', () => {
    expect(terminalOperationalStatus({ paired: true, lastSeenAt: 'not a date' }, NOW)).toBe('UNKNOWN');
  });
});

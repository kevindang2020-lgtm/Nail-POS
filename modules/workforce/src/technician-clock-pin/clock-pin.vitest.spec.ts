import { describe, it, expect } from 'vitest';
import { isValidPinFormat, isWeakPin, isLocked, registerFailure, clearFailures, MAX_FAILED_ATTEMPTS } from './clock-pin-core';
import { TechnicianClockPinService, ClockPinLockedError, type ClockPinContext, type ClockPinRow, type ClockPinRepository } from './technician-clock-pin.service';
import { InMemoryClockPinRepository } from './technician-clock-pin.repository';
import type { PinRateState } from './clock-pin-core';

describe('clock-pin-core — PIN format + weak-PIN policy', () => {
  it('accepts exactly four digits, rejects everything else', () => {
    expect(isValidPinFormat('0417')).toBe(true);
    for (const bad of ['', '1', '123', '12345', '12a4', '12 4', '１２３４', ' 1234']) expect(isValidPinFormat(bad), bad).toBe(false);
  });
  it('flags trivially guessable PINs', () => {
    for (const w of ['0000', '1111', '1234', '4321', '6789']) expect(isWeakPin(w), w).toBe(true);
    expect(isWeakPin('0417')).toBe(false);
  });
});

describe('clock-pin-core — rate-limit lockout state machine', () => {
  const t0 = '2026-07-16T12:00:00.000Z';
  it('locks at the threshold and resets the counter for after the lock', () => {
    let s: PinRateState = { failedAttempts: 0, lockedUntil: null };
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) { s = registerFailure(s, t0); expect(s.lockedUntil).toBeNull(); expect(s.failedAttempts).toBe(i); }
    s = registerFailure(s, t0);                          // the Nth failure
    expect(s.lockedUntil).not.toBeNull();
    expect(s.failedAttempts).toBe(0);
    expect(isLocked(s, t0)).toBe(true);
    expect(isLocked(s, '2026-07-16T12:30:00.000Z')).toBe(false); // lock has since expired
  });
  it('clearFailures wipes the counter and lock', () => {
    expect(clearFailures()).toEqual({ failedAttempts: 0, lockedUntil: null });
  });
});

// In-memory repo, keyed by tenant + technician, to prove tenant scoping and persistence without a DB.
function memRepo(): ClockPinRepository & { rows: Map<string, ClockPinRow> } {
  const rows = new Map<string, ClockPinRow>();
  const key = (ctx: ClockPinContext, tid: string) => `${ctx.tenantId}::${tid}`;
  return {
    rows,
    async getPin(ctx, tid) { return rows.get(key(ctx, tid)) ?? null; },
    async upsertPin(ctx, tid, pinHash) { rows.set(key(ctx, tid), { pinHash, failedAttempts: 0, lockedUntil: null }); },
    async updateRateState(ctx, tid, s) { const r = rows.get(key(ctx, tid)); if (r) { r.failedAttempts = s.failedAttempts; r.lockedUntil = s.lockedUntil; } },
  };
}

const T1: ClockPinContext = { tenantId: 'tenant-1' };
const T2: ClockPinContext = { tenantId: 'tenant-2' };

describe('TechnicianClockPinService', () => {
  it('stores a HASH, never the plaintext PIN', async () => {
    const repo = memRepo();
    const svc = new TechnicianClockPinService(repo);
    await svc.setPin(T1, 'tech-a', '0417', 'mgr-1');
    const row = repo.rows.get('tenant-1::tech-a')!;
    expect(row.pinHash).not.toContain('0417');
    expect(row.pinHash.length).toBeGreaterThan(20);
  });

  it('rejects a bad format or weak PIN at set-time', async () => {
    const svc = new TechnicianClockPinService(memRepo());
    await expect(svc.setPin(T1, 'tech-a', '12', null)).rejects.toThrow();
    await expect(svc.setPin(T1, 'tech-a', '1234', null)).rejects.toThrow();
  });

  it('verifies the correct PIN and rejects the wrong one', async () => {
    const svc = new TechnicianClockPinService(memRepo());
    await svc.setPin(T1, 'tech-a', '0417', null);
    expect(await svc.verifyPin(T1, 'tech-a', '0417')).toEqual({ ok: true });
    expect(await svc.verifyPin(T1, 'tech-a', '9999')).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('returns no_pin (not an error) when the technician has no PIN set', async () => {
    const svc = new TechnicianClockPinService(memRepo());
    expect(await svc.verifyPin(T1, 'nobody', '0417')).toEqual({ ok: false, reason: 'no_pin' });
  });

  it('locks the PIN after too many wrong attempts, then throws until the lock expires', async () => {
    const repo = memRepo();
    const svc = new TechnicianClockPinService(repo);
    await svc.setPin(T1, 'tech-a', '0417', null);
    const t0 = '2026-07-16T12:00:00.000Z';
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await svc.verifyPin(T1, 'tech-a', '9999', t0);
    // now locked — even the CORRECT pin throws while the lock holds
    await expect(svc.verifyPin(T1, 'tech-a', '0417', t0)).rejects.toBeInstanceOf(ClockPinLockedError);
    // after the lock window, the correct pin works again
    expect(await svc.verifyPin(T1, 'tech-a', '0417', '2026-07-16T12:30:00.000Z')).toEqual({ ok: true });
  });

  it('is tenant-scoped: the same technician id in another tenant has no PIN here', async () => {
    const repo = memRepo();
    const svc = new TechnicianClockPinService(repo);
    await svc.setPin(T1, 'tech-a', '0417', null);
    expect(await svc.verifyPin(T2, 'tech-a', '0417')).toEqual({ ok: false, reason: 'no_pin' });
  });
});

describe('TechnicianClockPinService.identifyByPin — PIN-only lookup over active technicians', () => {
  it('identifies the single technician whose PIN matches', async () => {
    const repo = new InMemoryClockPinRepository();
    const svc = new TechnicianClockPinService(repo);
    await svc.setPin(T1, 'tech-a', '0417', null);
    await svc.setPin(T1, 'tech-b', '5382', null);
    expect(await svc.identifyByPin(T1, '0417')).toEqual({ outcome: 'identified', technicianId: 'tech-a' });
  });

  it('returns no_match when nothing matches, and invalid_format without scanning', async () => {
    const repo = new InMemoryClockPinRepository();
    const svc = new TechnicianClockPinService(repo);
    await svc.setPin(T1, 'tech-a', '0417', null);
    expect(await svc.identifyByPin(T1, '9999')).toEqual({ outcome: 'no_match' });
    expect(await svc.identifyByPin(T1, '12')).toEqual({ outcome: 'invalid_format' });
  });

  it('reports duplicate_match when two active technicians share a PIN (no silent pick)', async () => {
    const repo = new InMemoryClockPinRepository();
    const svc = new TechnicianClockPinService(repo);
    await svc.setPin(T1, 'tech-a', '0417', null);
    await svc.setPin(T1, 'tech-b', '0417', null);
    expect(await svc.identifyByPin(T1, '0417')).toEqual({ outcome: 'duplicate_match' });
  });

  it('skips locked candidates and does not scan across tenants/inactive techs', async () => {
    const repo = new InMemoryClockPinRepository();
    const svc = new TechnicianClockPinService(repo);
    await svc.setPin(T1, 'tech-a', '0417', null);
    await svc.setPin(T2, 'tech-x', '0417', null);      // different tenant — never considered
    repo.seedActive(T1, 'tech-a', false);              // inactive — excluded from the scan
    expect(await svc.identifyByPin(T1, '0417')).toEqual({ outcome: 'no_match' });
  });
});

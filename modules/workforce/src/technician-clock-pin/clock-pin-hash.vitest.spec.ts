// clock-pin-hash.vitest.spec.ts — M4-1 (Kevin's decision, Oct 26 2026: lower the Clock PIN hash cost). What this pins:
//   • a PIN hashed before M4-1 (the password cost, N = 16384) still verifies, and is flagged for re-hash;
//   • a PIN hashed now is at the PIN cost (N = 2048) and is not flagged;
//   • the service re-hashes an old-cost hash TRANSPARENTLY on the next successful verifyPin / identifyByPin — the
//     lookup digest, the attempt counters and the lockout are untouched; a wrong PIN re-hashes nothing;
//   • the PIN-cost verification is several times cheaper than the password-cost one (a relative bound, so a loaded CI
//     host cannot fail it for the wrong reason, plus a loose absolute one).
import { describe, it, expect } from 'vitest';
import { hashPassword } from '@aipowersalon/auth';
import { hashClockPin, verifyClockPin, clockPinNeedsRehash, clockPinHashParams, CLOCK_PIN_SCRYPT } from './clock-pin-hash';
import { TechnicianClockPinService } from './technician-clock-pin.service';
import { InMemoryClockPinRepository } from './technician-clock-pin.repository';
import { pinLookupKey } from './clock-pin-lookup';

const ctx = { tenantId: 'tenant-pin-cost', branchId: null };
const K = pinLookupKey('test-key-pin-cost-0123456789abcdef');

describe('clock-pin-hash — versioned by the stored parameters', () => {
  it('an old (password-cost) hash verifies and needs a re-hash; a new one is at the PIN cost and does not', async () => {
    const old = await hashPassword('2580');
    expect(clockPinHashParams(old)).toEqual({ N: 16384, r: 8, p: 1 });
    expect(await verifyClockPin('2580', old)).toBe(true);
    expect(await verifyClockPin('2581', old)).toBe(false);
    expect(clockPinNeedsRehash(old)).toBe(true);
    const fresh = await hashClockPin('2580');
    expect(fresh.startsWith(`scrypt$${CLOCK_PIN_SCRYPT.N}$${CLOCK_PIN_SCRYPT.r}$${CLOCK_PIN_SCRYPT.p}$`)).toBe(true);
    expect(clockPinHashParams(fresh)).toEqual({ N: 2048, r: 8, p: 1 });
    expect(await verifyClockPin('2580', fresh)).toBe(true);
    expect(await verifyClockPin('2581', fresh)).toBe(false);
    expect(clockPinNeedsRehash(fresh)).toBe(false);
    expect(fresh).not.toBe(await hashClockPin('2580'));   // salted
    expect(fresh).not.toContain('2580');
  });
  it('garbage never verifies and is flagged for re-hash (it will be replaced by a real hash on a successful match of nothing — never)', async () => {
    for (const bad of ['', 'not-a-hash', 'scrypt$only$three', 'bcrypt$16384$8$1$x$y', 'scrypt$0$8$1$x$y']) {
      expect(await verifyClockPin('2580', bad)).toBe(false);
      expect(clockPinNeedsRehash(bad)).toBe(true);
    }
  });
  it('PIN-cost verification is at least 3× cheaper than password-cost verification (and under 60 ms each here)', async () => {
    const old = await hashPassword('2580'), fresh = await hashClockPin('2580');
    const median = async (stored: string) => {
      const t: number[] = [];
      for (let i = 0; i < 9; i++) { const t0 = process.hrtime.bigint(); await verifyClockPin('2580', stored); t.push(Number(process.hrtime.bigint() - t0) / 1e6); }
      return t.sort((a, b) => a - b)[4];
    };
    const oldMs = await median(old), freshMs = await median(fresh);
    expect(freshMs, `old ${oldMs.toFixed(1)} ms, PIN cost ${freshMs.toFixed(1)} ms`).toBeLessThan(oldMs / 3);
    expect(freshMs).toBeLessThan(60);
  }, 30_000);
});

describe('TechnicianClockPinService — transparent re-hash on the next successful clock-in', () => {
  const seedOld = async (repo: InMemoryClockPinRepository, technicianId: string, pin: string) => {
    await repo.upsertPin(ctx, technicianId, await hashPassword(pin), 'mgr', { value: K.digest(ctx.tenantId, pin), kid: K.kid });
  };
  it('verifyPin: an old-cost hash verifies, then the stored hash is at the PIN cost; the lookup digest and counters are untouched', async () => {
    const repo = new InMemoryClockPinRepository(); const svc = new TechnicianClockPinService(repo, undefined, K);
    await seedOld(repo, 'tech-1', '2580');
    await repo.updateRateState(ctx, 'tech-1', { failedAttempts: 2, lockedUntil: null });
    const before = (await repo.getPin(ctx, 'tech-1'))!;
    expect(clockPinNeedsRehash(before.pinHash)).toBe(true);
    expect(await svc.verifyPin(ctx, 'tech-1', '2580')).toEqual({ ok: true });
    const after = (await repo.getPin(ctx, 'tech-1'))!;
    expect(after.pinHash).not.toBe(before.pinHash);
    expect(clockPinNeedsRehash(after.pinHash)).toBe(false);
    expect(after.failedAttempts).toBe(0);                                              // cleared by the success, as before
    expect(await svc.verifyPin(ctx, 'tech-1', '2580')).toEqual({ ok: true });            // the same PIN keeps working
    const [row] = await repo.listActivePinnedTechnicians(ctx, { value: K.digest(ctx.tenantId, '2580'), kid: K.kid });
    expect(row).toMatchObject({ technicianId: 'tech-1', lookupKid: K.kid });            // still found by its digest
    const again = (await repo.getPin(ctx, 'tech-1'))!;
    expect(again.pinHash).toBe(after.pinHash);                                          // a PIN-cost hash is not re-hashed again
  });
  it('a WRONG PIN re-hashes nothing and still counts as a failure; a locked PIN is still refused before any hash', async () => {
    const repo = new InMemoryClockPinRepository(); const svc = new TechnicianClockPinService(repo, undefined, K);
    await seedOld(repo, 'tech-2', '2580');
    const before = (await repo.getPin(ctx, 'tech-2'))!;
    expect(await svc.verifyPin(ctx, 'tech-2', '2581')).toEqual({ ok: false, reason: 'mismatch' });
    const after = (await repo.getPin(ctx, 'tech-2'))!;
    expect(after.pinHash).toBe(before.pinHash);
    expect(after.failedAttempts).toBe(1);
    await repo.updateRateState(ctx, 'tech-2', { failedAttempts: 5, lockedUntil: '2999-01-01T00:00:00.000Z' });
    await expect(svc.verifyPin(ctx, 'tech-2', '2580')).rejects.toThrow(/temporarily locked/);
    expect((await repo.getPin(ctx, 'tech-2'))!.pinHash).toBe(before.pinHash);
  });
  it('identifyByPin: the kiosk path re-hashes the one technician that matched, and only her', async () => {
    const repo = new InMemoryClockPinRepository(); const svc = new TechnicianClockPinService(repo, undefined, K);
    await seedOld(repo, 'tech-3', '2580'); await seedOld(repo, 'tech-4', '7913');
    const h3 = (await repo.getPin(ctx, 'tech-3'))!.pinHash, h4 = (await repo.getPin(ctx, 'tech-4'))!.pinHash;
    expect(await svc.identifyByPin(ctx, '2580')).toEqual({ outcome: 'identified', technicianId: 'tech-3' });
    expect(clockPinNeedsRehash((await repo.getPin(ctx, 'tech-3'))!.pinHash)).toBe(false);
    expect((await repo.getPin(ctx, 'tech-3'))!.pinHash).not.toBe(h3);
    expect((await repo.getPin(ctx, 'tech-4'))!.pinHash).toBe(h4);                        // not matched → not touched
    expect(await svc.identifyByPin(ctx, '2580')).toEqual({ outcome: 'identified', technicianId: 'tech-3' });
    expect(await svc.identifyByPin(ctx, '0000')).toEqual({ outcome: 'no_match' });
  });
  it('setPin writes a PIN-cost hash from the start', async () => {
    const repo = new InMemoryClockPinRepository(); const svc = new TechnicianClockPinService(repo, undefined, K);
    await svc.setPin(ctx, 'tech-5', '2580', 'mgr');
    expect(clockPinHashParams((await repo.getPin(ctx, 'tech-5'))!.pinHash)).toEqual({ N: 2048, r: 8, p: 1 });
  });
});

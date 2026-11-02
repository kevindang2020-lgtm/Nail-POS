// clock-pin-scale.vitest.spec.ts — 200-technician mandate §46/§47/§89: identify-by-PIN at a 200-technician branch checks
// ONE scrypt hash (the keyed digest narrows the candidates), a manager cannot give two technicians at the same salon the
// same PIN, the same PIN at ANOTHER tenant is fine, rows written before the key existed are still found (and re-keyed),
// and a rotated key never strands a technician.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TechnicianClockPinService, ClockPinInUseError } from './technician-clock-pin.service';
import { InMemoryClockPinRepository } from './technician-clock-pin.repository';
import { KyselyClockPinRepository } from './technician-clock-pin.kysely.repository';
import { pinLookupKey, pinLookupKeyFromEnv, mapLimit } from './clock-pin-lookup';
import { hashPassword } from '@aipowersalon/auth';

const K1 = pinLookupKey('test-key-one-0123456789abcdef');
const K2 = pinLookupKey('test-key-two-0123456789abcdef');
const T = { tenantId: 'tenant-big', branchId: null };
const pinOf = (i: number) => String(2000 + i * 7).padStart(4, '0');   // 200 distinct, none of them "weak"

describe('clock-pin-lookup', () => {
  it('derives a key from AUTH_SESSION_SECRET when no explicit key is set, and none from nothing', () => {
    expect(pinLookupKeyFromEnv({})).toBeNull();
    const a = pinLookupKeyFromEnv({ AUTH_SESSION_SECRET: 's'.repeat(32) })!, b = pinLookupKeyFromEnv({ CLOCK_PIN_LOOKUP_KEY: 'k'.repeat(32), AUTH_SESSION_SECRET: 's'.repeat(32) })!;
    expect(a.kid).not.toBe(b.kid);
    expect(a.digest('t1', '2580')).not.toBe(a.digest('t2', '2580'));   // tenant-scoped: the same PIN elsewhere is a different digest
    expect(a.digest('t1', '2580')).not.toContain('2580');
  });
  it('mapLimit keeps order and bounds concurrency', async () => {
    let live = 0, peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, async (n) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return n * 2; });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]); expect(peak).toBe(3);
  });
});

describe('identify-by-PIN with 200 technicians (in memory)', () => {
  const repo = new InMemoryClockPinRepository();
  const svc = new TechnicianClockPinService(repo, undefined, K1);
  beforeAll(async () => { await mapLimit(Array.from({ length: 200 }, (_, i) => i), 8, (i) => svc.setPin(T, 'tech-' + (i + 1), pinOf(i + 1), 'mgr')); }, 120000);

  it('#1, #100 and #200 are identified, each from a single candidate', async () => {
    for (const n of [1, 100, 200]) {
      expect(await svc.identifyByPin(T, pinOf(n))).toEqual({ outcome: 'identified', technicianId: 'tech-' + n });
      expect(repo.lastCandidateCount).toBe(1);
    }
    expect((await svc.identifyByPin(T, '9898')).outcome).toBe('no_match');
    expect(repo.lastCandidateCount).toBe(0);
  });
  it('a manager cannot give a second technician at this salon a PIN that is already used; another tenant can use it', async () => {
    await expect(svc.setPin(T, 'tech-new', pinOf(25), 'mgr')).rejects.toBeInstanceOf(ClockPinInUseError);
    await expect(svc.setPin(T, 'tech-25', pinOf(25), 'mgr')).resolves.toBeUndefined();          // re-setting your own is fine
    await expect(svc.setPin({ tenantId: 'other-tenant', branchId: null }, 'x1', pinOf(25), 'mgr')).resolves.toBeUndefined();
  });
  it('a rotated key still finds every technician (scanned the old way) and re-keys the one that matched', async () => {
    const rotated = new TechnicianClockPinService(repo, undefined, K2);
    expect(await rotated.identifyByPin(T, pinOf(193))).toEqual({ outcome: 'identified', technicianId: 'tech-193' });
    expect(repo.lastCandidateCount).toBeGreaterThan(100);    // nothing keyed under K2 yet → the full scan
    expect(await rotated.identifyByPin(T, pinOf(193))).toEqual({ outcome: 'identified', technicianId: 'tech-193' });
    expect(repo.lastCandidateCount).toBeLessThan(201);
  }, 120000);
});

describe('identify-by-PIN against the real schema (PGlite)', () => {
  let db: any, q: (s: string, p?: unknown[]) => Promise<any[]>;
  const TEN = '0e000000-0000-4000-8000-000000000001', BR = '0e000000-0000-4000-8000-0000000000b1';
  const MGR = '0e000000-0000-4000-8000-0000000000aa';
  const techId = (i: number) => `0e000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`;
  beforeAll(async () => {
    const pg: any = await migratedPglite(); db = kyselyFor(pg); q = (s, p = []) => pg.query(s, p).then((r: any) => r.rows);
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Big','Big','big-pin','BIGPIN')`, [TEN]);
    await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active')`, [BR, TEN]);
    for (let i = 1; i <= 12; i++) await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active, status) values ($1,$2,$3,'T','${i}','T ${i}',true,'active')`, [techId(i), TEN, BR]);
  }, 240000);

  it('stores the digest, narrows to the matching row, finds an unkeyed (legacy) row and re-keys it', async () => {
    const repo = new KyselyClockPinRepository(db);
    const svc = new TechnicianClockPinService(repo, undefined, K1);
    const ctx = { tenantId: TEN, branchId: BR };
    for (let i = 1; i <= 11; i++) await svc.setPin(ctx, techId(i), pinOf(i), MGR);
    // #12 was given its PIN before keyed digests existed
    await repo.upsertPin(ctx, techId(12), await hashPassword(pinOf(12)), null);
    const keyed = await q(`select count(*)::int n from technician_clock_pins where tenant_id = $1 and pin_lookup is not null and pin_lookup_kid = $2`, [TEN, K1.kid]);
    expect(keyed[0].n).toBe(11);
    expect(JSON.stringify(await q(`select pin_lookup from technician_clock_pins where tenant_id = $1`, [TEN]))).not.toContain(pinOf(3));
    const cands = await repo.listActivePinnedTechnicians(ctx, { value: K1.digest(TEN, pinOf(7)), kid: K1.kid });
    expect(cands.map((c) => c.technicianId).sort()).toEqual([techId(7), techId(12)].sort());   // the match + the unkeyed row
    expect(await svc.identifyByPin(ctx, pinOf(12))).toEqual({ outcome: 'identified', technicianId: techId(12) });
    const rekeyed = await q(`select pin_lookup_kid from technician_clock_pins where technician_id = $1`, [techId(12)]);
    expect(rekeyed[0].pin_lookup_kid).toBe(K1.kid);
    expect((await repo.listActivePinnedTechnicians(ctx, { value: K1.digest(TEN, pinOf(7)), kid: K1.kid })).map((c) => c.technicianId)).toEqual([techId(7)]);
    await expect(svc.setPin(ctx, techId(5), pinOf(7), MGR)).rejects.toBeInstanceOf(ClockPinInUseError);
  }, 120000);
});

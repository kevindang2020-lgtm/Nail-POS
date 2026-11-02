// manager-pin-location.vitest.spec.ts — Kevin's instruction (Oct 28 2026): the manager PIN works only at a location the manager
// may enter (the identity module's rule, wired by the API as STAFF_BRANCH_ACCESS) and only in her own salon. A fake database
// answers the three statements the port runs (budget count, budget insert, the salon's managers); the PIN "hash" is the PIN.
import { describe, it, expect } from 'vitest';
import { KyselyManagerPinPort } from './manager-pin.kysely';

const T = 'd1d1d1d1-0000-4000-8000-000000000001', B1 = 'b1', B2 = 'b2';
function fakeDb(users: Array<{ id: string; role: string; full_name: string; pin_hash: string; tenant: string }>) {
  const seen: Array<{ sql: string; parameters: unknown[] }> = [];
  const db: any = {
    getExecutor: () => ({ executeQuery: async (c: { sql: string; parameters: unknown[] }) => {
      seen.push(c);
      if (/count\(\*\)/.test(c.sql)) return { rows: [{ n: 0 }] };
      if (/insert into auth_events/.test(c.sql)) return { rows: [{ id: 'charge-1' }] };
      if (/FROM users/.test(c.sql)) return { rows: users.filter((u) => u.tenant === c.parameters[0]) };
      return { rows: [] };
    } }),
    transaction: () => ({ execute: async (fn: (t: unknown) => unknown) => fn(db) }),
  };
  return { db, seen };
}
const ctx = (branchId: string | null) => ({ tenantId: T, branchId, userId: 'desk', role: 'FRONT_DESK', permissions: [] }) as any;
const mia = { id: 'u-mia', role: 'MANAGER', full_name: 'Mia', pin_hash: '2468', tenant: T };

describe('manager PIN — only at the manager\'s own location(s), only in her salon', () => {
  it('a manager whose locations are [b2] is refused at b1, accepted at b2', async () => {
    const { db } = fakeDb([mia]);
    const asked: any[] = [];
    const port = new KyselyManagerPinPort(db, async (p, h) => p === h, { enterableBranches: async (t, u, r) => { asked.push([t, u, r]); return [B2]; } });
    expect(await port.verify(ctx(B1), '2468')).toBeNull();
    expect(await port.verify(ctx(B2), '2468')).toMatchObject({ userId: 'u-mia' });
    expect(asked[0]).toEqual([T, 'u-mia', 'MANAGER']);
  });
  it('a salon-wide manager (rule = every location) is accepted at any location of HER salon', async () => {
    const { db } = fakeDb([mia]);
    const port = new KyselyManagerPinPort(db, async (p, h) => p === h, { enterableBranches: async () => null });
    expect(await port.verify(ctx(B1), '2468')).toMatchObject({ userId: 'u-mia' });
  });
  it('another salon\'s manager is never tried: the user read is keyed by THIS salon', async () => {
    const { db, seen } = fakeDb([{ ...mia, id: 'u-other', tenant: 'other-salon', pin_hash: '9753' }]);
    const port = new KyselyManagerPinPort(db, async (p, h) => p === h, { enterableBranches: async () => null });
    expect(await port.verify(ctx(B1), '9753')).toBeNull();
    expect(seen.find((c) => /FROM users/.test(c.sql))!.parameters[0]).toBe(T);
  });
  it('fail closed: no rule wired, an unreadable rule, or a till with no location', async () => {
    const { db } = fakeDb([mia]);
    expect(await new KyselyManagerPinPort(db, async (p, h) => p === h, null).verify(ctx(B1), '2468')).toBeNull();
    expect(await new KyselyManagerPinPort(db, async (p, h) => p === h, { enterableBranches: async () => { throw new Error('down'); } }).verify(ctx(B1), '2468')).toBeNull();
    expect(await new KyselyManagerPinPort(db, async (p, h) => p === h, { enterableBranches: async () => [B1] }).verify(ctx(null), '2468')).toBeNull();
  });
  it('the PIN of a manager of another location is not even compared (no hash work for her)', async () => {
    const { db } = fakeDb([mia]);
    let hashed = 0;
    const port = new KyselyManagerPinPort(db, async (p, h) => { hashed++; return p === h; }, { enterableBranches: async () => [B2] });
    await port.verify(ctx(B1), '2468');
    expect(hashed).toBe(0);
  });
});

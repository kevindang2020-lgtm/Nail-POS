// Security Deep Scan (Oct 28 2026 re-audit): the manager-PIN wrong-guess budget was a Map in each API process, so every
// replica gave its own 5 guesses. It is one budget in Postgres now — two ports over the same database (= two replicas)
// share it, a correct PIN refunds its charge, and at the limit even the correct PIN is refused until the window passes.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyManagerPinPort, MANAGER_PIN_MAX_FAILURES } from './manager-pin.kysely';

const T = 'd1d1d1d1-0000-4000-8000-000000000001', B = 'd1d1d1d1-0000-4000-8000-0000000000b1', M = 'd1d1d1d1-0000-4000-8000-0000000000e1';
let db: any; let pg: any;
const ctx = { tenantId: T, branchId: B, userId: 'x', role: 'FRONT_DESK', permissions: [] } as any;
// the hash comparator is the test's: the stored "hash" is the PIN itself
// the location rule (the API wires identity's enterableBranchesForUser): here every manager may enter every location
const everywhere = { enterableBranches: async () => null };
const port = (access: any = everywhere) => new KyselyManagerPinPort(db, async (pin, hash) => pin === hash, access);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1, 'P', 'P', 'pin-budget', 'PINB01', 'active')`, [T]);
  await pg.query(`INSERT INTO branches (id, tenant_id, name, status) VALUES ($1, $2, 'Main', 'active')`, [B, T]);
  await pg.query(`INSERT INTO users (id, tenant_id, first_name, last_name, full_name, email, status, role, pin_hash) VALUES ($1, $2, 'Mo', 'Manager', 'Mo Manager', 'mo@pin.test', 'active', 'MANAGER', '2468')`, [M, T]);
}, 120_000);

describe('manager PIN budget shared by every replica', () => {
  it('a correct PIN refunds its charge (no budget spent)', async () => {
    expect(await port().verify(ctx, '2468')).toMatchObject({ userId: M });
    expect((await pg.query(`SELECT count(*)::int AS c FROM auth_events WHERE event_type = 'MANAGER_PIN_ATTEMPT'`)).rows[0].c).toBe(0);
  });
  it('wrong guesses on two replicas add up; at the limit the correct PIN is refused too', async () => {
    const a = port(), b = port();
    for (let i = 0; i < MANAGER_PIN_MAX_FAILURES; i++) expect(await (i % 2 ? b : a).verify(ctx, '1111')).toBeNull();
    expect(await a.verify(ctx, '2468')).toBeNull();
    expect(await b.verify(ctx, '2468')).toBeNull();
    expect((await pg.query(`SELECT count(*)::int AS c FROM auth_events WHERE event_type = 'MANAGER_PIN_ATTEMPT' AND tenant_id = $1`, [T])).rows[0].c).toBe(MANAGER_PIN_MAX_FAILURES);
  });
  it('the window passing restores the budget', async () => {
    await pg.query(`UPDATE auth_events SET occurred_at = now() - interval '16 minutes' WHERE event_type = 'MANAGER_PIN_ATTEMPT'`);
    expect(await port().verify(ctx, '2468')).toMatchObject({ userId: M });
  });
});

describe('Oct 28 2026: the manager PIN works only at a location that manager may enter, and only in her own salon', () => {
  const OTHER_BRANCH = 'd1d1d1d1-0000-4000-8000-0000000000b2';
  const reset = () => pg.query(`DELETE FROM auth_events WHERE event_type = 'MANAGER_PIN_ATTEMPT'`);
  it('a manager confined to another location: her correct PIN is refused here (and counts as a wrong guess)', async () => {
    await reset();
    const asked: any[] = [];
    const elsewhere = { enterableBranches: async (t: string, u: string, r: string) => { asked.push([t, u, r]); return [OTHER_BRANCH]; } };
    expect(await port(elsewhere).verify(ctx, '2468')).toBeNull();
    expect(asked).toEqual([[T, M, 'MANAGER']]);
    expect((await pg.query(`SELECT count(*)::int AS c FROM auth_events WHERE event_type = 'MANAGER_PIN_ATTEMPT'`)).rows[0].c).toBe(1);
  });
  it('the same manager at her own location is accepted', async () => {
    await reset();
    expect(await port({ enterableBranches: async () => [B] }).verify(ctx, '2468')).toMatchObject({ userId: M });
  });
  it('a till with no location, an unreadable rule, or no rule wired at all: refused (never "any location")', async () => {
    await reset();
    expect(await port({ enterableBranches: async () => [B] }).verify({ ...ctx, branchId: null }, '2468')).toBeNull();
    expect(await port({ enterableBranches: async () => { throw new Error('db down'); } }).verify(ctx, '2468')).toBeNull();
    expect(await port(null).verify(ctx, '2468')).toBeNull();
  });
  it('another salon\'s manager PIN is never a PIN here (users are read for THIS salon only)', async () => {
    await reset();
    const T2 = 'd1d1d1d1-0000-4000-8000-000000000002', M2 = 'd1d1d1d1-0000-4000-8000-0000000000e2';
    await pg.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1, 'Q', 'Q', 'pin-budget-2', 'PINB02', 'active')`, [T2]);
    await pg.query(`INSERT INTO users (id, tenant_id, first_name, last_name, full_name, email, status, role, pin_hash) VALUES ($1, $2, 'Ot', 'Her', 'Ot Her', 'ot@pin.test', 'active', 'OWNER', '9753')`, [M2, T2]);
    expect(await port().verify(ctx, '9753')).toBeNull();
  });
});

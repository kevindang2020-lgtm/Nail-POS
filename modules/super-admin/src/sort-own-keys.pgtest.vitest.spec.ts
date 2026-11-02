// sort-own-keys.pgtest — Security Deep Scan §84 (S-A6): `sort=constructor` / `__proto__` / `toString` on the disputes,
// revenue-residuals and settlements lists falls back to the DEFAULT order (an own-key lookup) — it used to pick up
// Object's inherited members and turn them into an SQL error. Against the real migrated schema.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyDisputesRepo } from './super-admin-disputes/disputes.kysely.repository';
import { KyselyRevenueResidualsRepo } from './super-admin-revenue-residuals/super-admin-revenue-residuals.kysely.repository';
import { SettlementsRepository } from './super-admin-settlements/settlements.repository';

let db: any;
beforeAll(async () => { db = kyselyFor(await migratedPglite()); });
const HOSTILE = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

describe('§84 sort maps answer only their own keys', { timeout: 60_000 }, () => {
  it.each(HOSTILE)('sort=%s → default order, no error (disputes / revenue records / settlements)', async (sort) => {
    await expect(new KyselyDisputesRepo(db).listDisputes({ page: 1, pageSize: 5, sort })).resolves.toMatchObject({ rows: expect.any(Array) });
    await expect(new KyselyRevenueResidualsRepo(db).listRecords({ page: 1, pageSize: 5, sort })).resolves.toMatchObject({ rows: expect.any(Array) });
    await expect(new SettlementsRepository(db).settlementData({ page: 1, pageSize: 5, sort })).resolves.toMatchObject({ pageItems: expect.any(Array) });
  });
  it('a declared sort still works', async () => {
    await expect(new KyselyDisputesRepo(db).listDisputes({ page: 1, pageSize: 5, sort: 'amount', direction: 'asc' })).resolves.toMatchObject({ rows: expect.any(Array) });
    await expect(new KyselyRevenueResidualsRepo(db).listRecords({ page: 1, pageSize: 5, sort: 'gross' })).resolves.toMatchObject({ rows: expect.any(Array) });
  });
});

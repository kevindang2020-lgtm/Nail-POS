// Constitution 7 §18 on the real schema: a suspension stores its reason code on the tenant row, reactivation clears it,
// and the column accepts only the seven codes.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselySuperAdminTenantsRepo } from '@aipowersalon/super-admin';
import { seedRow } from '../events/pgtest-seed';

const T = '56565656-5656-4565-8565-565656565656';
let db: any; let pg: any;
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'S', display_name: 'Suspend Me', tenant_slug: 'suspendme', tenant_code: 'SUSP01', status: 'active' });
});

describe('tenant suspension reason (§18)', () => {
  it('suspension stores the code; reactivation clears it', async () => {
    const repo = new KyselySuperAdminTenantsRepo(db);
    await repo.setStatus(T, 'suspended', { reason: 'card declined three times', reasonCode: 'BILLING' });
    expect((await sql<any>`select status, suspension_reason_code from tenants where id = ${T}`.execute(db)).rows[0]).toEqual({ status: 'suspended', suspension_reason_code: 'BILLING' });
    await repo.setStatus(T, 'active', { reason: 'billing resolved in full', reasonCode: null });
    expect((await sql<any>`select status, suspension_reason_code from tenants where id = ${T}`.execute(db)).rows[0]).toEqual({ status: 'active', suspension_reason_code: null });
  });
  it('the column refuses a code outside the vocabulary', async () => {
    await expect(pg.query(`update tenants set suspension_reason_code = 'LATE' where id = $1`, [T])).rejects.toBeTruthy();
  });
});

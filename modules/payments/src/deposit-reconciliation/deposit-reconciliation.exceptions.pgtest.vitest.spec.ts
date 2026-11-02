// deposit-reconciliation.exceptions.pgtest — B-14 remainder (Oct 20 2026): a case raised by the sweep (a system job) stores NO
// creator — created_by_user_id is a person; 'system:<job>' is not one (and the old all-zeros UUID pretended to be one).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { systemContext } from '@aipowersalon/tenant-context';
import { KyselyExceptionsRepository } from './deposit-reconciliation.exceptions.repository';

const T = 'a8a8a8a8-0000-4000-8000-000000000001', U = 'a8a8a8a8-0000-4000-8000-0000000000aa';
let pg: any; let repo: KyselyExceptionsRepository;
beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'R', 'R', 'recon-b14', 'RB14', 'active')`);
  repo = new KyselyExceptionsRepository(kyselyFor(pg) as never);
}, 120000);

describe('who raised a reconciliation case', () => {
  it('the sweep (systemContext) → created_by_user_id NULL; a person → their id', async () => {
    const sys = await repo.create(systemContext({ tenantId: T, actor: 'deposit-reconciliation-sweep' }) as any, { kind: 'missing_deposit', severity: 'high', title: 'S1 has no deposit', amountCents: 100 } as any);
    const person = await repo.create({ tenantId: T, userId: U, role: 'OWNER', permissions: [] } as any, { kind: 'other', severity: 'low', title: 'checked by hand', amountCents: 0 } as any);
    const rows = (await pg.query(`select id, created_by_user_id from reconciliation_exceptions where tenant_id = $1`, [T])).rows;
    expect(rows.find((r: any) => r.id === sys.id).created_by_user_id).toBeNull();
    expect(rows.find((r: any) => r.id === person.id).created_by_user_id).toBe(U);
  });
});

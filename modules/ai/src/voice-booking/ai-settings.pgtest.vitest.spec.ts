// ai-settings.pgtest — AI Receptionist Settings guide (Nov 3 2026, migration 784) on the REAL schema: versions, the history row
// written in the same transaction, a stale save refused, a branch reading the salon row, another salon isolated.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { AiSettingsService, KyselySettingsRepo, SettingsConflictError } from './ai-settings.service';

const T = 'a7840000-0000-4000-8000-000000000001', T2 = 'a7840000-0000-4000-8000-000000000002', B = 'a7840000-0000-4000-8000-000000000003', U = 'a7840000-0000-4000-8000-000000000004';
const own = (o: any = {}) => ({ tenantId: T, branchId: null, userId: U, role: 'OWNER', permissions: ['ai.manage', 'ai.use'], ...o });
let svc: AiSettingsService;
beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'A','A','air-a','AIRA1','active'), ($2,'B','B','air-b','AIRB1','active')`, [T, T2]);
  await pg.query(`insert into branches (id, tenant_id, name) values ($1,$2,'Main')`, [B, T]);
  await pg.query(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Owner Kim','o@air.test','active','OWNER')`, [U, T]);
  svc = new AiSettingsService(new KyselySettingsRepo(kyselyFor(pg)));
}, 120_000);

describe('receptionist settings versions (real schema)', () => {
  it('versions + history with who and what changed; a stale save is refused; the branch inherits; another salon sees nothing', async () => {
    expect((await svc.update(own(), { enabled: true, expectedVersion: 0 })).meta).toMatchObject({ version: 1 });
    await svc.update(own(), { maxCallDurationSeconds: 900, expectedVersion: 1 });
    await expect(svc.update(own(), { enabled: false, expectedVersion: 1 })).rejects.toBeInstanceOf(SettingsConflictError);
    const h = await svc.history(own());
    expect(h.items.map((x) => [x.version, x.changedKeys, x.actorName])).toEqual([[2, ['maxCallDurationSeconds'], 'Owner Kim'], [1, ['enabled'], 'Owner Kim']]);
    const br = await svc.get(own({ branchId: B }));
    expect(br).toMatchObject({ enabled: true, maxCallDurationSeconds: 900, meta: { source: 'salon', scope: 'branch', version: 0 } });
    expect((await svc.history(own({ tenantId: T2 }))).total).toBe(0);
    expect((await svc.get(own({ tenantId: T2 }))).meta).toMatchObject({ source: 'defaults' });
  });
});

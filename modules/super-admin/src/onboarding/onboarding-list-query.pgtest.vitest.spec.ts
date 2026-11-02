// onboarding-list-query.pgtest.vitest.spec.ts — BUILD_PLAN Phase 12 (DoD #21/#22): GET /super-admin/onboarding/applications
// and /super-admin/onboarding/overview run on ONBOARDING_RECORDS_SPEC — checked + written back as the ListQueryInterceptor
// does (canonical `sort=-tenant` → the handler's sort + direction), then applied by the repository on the migrated schema.
// Before Phase 12 an unknown ?sort= reached `sql.raw(undefined)` and failed the query; now it is a 400 at the edge.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { parseListQuery, writeLegacyParams, ListQueryError, type ListQuerySpec } from '@aipowersalon/database';
import { encodeOffsetCursor, inspectOffsetCursor } from '@aipowersalon/api-contracts';
import { KyselyOnboardingRepo } from './onboarding.kysely.repository';
import { OnboardingControllerListQueries } from './onboarding.module.list-queries';

let db: any; let repo: KyselyOnboardingRepo;
const edge = (query: Record<string, any>, spec: ListQuerySpec) => { const q = { ...query }; writeLegacyParams(q, spec, parseListQuery(q, spec)); return q; };
/** onboarding.module.ts queryFrom — the controller's own mapping of the (written-back) query. */
const params = (q: any) => ({ search: q.search, applicationType: q.applicationType, stage: q.stage, specialistId: q.specialistId, merchantStatus: q.merchantStatus, hardwareStatus: q.hardwareStatus, importStatus: q.importStatus, trainingStatus: q.trainingStatus,
  hasMissingDocuments: q.hasMissingDocuments === undefined ? undefined : q.hasMissingDocuments === 'true', sort: q.sort, direction: q.direction === 'asc' ? 'asc' : q.direction === 'desc' ? 'desc' : undefined,
  page: q.page ? +q.page : 1, pageSize: q.pageSize ? +q.pageSize : 10 }) as any;
const codeOf = (q: any, spec: ListQuerySpec) => { try { edge(q, spec); return 'ok'; } catch (e) { return (e as ListQueryError).code; } };

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  repo = new KyselyOnboardingRepo(db);
  const names = ['Bella Nails', 'Aria Spa', 'Coco_50% Nails', 'Dahlia', 'Elle Studio', 'Fern'];
  for (let i = 0; i < names.length; i++) {
    const app: any = await db.insertInto('tenant_applications').values({ salon_name: names[i], owner_name: `Owner ${i}`, email: `o${i}@example.test`, status: 'approved' } as any).returning('id').executeTakeFirstOrThrow();
    const id = await repo.insertRecord({ applicationId: app.id, applicationType: i % 2 ? 'new_branch' : 'new_tenant', branchCount: i });
    if (i === 2) await repo.updateRecord(id, { missingDocsCount: 2 } as any);
  }
}, 180_000);

describe('onboarding records on the list-query standard', () => {
  for (const handler of ['list', 'overview'] as const) {
    const spec = OnboardingControllerListQueries[handler];
    it(`${handler}: filter[applicationType] = ?applicationType=; escaped search; the missing-documents flag`, async () => {
      const a = await repo.listRecords(params(edge({ filter: { applicationType: 'new_branch' } }, spec)));
      const b = await repo.listRecords(params(edge({ applicationType: 'new_branch' }, spec)));
      expect(a.rows.map((r) => r.id)).toEqual(b.rows.map((r) => r.id));
      expect(a.total).toBe(3);
      expect((await repo.listRecords(params(edge({ q: 'Coco_50%' }, spec)))).rows.map((r) => r.salonName)).toEqual(['Coco_50% Nails']);
      expect((await repo.listRecords(params(edge({ hasMissingDocuments: 'true' }, spec)))).rows.map((r) => r.salonName)).toEqual(['Coco_50% Nails']);
    });
    it(`${handler}: sort=-tenant and the older sort=tenant (always descending here) agree; +tenant ascends; cursor pages`, async () => {
      const signed = (await repo.listRecords(params(edge({ sort: '-tenant' }, spec)))).rows.map((r) => r.salonName);
      const legacy = (await repo.listRecords(params(edge({ sort: 'tenant' }, spec)))).rows.map((r) => r.salonName);
      expect(signed).toEqual(['Fern', 'Elle Studio', 'Dahlia', 'Coco_50% Nails', 'Bella Nails', 'Aria Spa']);
      expect(legacy).toEqual(signed);
      const p1 = (await repo.listRecords(params(edge({ sort: 'tenant', direction: 'asc', pageSize: '4' }, spec)))).rows.map((r) => r.salonName);
      const c: any = inspectOffsetCursor(encodeOffsetCursor({ page: 2, pageSize: 4, sizeKey: 'pageSize', sortKey: 'tenant', direction: 'asc' }));
      const p2 = (await repo.listRecords(params(edge({ page: String(c.params.page), pageSize: '4', sort: c.params.sortKey, direction: c.params.direction }, spec)))).rows.map((r) => r.salonName);
      expect([...p1, ...p2]).toEqual([...signed].reverse());
      expect(codeOf({ sort: 'owner_email' }, spec)).toBe('INVALID_SORT');
    });
  }
});

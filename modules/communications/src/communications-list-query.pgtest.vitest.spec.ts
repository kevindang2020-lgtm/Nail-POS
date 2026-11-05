// communications-list-query.pgtest.vitest.spec.ts — BUILD_PLAN Phase 12 (DoD #21/#22): four communications list
// endpoints run on their ONE list-query declaration (THREADS_SPEC / CAMPAIGNS_SPEC): GET /pos/communications/state,
// GET /super-admin/communications/state, GET /pos/campaigns (state + list), GET /super-admin/campaigns (state + list).
// The request is checked + written back exactly as the ListQueryInterceptor does; the repository applies the same spec
// on the migrated schema — filter, escaped search, sort and the offset cursor; the edge refuses undeclared fields.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { parseListQuery, writeLegacyParams, ListQueryError, type ListQuerySpec } from '@aipowersalon/database';
import { encodeOffsetCursor, inspectOffsetCursor } from '@aipowersalon/api-contracts';
import { KyselyCommunicationsRepository } from './communications/communications.kysely.repository';
import { KyselyCampaignsRepository } from './campaigns/campaigns.kysely.repository';
import { CommunicationsControllerListQueries, SuperAdminCommunicationsControllerListQueries } from './communications/communications.list-queries';
import { CampaignsControllerListQueries, SuperAdminCampaignsControllerListQueries } from './campaigns/campaigns.list-queries';

const T1 = 'c0110000-0000-4000-8000-000000000001'; const T2 = 'c0110000-0000-4000-8000-000000000002';
let db: any;
const edge = (query: Record<string, any>, spec: ListQuerySpec) => { const q = { ...query }; writeLegacyParams(q, spec, parseListQuery(q, spec)); return q; };
const codeOf = (q: any, spec: ListQuerySpec) => { try { edge(q, spec); return 'ok'; } catch (e) { return (e as ListQueryError).code; } };

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  for (const [id, slug] of [[T1, 'lqc1'], [T2, 'lqc2']]) await db.insertInto('tenants').values({ id, legal_name: slug, display_name: slug, tenant_slug: slug, tenant_code: slug.toUpperCase(), status: 'active' } as any).execute();
  const threads: any[] = [];
  for (let i = 0; i < 9; i++) threads.push({ tenant_id: T1, status: i % 3 === 0 ? 'open' : 'replied', channel: i % 2 ? 'email' : 'sms', customer_name: i === 4 ? 'Ann_100%' : `Customer ${i}`, subject: `s${i}`, last_message_at: new Date(Date.UTC(2026, 8, 1 + i)) });
  threads.push({ tenant_id: T2, status: 'open', channel: 'sms', customer_name: 'Other salon', subject: 'x', last_message_at: new Date('2026-09-20T00:00:00Z') });
  await db.insertInto('communication_threads').values(threads).execute();
  const camps: any[] = [];
  for (let i = 0; i < 7; i++) camps.push({ tenant_id: T1, name: i === 2 ? 'Fall_50% promo' : `Campaign ${i}`, status: i % 2 ? 'draft' : 'scheduled', channel: 'sms', created_at: new Date(Date.UTC(2026, 8, 1 + i)) });
  camps.push({ tenant_id: T2, name: 'Other salon promo', status: 'draft', channel: 'sms', created_at: new Date('2026-09-30T00:00:00Z') });
  await db.insertInto('campaigns').values(camps).execute();
}, 180_000);

describe('message threads (GET /pos/communications/state, GET /super-admin/communications/state)', () => {
  const POS = CommunicationsControllerListQueries.state; const SA = SuperAdminCommunicationsControllerListQueries.state;
  it('filter[status] and ?status= agree; scoped to the salon', async () => {
    const repo = new KyselyCommunicationsRepository(db);
    const a = await repo.listThreads(T1, edge({ filter: { status: 'open' } }, POS) as any);
    const b = await repo.listThreads(T1, edge({ status: 'open' }, POS) as any);
    expect(a.items.map((t: any) => t.id)).toEqual(b.items.map((t: any) => t.id));
    expect(a.pagination.totalItems).toBe(3);
    expect(a.items.every((t: any) => t.tenantId === T1 && t.status === 'open')).toBe(true);
  });
  it('q is escaped (Ann_100% matches one thread), newest message first, cursor pages do not overlap', async () => {
    const repo = new KyselyCommunicationsRepository(db);
    expect((await repo.listThreads(T1, edge({ q: 'Ann_100%' }, POS) as any)).items.map((t: any) => t.customerName)).toEqual(['Ann_100%']);
    const p1 = await repo.listThreads(T1, edge({ pageSize: '4' }, POS) as any);
    expect(p1.items[0].subject).toBe('s8');
    const c: any = inspectOffsetCursor(encodeOffsetCursor({ page: 2, pageSize: 4, sizeKey: 'pageSize' }));
    const p2 = await repo.listThreads(T1, edge({ page: String(c.params.page), pageSize: String(c.params.pageSize) }, POS) as any);
    expect(p2.items.map((t: any) => t.subject)).toEqual(['s4', 's3', 's2', 's1']);
  });
  it('the platform list takes filter[tenantId]; the salon list refuses it', async () => {
    const repo = new KyselyCommunicationsRepository(db);
    const r = await repo.listPlatform(edge({ filter: { tenantId: T2 } }, SA) as any);
    expect(r.items.map((t: any) => t.customerName)).toEqual(['Other salon']);
    expect(codeOf({ filter: { tenantId: T2 } }, POS)).toBe('INVALID_FILTER');
    expect(codeOf({ sort: 'customer_contact' }, POS)).toBe('INVALID_SORT');
  });
});

describe('campaigns (GET /pos/campaigns, /pos/campaigns/state, GET /super-admin/campaigns, /super-admin/campaigns/state)', () => {
  it('filter + escaped search + declared sort (createdAt asc and desc) on the salon list', async () => {
    const repo = new KyselyCampaignsRepository(db);
    for (const spec of [CampaignsControllerListQueries.list, CampaignsControllerListQueries.state]) {
      const drafts = await repo.list(T1, edge({ filter: { status: 'draft' } }, spec) as any);
      expect(drafts.items.map((x: any) => x.status)).toEqual(['draft', 'draft', 'draft']);
      expect((await repo.list(T1, edge({ search: 'Fall_50%' }, spec) as any)).items.map((x: any) => x.name)).toEqual(['Fall_50% promo']);
      const desc = (await repo.list(T1, edge({}, spec) as any)).items.map((x: any) => x.name);
      const asc = (await repo.list(T1, edge({ sort: 'createdAt' }, spec) as any)).items.map((x: any) => x.name);
      expect(asc).toEqual([...desc].reverse());
      expect(codeOf({ sort: 'audience_size' }, spec)).toBe('INVALID_SORT');
    }
  });
  it('the platform lists accept filter[tenantId] and walk with the cursor', async () => {
    const repo = new KyselyCampaignsRepository(db);
    for (const spec of [SuperAdminCampaignsControllerListQueries.list, SuperAdminCampaignsControllerListQueries.state]) {
      expect((await repo.listPlatform(edge({ filter: { tenantId: T2 } }, spec) as any)).items.map((x: any) => x.name)).toEqual(['Other salon promo']);
      const p1 = await repo.listPlatform(edge({ pageSize: '3' }, spec) as any);
      const c: any = inspectOffsetCursor(encodeOffsetCursor({ page: 2, pageSize: 3, sizeKey: 'pageSize' }));
      const p2 = await repo.listPlatform(edge({ page: String(c.params.page), pageSize: '3' }, spec) as any);
      expect(p1.items[0].name).toBe('Other salon promo');
      expect(p2.items.some((x: any) => p1.items.some((y: any) => y.id === x.id))).toBe(false);
      expect(p1.pagination.totalItems).toBe(8);
    }
  });
});

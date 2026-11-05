// audit-list-query.pgtest.vitest.spec.ts — BUILD_PLAN Phase 12 (DoD #21/#22/#23): the audit feed endpoints
// (GET /pos/audit/events, GET /super-admin/audit-events) run on the ONE list-query declaration (AUDIT_EVENTS_SPEC): the
// request is checked + written back exactly as the ListQueryInterceptor does, then the repository applies the same spec
// on the migrated schema — filter, search, sort, date range (salon calendar day) and the offset cursor.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { parseListQuery, writeLegacyParams, ListQueryError, type ListQuerySpec } from '@aipowersalon/database';
import { encodeOffsetCursor, inspectOffsetCursor } from '@aipowersalon/api-contracts';
import { KyselyAuditRepository } from './audit.kysely.repository';
import { AuditControllerListQueries, SuperAdminAuditControllerListQueries } from './audit.list-queries';

const T1 = 'a1d10000-0000-4000-8000-000000000001'; const T2 = 'a1d10000-0000-4000-8000-000000000002';
let db: any; let repo: KyselyAuditRepository;
/** What the interceptor hands the handler: validated, canonical names written back under the legacy ones. */
const edge = (query: Record<string, any>, spec: ListQuerySpec) => { const q = { ...query }; writeLegacyParams(q, spec, parseListQuery(q, spec, { timeZone: 'America/New_York' })); return q; };
const POS = AuditControllerListQueries.events; const SA = SuperAdminAuditControllerListQueries.events;

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  for (const [id, slug] of [[T1, 'lqa1'], [T2, 'lqa2']]) await db.insertInto('tenants').values({ id, legal_name: slug, display_name: slug, tenant_slug: slug, tenant_code: slug.toUpperCase(), status: 'active' } as any).execute();
  // America/New_York salons (no branch rows → the default zone); occurred_at spread across Sep 2026
  const rows: any[] = [];
  for (let i = 0; i < 12; i++) rows.push({ tenant_id: T1, module: i % 2 ? 'checkout' : 'customers', action: `act_${String(i).padStart(2, '0')}`, severity: i % 3 === 0 ? 'warning' : 'info', status: 'success', summary: i === 5 ? 'Refund 50%_off applied' : `summary ${i}`, occurred_at: new Date(Date.UTC(2026, 8, 1 + i, 12)) });
  rows.push({ tenant_id: T1, module: 'checkout', action: 'late_night', severity: 'info', status: 'success', summary: 'x', occurred_at: new Date('2026-09-11T03:30:00Z') });   // Sep 10 23:30 in New York
  rows.push({ tenant_id: T2, module: 'checkout', action: 'other_salon', severity: 'info', status: 'success', summary: 'x', occurred_at: new Date('2026-09-05T12:00:00Z') });
  await db.insertInto('audit_events').values(rows).execute();
  repo = new KyselyAuditRepository(db);
}, 180_000);

describe('GET /pos/audit/events on the list-query standard', () => {
  it('filter[module] (canonical) and ?module= (legacy) give the same tenant-scoped rows', async () => {
    const a = await repo.list(T1, edge({ filter: { module: 'checkout' } }, POS) as any);
    const b = await repo.list(T1, edge({ module: 'checkout' }, POS) as any);
    expect(a.items.map((r: any) => r.action)).toEqual(b.items.map((r: any) => r.action));
    expect(a.items.every((r: any) => r.module === 'checkout')).toBe(true);
    expect(a.items.some((r: any) => r.action === 'other_salon')).toBe(false);
    expect(a.pagination.totalItems).toBe(7);
  });
  it('search escapes LIKE wildcards — "50%_off" matches the one row, not everything', async () => {
    const r = await repo.list(T1, edge({ q: '50%_off' }, POS) as any);
    expect(r.items.map((x: any) => x.action)).toEqual(['act_05']);
  });
  it('a date-only range is the salon\'s calendar day (23:30 New York on Sep 10 is IN to=2026-09-10)', async () => {
    const r = await repo.list(T1, edge({ from: '2026-09-09', to: '2026-09-10' }, POS) as any);
    expect(r.items.map((x: any) => x.action).sort()).toEqual(['act_08', 'act_09', 'late_night']);
  });
  it('newest first (the declared default), and the offset cursor walks pages without overlap', async () => {
    const p1 = await repo.list(T1, edge({ pageSize: '5' }, POS) as any);
    const at = p1.items.map((x: any) => new Date(x.occurredAt).getTime());
    expect([...at].sort((x, y) => y - x)).toEqual(at);
    const c = inspectOffsetCursor(encodeOffsetCursor({ page: 2, pageSize: 5, sizeKey: 'pageSize' }));
    expect(c.kind).toBe('ok');
    const p2 = await repo.list(T1, edge({ page: String((c as any).params.page), pageSize: '5' }, POS) as any);
    expect(p2.items).toHaveLength(5);
    expect(p2.items.some((x: any) => p1.items.some((y: any) => y.id === x.id))).toBe(false);
    expect(new Date(p2.items[0].occurredAt).getTime()).toBeLessThanOrEqual(at[at.length - 1]);
  });
  it('the edge refuses what the endpoint does not allow', () => {
    const codeOf = (q: any) => { try { edge(q, POS); return 'ok'; } catch (e) { return (e as ListQueryError).code; } };
    expect(codeOf({ filter: { tenant_id: T2 } })).toBe('INVALID_FILTER');
    expect(codeOf({ sort: 'summary' })).toBe('INVALID_SORT');
    expect(codeOf({ from: '2024-01-01', to: '2026-09-01' })).toBe('DATE_RANGE_TOO_LARGE');
  });
});

describe('GET /super-admin/audit-events on the list-query standard', () => {
  it('filter[tenantId] narrows the cross-salon feed; the range applies across salons', async () => {
    const one = await repo.listPlatform(edge({ filter: { tenantId: T2 } }, SA) as any);
    expect(one.items.map((x: any) => x.action)).toEqual(['other_salon']);
    const ranged = await repo.listPlatform(edge({ from: '2026-09-05T00:00:00Z', to: '2026-09-06T00:00:00Z' }, SA) as any);
    expect(ranged.items.map((x: any) => x.action).sort()).toEqual(['act_04', 'other_salon']);
  });
});

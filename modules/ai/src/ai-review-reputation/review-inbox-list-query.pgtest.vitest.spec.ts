// review-inbox-list-query.pgtest.vitest.spec.ts — BUILD_PLAN Phase 12 (DoD #21/#22): GET /pos/ai-review-reputation/inbox
// runs on REVIEW_INBOX_SPEC — checked as the ListQueryInterceptor does, then applied by the repository on the migrated
// schema: filters, newest first, cursor paging, and a total that now counts the same filtered, branch-scoped rows.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { parseListQuery, writeLegacyParams, ListQueryError, type ListQuerySpec } from '@aipowersalon/database';
import { encodeOffsetCursor, inspectOffsetCursor } from '@aipowersalon/api-contracts';
import { KyselyReviewRead } from './ai-review-reputation.kysely';
import { REVIEW_INBOX_SPEC } from './ai-review-reputation.list-queries';

const T = 'e0110000-0000-4000-8000-000000000001'; const B1 = 'e0110000-0000-4000-8000-0000000000b1'; const B2 = 'e0110000-0000-4000-8000-0000000000b2';
let db: any; let read: KyselyReviewRead;
const edge = (query: Record<string, any>, spec: ListQuerySpec = REVIEW_INBOX_SPEC) => { const q = { ...query }; writeLegacyParams(q, spec, parseListQuery(q, spec)); return q; };
const manager = { tenantId: T, branchId: B1, userId: 'u', role: 'MANAGER', permissions: [] as string[] };

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await db.insertInto('tenants').values({ id: T, legal_name: 'lqr', display_name: 'lqr', tenant_slug: 'lqr', tenant_code: 'LQR', status: 'active' } as any).execute();
  await db.insertInto('branches').values([{ id: B1, tenant_id: T, name: 'One', status: 'active' }, { id: B2, tenant_id: T, name: 'Two', status: 'active' }] as any).execute();
  const rows: any[] = [];
  for (let i = 0; i < 8; i++) rows.push({ tenant_id: T, branch_id: i < 6 ? B1 : B2, rating: 1 + (i % 5), source: i % 2 ? 'google' : 'yelp', sentiment: i % 3 === 0 ? 'negative' : 'positive', comment: `c${i}`, created_at: new Date(Date.UTC(2026, 8, 1 + i)) });
  await db.insertInto('reviews').values(rows).execute();
  read = new KyselyReviewRead(db);
}, 180_000);

describe('review inbox on the list-query standard', () => {
  it('filter[source] = ?source=; branch-scoped; the total counts the filtered rows (it used to count every review)', async () => {
    const a = await read.inbox(manager, edge({ filter: { source: 'google' } }));
    const b = await read.inbox(manager, edge({ source: 'google' }));
    expect(a.items.map((x) => x.id)).toEqual(b.items.map((x) => x.id));
    expect(a.items.map((x) => x.comment)).toEqual(['c5', 'c3', 'c1']);
    expect(a.pagination.totalItems).toBe(3);
  });
  it('newest first; the cursor walks pages; undeclared fields are refused at the edge', async () => {
    const p1 = await read.inbox(manager, edge({ pageSize: '4' }));
    const c: any = inspectOffsetCursor(encodeOffsetCursor({ page: 2, pageSize: 4, sizeKey: 'pageSize' }));
    const p2 = await read.inbox(manager, edge({ page: String(c.params.page), pageSize: '4' }));
    expect([...p1.items, ...p2.items].map((x) => x.comment)).toEqual(['c5', 'c4', 'c3', 'c2', 'c1', 'c0']);
    const codeOf = (q: any) => { try { edge(q); return 'ok'; } catch (e) { return (e as ListQueryError).code; } };
    expect(codeOf({ filter: { branch_id: B2 } })).toBe('INVALID_FILTER');
    expect(codeOf({ sort: 'rating' })).toBe('INVALID_SORT');
  });
});

// community-events.vitest.spec.ts — BUILD_PLAN Phase 8 integration: a salon-wide community event carries the salon's
// branch ids, so the realtime projection reaches every branch room of that salon (a front-desk session sits in one).
import { describe, it, expect } from 'vitest';
import { OutboxCommunityEvents } from './community-events';
import { DOMAIN_EVENTS } from '@aipowersalon/events';

const T = '11111111-1111-4111-8111-111111111111', B1 = '22222222-2222-4222-8222-222222222222', B2 = '33333333-3333-4333-8333-333333333333';
function fakeDb(rows: { id: string }[]) {
  const seen: any[] = [];
  const q: any = { select: () => q, where: (...a: any[]) => { seen.push(a); return q; }, execute: async () => rows };
  return { db: { selectFrom: (t: string) => { seen.push(['from', t]); return q; } } as any, seen };
}
describe('OutboxCommunityEvents', () => {
  it('adds the salon\'s branch ids when the producer did not', async () => {
    const written: any[] = []; const { db, seen } = fakeDb([{ id: B1 }, { id: B2 }]);
    const ev = new OutboxCommunityEvents(db, { write: async (_c: any, e: any) => { written.push(e); } } as any);
    await ev.emit({ tenantId: T }, DOMAIN_EVENTS.COMMUNITY_ADVISORY_PUBLISHED, { type: 'community_post', id: B1 }, { postId: B1, status: 'published_unverified' });
    expect(written[0].payload.branchIds).toEqual([B1, B2]);
    expect(seen).toContainEqual(['tenant_id', '=', T]);
  });
  it('keeps branch ids the producer gave and does not query', async () => {
    const written: any[] = []; const { db, seen } = fakeDb([{ id: B2 }]);
    const ev = new OutboxCommunityEvents(db, { write: async (_c: any, e: any) => { written.push(e); } } as any);
    await ev.emit({ tenantId: T }, DOMAIN_EVENTS.COMMUNITY_ALERT_DELIVERED, { type: 'community_post', id: B1 }, { postId: B1, branchIds: [B1] });
    expect(written[0].payload.branchIds).toEqual([B1]);
    expect(seen.length).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { InMemoryCallIntelRepo } from './call-intelligence.repository';
import { CallIntelligenceService } from './call-intelligence.service';

const scope = { tenantId: 't1', branchId: null };
const mk = (id: string, at: string, o: any = {}) => ({ tenantId: 't1', branchId: null, providerCallId: id, status: 'answered_ai', direction: 'inbound', durationSeconds: 60, outcome: 'booked', startedAt: at, aiHandled: true, ...o } as any);

describe('call-intelligence — recent calls list', () => {
  it('returns tenant calls newest-first, respects limit + tenant isolation', async () => {
    const repo = new InMemoryCallIntelRepo();
    await repo.record(mk('c1', '2026-07-01T10:00:00.000Z'));
    await repo.record(mk('c2', '2026-07-03T10:00:00.000Z'));
    await repo.record(mk('c3', '2026-07-02T10:00:00.000Z'));
    await repo.record({ ...mk('cX', '2026-07-09T10:00:00.000Z'), tenantId: 't2' });
    const recent = await repo.listRecent(scope, 50);
    expect(recent.map((r) => r.providerCallId)).toEqual(['c2', 'c3', 'c1']); // newest first, t2 excluded
    expect((await repo.listRecent(scope, 2)).length).toBe(2);               // limit honored
    expect((await repo.listRecent({ tenantId: 't2', branchId: null }, 50)).length).toBe(1);
  });
  it('service.recent clamps limit and delegates to the repo', async () => {
    const repo = new InMemoryCallIntelRepo();
    for (let i = 0; i < 5; i++) await repo.record(mk('c' + i, `2026-07-0${i + 1}T10:00:00.000Z`));
    const svc = new CallIntelligenceService(repo);
    expect((await svc.recent(scope, 3)).length).toBe(3);
    expect((await svc.recent(scope)).length).toBe(5); // default 50 -> all 5
  });
});

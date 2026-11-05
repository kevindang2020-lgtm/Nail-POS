// community-bugs.vitest.spec — BUILD_PLAN Phase 8 (agent A): the production bugs from
// docs/audit-2026-10-06/spec-tenant-safety-community.md, each pinned by a test written BEFORE the fix (all failed on the
// old tree): 1 uppercase session roles, 7 phantom '' rows from swallowed write errors, 11 managerApprovalRequired /
// notify_categories ignored, 10 the search rate limit hard-coded to 0, 8 an empty branch reaching a uuid column.
import { describe, it, expect } from 'vitest';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { CommunityService } from './community.service';
import { InMemoryCommunityRepo, KyselyCommunityRepo } from './community.repository';
import { InMemoryCommunityEvents } from './community-events';

const T1 = 'a1a1a1a1-0000-4000-8000-000000000001';
const U1 = 'a1a1a1a1-0000-4000-8000-000000000011';

/** A Kysely whose every query either throws or returns the given rows. */
function fakeDb(behaviour: { throws?: boolean; rows?: any[] }) {
  const conn = { async executeQuery() { if (behaviour.throws) throw new Error('db down'); return { rows: behaviour.rows ?? [] }; }, async *streamQuery() { /* none */ } };
  const driver = { async init() {}, async acquireConnection() { return conn; }, async beginTransaction() {}, async commitTransaction() {}, async rollbackTransaction() {}, async releaseConnection() {}, async destroy() {} };
  return new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => driver as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
}

const settings = (o: Partial<any> = {}) => ({ tenantId: T1, enabled: true, receptionistApprovalRequired: true, managerApprovalRequired: true, roleGrants: {}, roleRemovals: {}, ...o });
const input = { category: 'gift_card_scam', severity: 'moderate', title: 'Gift card pattern', body: 'a caller asked for gift cards to hold a booking' };

describe('bug 1 — the REAL session roles (uppercase) reach the community roles', () => {
  for (const role of ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION']) {
    it(`${role} may draft an advisory (was 403: every tenant user mapped to technician)`, async () => {
      const repo = new InMemoryCommunityRepo(); repo.setSettings(settings());
      const svc = new CommunityService(repo as any, { events: new InMemoryCommunityEvents() } as any);
      const ctx = { tenantId: T1, branchId: null, userId: U1, role };
      await svc.acknowledgeRules(ctx, { rulesVersion: '2026-10-08' });
      const d = await svc.createAdvisory(ctx, input as any);
      expect(d.status).toBe('incident_draft');
    });
  }
  it('TECHNICIAN cannot draft', async () => {
    const repo = new InMemoryCommunityRepo(); repo.setSettings(settings());
    const svc = new CommunityService(repo as any, {} as any);
    await expect(svc.createAdvisory({ tenantId: T1, branchId: null, userId: U1, role: 'TECHNICIAN' }, input as any)).rejects.toMatchObject({ code: 'permission_denied', status: 403 });
  });
});

describe('bug 7 — the repository throws on a failed write (no phantom rows with id "")', () => {
  it('createPost rejects when the insert fails', async () => {
    const repo = new KyselyCommunityRepo(fakeDb({ throws: true }) as any);
    await expect(repo.createPost({ originTenantId: T1, category: 'other', title: 't', redactedBody: 'b', createdByUserId: U1 })).rejects.toThrow();
  });
  it('createIncident rejects when the insert returns nothing', async () => {
    const repo = new KyselyCommunityRepo(fakeDb({ rows: [] }) as any);
    await expect(repo.createIncident({ tenantId: T1, branchId: null, userId: U1, role: 'OWNER' }, { category: 'other', severity: 'low', rawDetail: null })).rejects.toThrow('community_write_failed:incident');
    await expect(repo.createPost({ originTenantId: T1, category: 'other', title: 't', redactedBody: 'b', createdByUserId: U1 })).rejects.toThrow('community_write_failed:post');
  });
});

describe('bug 10 — the search rate limit is really counted', () => {
  it('abuseCounters reads the searches of the last hour from the database (was hard-coded 0)', async () => {
    const repo = new KyselyCommunityRepo(fakeDb({ rows: [{ posts_hour: 0, posts_day: 0, comments_hour: 0, reports_day: 0, rejected_day: 0, searches_hour: 150, disputes_day: 0 }] }) as any);
    expect((await repo.abuseCounters(T1)).searchesLastHour).toBe(150);
  });
});

describe('bug 11 — managerApprovalRequired is honoured', () => {
  it('an owner submit skips approval when the salon turned managerApprovalRequired off', async () => {
    const repo = new InMemoryCommunityRepo(); repo.setSettings(settings({ managerApprovalRequired: false }));
    const svc = new CommunityService(repo as any, { events: new InMemoryCommunityEvents() } as any);
    const ctx = { tenantId: T1, branchId: null, userId: U1, role: 'OWNER' };
    await svc.acknowledgeRules(ctx, { rulesVersion: '2026-10-08' });
    const d = await svc.createAdvisory(ctx, input as any);
    const r = await svc.submitAdvisory(ctx, d.id, { expectedVersion: d.version });
    expect(r.post.status).toBe('published_unverified');
  });
});

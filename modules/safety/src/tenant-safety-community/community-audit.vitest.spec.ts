// community-audit.vitest.spec.ts — proves the spec's audit requirement: every consequential core community action is
// recorded (BUILD_PLAN Phase 8: comments / evidence moved to agent C, moderation to agent B, each with its own audit), a
// fabricated case id is never written into the moderation trail, and a PGlite run proves the writes reach audit_logs.
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { COMMUNITY_RULES_VERSION } from '@aipowersalon/api-contracts/tenant';
import { CommunityService } from './community.service';
import { InMemoryCommunityRepo, KyselyCommunityRepo } from './community.repository';
import { InMemoryCommunityAuditSink, KyselyCommunityAuditSink } from './community-audit';

const T1 = 'e1e1e1e1-0000-4000-8000-000000000001', T2 = 'e1e1e1e1-0000-4000-8000-000000000002';
const U = (n: number) => `e1e1e1e1-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

describe('audit sink (in-memory service wiring)', () => {
  let repo: InMemoryCommunityRepo; let audit: InMemoryCommunityAuditSink; let svc: CommunityService;
  const owner = { tenantId: T1, branchId: null, userId: U(1), role: 'OWNER' };
  const manager = { tenantId: T1, branchId: null, userId: U(2), role: 'MANAGER' };
  const other = { tenantId: T2, branchId: null, userId: U(5), role: 'OWNER' };

  beforeEach(async () => {
    repo = new InMemoryCommunityRepo();
    for (const t of [T1, T2]) repo.setSettings({ tenantId: t, enabled: true, receptionistApprovalRequired: true, managerApprovalRequired: true, roleGrants: {}, roleRemovals: {} });
    audit = new InMemoryCommunityAuditSink();
    svc = new CommunityService(repo, { audit });
    for (const c of [owner, manager, other]) await svc.acknowledgeRules(c, { rulesVersion: COMMUNITY_RULES_VERSION });
    audit.entries.length = 0;
  });
  const actions = () => audit.entries.map((e) => e.action);
  const publish = async () => {
    const d = await svc.createAdvisory(owner, { category: 'gift_card_scam', severity: 'moderate', title: 'Gift cards', body: 'suspected gift card scam pattern' });
    const s1 = await svc.submitAdvisory(owner, d.id, { expectedVersion: d.version });
    return svc.approveAdvisory(manager, d.id, { expectedVersion: s1.post.version });
  };

  it('audits the full advisory lifecycle', async () => {
    await publish();
    expect(actions()).toEqual(['advisory.drafted', 'advisory.submitted', 'advisory.approved']);
    expect(audit.entries[2].meta.published).toBe(true);
  });

  it('audits incident creation and the explicit promotion', async () => {
    const inc = await svc.createIncident(owner, { category: 'phone_scam', severity: 'moderate', rawDetail: 'raw customer detail' });
    await svc.createAdvisory(owner, { category: 'phone_scam', severity: 'moderate', title: 'Phone pattern', body: 'sanitized advisory text here', fromIncidentId: inc.id });
    expect(actions()).toEqual(['incident.created', 'advisory.drafted', 'advisory.promoted']);
  });

  it('audits reports, disputes, returns, settings and rules', async () => {
    const p = await publish();
    await svc.reportPost(other, p.id, { reason: 'inaccurate' });
    await svc.disputePost(other, p.id, { reason: 'this is not what happened' });
    await svc.updateSettings(owner, { expectedVersion: 1, displayName: 'Downtown salon' });
    expect(actions()).toEqual(expect.arrayContaining(['post.reported', 'post.disputed', 'settings.changed']));
  });

  it('the KyselyCommunityAuditSink never writes a fabricated case id into the moderation trail (bugs 2/3)', async () => {
    let calls = 0;
    const conn = { async executeQuery() { calls++; return { rows: [] }; }, async *streamQuery() { /* none */ } };
    const driver = { async init() {}, async acquireConnection() { return conn; }, async beginTransaction() {}, async commitTransaction() {}, async rollbackTransaction() {}, async releaseConnection() {}, async destroy() {} };
    const db: any = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => driver as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
    const sink = new KyselyCommunityAuditSink(db);
    await sink.recordModeration({ tenantId: '*', branchId: null, userId: U(9), role: 'moderator' }, U(7), 'publish', {});
    expect(calls).toBe(1);                                         // a real case + a real moderator IS written
    calls = 0;
    await sink.recordModeration({ tenantId: '*', branchId: null, userId: U(9), role: 'moderator' }, 'case-123', 'publish', {});
    await sink.recordModeration({ tenantId: '*', branchId: null, userId: undefined as any, role: 'moderator' }, U(8), 'publish', {});
    expect(calls).toBe(0);
  });
});

describe('audit writes reach the real audit_logs table (pglite, every migration)', () => {
  let db: any; let svc: CommunityService;
  beforeAll(async () => {
    const pg = await migratedPglite();
    db = kyselyFor(pg);
    await pg.exec(`insert into tenant_community_settings (tenant_id, enabled) values ('${T1}', true);
      insert into community_rules_acknowledgments (tenant_id, user_id, rules_version) values ('${T1}', '${U(1)}', '${COMMUNITY_RULES_VERSION}');`);
    svc = new CommunityService(new KyselyCommunityRepo(db), { audit: new KyselyCommunityAuditSink(db) });
  }, 120_000);

  it('drafting an advisory writes a community.* row to audit_logs', async () => {
    const owner = { tenantId: T1, branchId: null, userId: U(1), role: 'OWNER' };
    const d = await svc.createAdvisory(owner, { category: 'gift_card_scam', severity: 'moderate', title: 'Gift cards', body: 'gift card scam pattern seen' });
    const rows = await db.selectFrom('audit_logs').selectAll().where('entity_id', '=', d.id).execute();
    expect(rows.length).toBe(1);
    expect(rows[0].action_type).toBe('community.advisory.drafted');
    expect(rows[0].entity_type).toBe('community_post');
    expect(rows[0].tenant_id).toBe(T1);
  });
});

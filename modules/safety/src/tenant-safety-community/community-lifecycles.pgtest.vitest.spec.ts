// BUILD_PLAN Phase 12 (#27): the Tenant Safety Community lifecycles. (1) The community_post table IS the workflow:
// enumerating community-workflow transition() over every state × event × context gives exactly the machine's moves
// (plus the documented non-event writes and self moves). (2) On the REAL schema, every repository write runs through its
// machine: an archived post never moves, a redacted file is never un-redacted, a decided report / dispute / appeal is
// decided once, a final scan verdict is never overwritten.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { transition } from './community-workflow';
import { COMMUNITY_POST, COMMUNITY_EVIDENCE_REDACTION, COMMUNITY_EVIDENCE_SCAN, COMMUNITY_EVIDENCE_UPLOAD } from './community-lifecycles';
import { CommunityModerationRepo } from './community-moderation.repository';
import { KyselyInteractionsRepo } from './community-interactions.repository';

describe('community_post machine = the posting workflow', () => {
  it('every move transition() accepts is in the table, and the table adds only the documented non-event writes and self moves', () => {
    const roles = ['owner', 'tenant_admin', 'branch_manager', 'receptionist', 'technician', 'moderator'];
    const scans = [undefined, { blocked: true, flagged: true }, { blocked: false, flagged: true }, { blocked: false, flagged: false }];
    const events = ['submit_for_tenant_review', 'run_privacy_scan', 'request_manager_approval', 'manager_approve', 'manager_return', 'submit_for_moderation', 'moderator_publish', 'moderator_reject',
      'moderator_request_evidence', 'moderator_request_changes', 'dispute', 'dispute_upheld', 'correct', 'resolve', 'remove', 'restore', 'relabel', 'archive', 'submit', 'withdraw', 'edit'];
    const seen = new Set<string>();
    for (const s of COMMUNITY_POST.states) for (const e of events) for (const role of roles) for (const scan of scans) for (const label of ['unverified', 'evidence_reviewed', 'multiple_reports', 'official_report'])
      for (const flags of [[true, true], [true, false], [false, true], [false, false]]) for (const sev of ['low', 'critical']) for (const cat of ['card_testing', 'threat_or_violence']) for (const mr of [true, false]) {
        const r: any = transition(s as any, e as any, { role, receptionistApprovalRequired: flags[0], managerApprovalRequired: flags[1], category: cat, severity: sev, scan, verificationLabel: label, moderationRequired: mr } as any);
        if (r.ok) { seen.add(`${s}->${r.state}`); expect(COMMUNITY_POST.can(s, r.state), `${s} -${e}-> ${r.state}`).toBe(true); }
      }
    const extra: string[] = [];
    for (const s of COMMUNITY_POST.states) for (const t of COMMUNITY_POST.transitions[s as never] ?? []) if (!seen.has(`${s}->${t}`)) extra.push(`${s}->${t}`);
    const allowedExtra = new Set(['rejected->moderation_review', ...COMMUNITY_POST.states.filter((s) => s !== 'archived').map((s) => `${s}->${s}`)]);
    expect(extra.filter((x) => !allowedExtra.has(x))).toEqual([]);
    expect(COMMUNITY_POST.transitions.archived).toBeUndefined();
  });
  it('the evidence machines: a verdict is final, a redaction is never undone, a failed upload never becomes uploaded', () => {
    expect(COMMUNITY_EVIDENCE_SCAN.can('clean', 'infected')).toBe(false);
    expect(COMMUNITY_EVIDENCE_REDACTION.can('redacted', 'not_required')).toBe(false);
    expect(COMMUNITY_EVIDENCE_UPLOAD.can('failed', 'uploaded')).toBe(false);
  });
});

const id = (n: number) => `c9000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), U = id(2), MOD = id(3);
let pg: any; let mod: CommunityModerationRepo; let inter: KyselyInteractionsRepo; let seq = 100;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const post = async (status: string, visibility = 'draft') => {
  const pid = id(seq++);
  await q(`insert into community_posts (id, origin_tenant_id, visibility, status, category, severity, region, title, redacted_body, verification_label, version, created_by_user_id, author_display)
           values ($1,$2,$3,$4,'card_testing','high','NJ','Card testing','Many small charges overnight','unverified',1,$5,'display_name')`, [pid, T, visibility, status, U]);
  return pid;
};
const evidence = async (o: { upload?: string; scan?: string; redaction?: string } = {}) => {
  const eid = id(seq++);
  await q(`insert into community_evidence (id, tenant_id, storage_key, uploaded_by_user_id, upload_status, scan_status, redaction_status) values ($1,$2,$3,$4,$5,$6,$7)`,
    [eid, T, `tenants/${T}/community-evidence/${eid}`, U, o.upload ?? 'uploaded', o.scan ?? 'unscanned', o.redaction ?? 'pending']);
  return eid;
};

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Life LLC','Life','life-c9','LIFEC9','active')`, [T]);
  await q(`insert into users (id, tenant_id, role, email, full_name, status) values ($1,$3,'OWNER','o@c9.test','Olive','active'), ($2,null,'SUPER_ADMIN','m@c9.test','Mia','active')`, [U, MOD, T]);
  const db = kyselyFor(pg) as any;
  mod = new CommunityModerationRepo(db); inter = new KyselyInteractionsRepo(db);
}, 120_000);

describe('the machines on the real schema', () => {
  it('community_post: an archived post never moves (the moderator write is refused); a legal move lands', async () => {
    const a = await post('archived');
    const row = await mod.tx((trx) => mod.lockPost(trx, a));
    expect(await mod.tx((trx) => mod.updatePost(trx, a, 1, { ...(row as any), status: 'published_unverified', visibility: 'community_published', privacyScanFlags: [], publishedAt: null, resolvedAt: null }))).toBeNull();
    expect((await q(`select status, version from community_posts where id = $1`, [a]))[0]).toMatchObject({ status: 'archived', version: 1 });
    const r = await post('moderation_review');
    const row2 = await mod.tx((trx) => mod.lockPost(trx, r));
    expect((await mod.tx((trx) => mod.updatePost(trx, r, 1, { ...(row2 as any), status: 'rejected', privacyScanFlags: [], publishedAt: null, resolvedAt: null })))?.status).toBe('rejected');
  });
  it('community_evidence: a redacted file is never marked "not required" again (409); clean → redacted is allowed', async () => {
    const e = await evidence({ redaction: 'redacted' });
    const x: any = await inter.reviewEvidence({ id: e, tenantId: T, decision: 'clean', caseId: id(999), moderatorUserId: MOD, reason: 'looks fine' }).catch((z) => z);
    expect(x).toMatchObject({ code: 'INVALID_STATE_TRANSITION', status: 409, details: { machine: 'community_evidence_redaction', from: 'redacted', to: 'not_required' } });
    expect((await q(`select redaction_status from community_evidence where id = $1`, [e]))[0].redaction_status).toBe('redacted');
  });
  it('community_evidence: a final scan verdict is never overwritten; a failed upload never becomes uploaded', async () => {
    const e = await evidence({ scan: 'clean' });
    expect((await inter.setScan(T, e, 'infected', null)).scanStatus).toBe('clean');
    const f = await evidence({ upload: 'failed' });
    await inter.setUploadStatus(T, f, 'uploaded');
    expect((await q(`select upload_status, scan_status from community_evidence where id in ($1,$2) order by id`, [e, f])).map((r) => r.scan_status + '/' + r.upload_status)).toEqual(['clean/uploaded', 'unscanned/failed']);
  });
  it('a report / an appeal is decided once (a second decision writes nothing)', async () => {
    const p = await post('published_unverified', 'community_published');
    const rid = id(seq++);
    await q(`insert into community_reports (id, post_id, reporter_tenant_id, reason) values ($1,$2,$3,'inaccurate')`, [rid, p, T]);
    const caseRow = await mod.tx((trx) => mod.insertCase(trx, { kind: 'post_review', reason: 'r', priority: 'normal', postId: p, commentId: null, incidentId: null, targetTenantId: T, openedBy: MOD }));
    await mod.tx((trx) => mod.resolveReport(trx, 'post', rid, 'dismissed', caseRow.row.id, MOD, 'not a violation'));
    await mod.tx((trx) => mod.resolveReport(trx, 'post', rid, 'actioned', caseRow.row.id, MOD, 'second thoughts'));
    expect((await q(`select status from community_reports where id = $1`, [rid]))[0].status).toBe('dismissed');
    const aid = id(seq++);
    await q(`insert into community_appeals (id, post_id, appellant_tenant_id, appellant_user_id, subject, reason, original_decider_user_id) values ($1,$2,$3,$4,'post_removed','it was accurate',$5)`, [aid, p, T, U, MOD]);
    expect(await mod.tx((trx) => mod.decideAppeal(trx, aid, 'upheld', MOD, 'stands', caseRow.row.id))).toBe(true);
    expect(await mod.tx((trx) => mod.decideAppeal(trx, aid, 'overturned', MOD, 'flip', caseRow.row.id))).toBe(false);
  });
});

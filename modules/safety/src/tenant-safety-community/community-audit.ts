// community-audit.ts — audit sink for the Safety Community. Every consequential action (incident created,
// advisory drafted/submitted/approved, comment, report, dispute, evidence upload, evidence ACCESS, moderation
// decision) lands in the platform's existing `audit_logs` table — no parallel audit system. Moderator actions
// additionally land in `community_moderation_actions`, keyed by the moderation case, so cross-tenant access is
// always traceable to a case.
//
// Note on tenant scoping: a Super-Admin moderator acts with no tenant of their own (tenantId '*'), and
// audit_logs.tenant_id is a UUID column — so the sink writes NULL for the actor tenant in that case and records
// the affected tenant in the metadata instead. Audit failures never break the user's action (degrade quietly),
// but they are never silently "faked" as success either — the write is simply best-effort, like the platform's
// other audit sinks.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { CommunityCtx } from './community.repository';

export type CommunityAuditAction =
  | 'incident.created' | 'advisory.drafted' | 'advisory.promoted' | 'advisory.submitted'
  | 'advisory.approved' | 'comment.created' | 'post.reported' | 'post.disputed'
  | 'evidence.uploaded' | 'evidence.accessed' | 'evidence.access_denied'
  | 'moderation.published' | 'moderation.rejected' | 'moderation.removed'
  | 'appeal.filed' | 'appeal.upheld' | 'appeal.overturned'
  // BUILD_PLAN Phase 8 (agent A): every core write is audited
  | 'advisory.updated' | 'advisory.returned' | 'advisory.withdrawn' | 'advisory.published' | 'advisory.edited'
  | 'advisory.update_added' | 'advisory.resolved' | 'post.report_threshold_reached' | 'settings.changed'
  | 'rules.acknowledged' | 'search.performed' | 'search.rejected' | 'abuse.blocked';

export interface CommunityAuditSink {
  record(ctx: CommunityCtx, action: CommunityAuditAction, entityId: string, meta?: Record<string, unknown>): Promise<void>;
  recordModeration(ctx: CommunityCtx, caseId: string, action: string, meta?: Record<string, unknown>): Promise<void>;
}

const isUuid = (v: string | null | undefined) => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const exec = async (db: AppDatabase, q: any): Promise<void> => { try { await q.execute(db); } catch { /* audit is best-effort */ } };

export class KyselyCommunityAuditSink implements CommunityAuditSink {
  constructor(private readonly db: AppDatabase) {}

  async record(ctx: CommunityCtx, action: CommunityAuditAction, entityId: string, meta: Record<string, unknown> = {}): Promise<void> {
    // A moderator has no own tenant ('*'): write NULL tenant and keep the actor's scope in metadata.
    const tenantId = isUuid(ctx.tenantId) ? ctx.tenantId : null;
    const userId = isUuid(ctx.userId) ? ctx.userId : null;
    const payload = { ...meta, actorTenant: ctx.tenantId, actorRole: ctx.role };
    await exec(this.db, sql`
      insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
      values (${tenantId}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, ${userId}, ${ctx.role},
              ${`community.${action}`}, 'community_post', ${isUuid(entityId) ? entityId : null},
              ${JSON.stringify(payload)}::jsonb)`);
  }

  /** Moderator decisions also land in the case-keyed moderation trail. */
  async recordModeration(ctx: CommunityCtx, caseId: string, action: string, meta: Record<string, unknown> = {}): Promise<void> {
    // BUILD_PLAN Phase 8 (bugs 2/3): a fabricated case id ('case-<id>') or a missing moderator can never be written —
    // the row would violate NOT NULL and the old code swallowed that. Real cases are agent B's (community-moderation.*).
    if (!isUuid(caseId) || !isUuid(ctx.userId)) return;
    await exec(this.db, sql`
      insert into community_moderation_actions (case_id, action, actor_user_id, detail)
      values (${isUuid(caseId) ? caseId : null}, ${action}, ${isUuid(ctx.userId) ? ctx.userId : null},
              ${JSON.stringify({ ...meta, caseRef: caseId })}::jsonb)`);
  }
}

/** In-memory sink (dev/tests). Records calls so tests can assert what was audited. */
export class InMemoryCommunityAuditSink implements CommunityAuditSink {
  entries: { action: string; entityId: string; actorTenant: string; role: string; meta: Record<string, unknown> }[] = [];
  moderationEntries: { caseId: string; action: string; meta: Record<string, unknown> }[] = [];
  async record(ctx: CommunityCtx, action: CommunityAuditAction, entityId: string, meta: Record<string, unknown> = {}) {
    this.entries.push({ action, entityId, actorTenant: ctx.tenantId, role: ctx.role, meta });
  }
  async recordModeration(_ctx: CommunityCtx, caseId: string, action: string, meta: Record<string, unknown> = {}) {
    this.moderationEntries.push({ caseId, action, meta });
  }
}

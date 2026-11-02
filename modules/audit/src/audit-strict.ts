// audit-strict.ts — Finish the Five (Oct 30 2026): the FAIL-CLOSED write to the central append-only audit_events table.
// AuditService.record() is best-effort on purpose (an audit hiccup must not break an ordinary action). Some actions are
// only allowed WITH their audit row: a commission review transition (the row commits in the same transaction as the
// state change) and a sensitive CSV export (no row → 503, no file). Those callers use this write, inside their own
// transaction handle, and a failure propagates. Only safe metadata goes in — never CSV rows, phone numbers, e-mail
// addresses, tokens or card data; the caller is responsible for what it passes.
import { sql, type Kysely } from 'kysely';
import { redactMetadata } from './audit.dto';

export interface StrictAuditActor { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null }
export interface StrictAuditInput {
  module: string; action: string; resourceType: string; resourceId?: string | null; summary: string;
  status?: 'success' | 'failure' | 'denied'; severity?: 'info' | 'warning' | 'critical';
  metadata?: Record<string, unknown>; reason?: string | null; requestId?: string | null; correlationId?: string | null;
  before?: Record<string, unknown> | null; after?: Record<string, unknown> | null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** insert one audit_events row on `db` (a transaction handle or the root); throws on any failure */
export async function recordAuditStrict(db: Kysely<any>, actor: StrictAuditActor, a: StrictAuditInput): Promise<void> {
  if (!actor?.tenantId) throw new Error('recordAuditStrict: tenant required');
  const user = actor.userId && UUID.test(actor.userId) ? actor.userId : null;
  const branch = actor.branchId && UUID.test(actor.branchId) ? actor.branchId : null;
  await sql`insert into audit_events (tenant_id, branch_id, occurred_at, actor_user_id, actor_role, module, action, resource_type, resource_id, summary, status, severity, metadata,
      before_state, after_state, reason, request_id, correlation_id)
    values (${actor.tenantId}, ${branch}, now(), ${user}, ${actor.role ?? null}, ${a.module}, ${a.action}, ${a.resourceType}, ${a.resourceId ?? null}, ${a.summary.slice(0, 500)}, ${a.status ?? 'success'},
      ${a.severity ?? 'info'}, ${JSON.stringify(a.metadata ?? {})}::jsonb, ${a.before ? JSON.stringify(a.before) : null}::jsonb, ${a.after ? JSON.stringify(a.after) : null}::jsonb,
      ${a.reason ?? null}, ${a.requestId ?? null}, ${a.correlationId ?? a.requestId ?? null})`.execute(db);
}

// The PLATFORM counterpart (Oct 31 2026): a Super Admin action over no salon (tenant_id NULL → audit_logs, the platform
// log — audit_events requires a salon). Same row shape as AuditService.recordPlatform (action_type = module.action,
// metadata redacted, summary folded in) but written on the caller's transaction handle and FAIL-CLOSED: a review or an
// export that cannot leave its audit row does not happen.
export interface StrictPlatformAuditActor { userId?: string | null; role?: string | null }
export interface StrictPlatformAuditInput { module: string; action: string; resourceType: string; resourceId?: string | null; summary?: string; metadata?: Record<string, unknown> }
export async function recordPlatformAuditStrict(db: Kysely<any>, actor: StrictPlatformAuditActor, a: StrictPlatformAuditInput): Promise<void> {
  const user = actor.userId && UUID.test(actor.userId) ? actor.userId : null;
  const metadata = { ...redactMetadata(a.metadata), ...(a.summary ? { summary: a.summary.slice(0, 500) } : {}) };
  await sql`insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
    values (${null}, ${null}, ${user}, ${actor.role ?? null}, ${`${a.module}.${a.action}`}, ${a.resourceType}, ${a.resourceId ?? null}, ${JSON.stringify(metadata)}::jsonb)`.execute(db);
}

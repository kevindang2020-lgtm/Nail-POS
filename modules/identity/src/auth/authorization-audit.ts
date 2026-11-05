// authorization-audit.ts — BUILD_PLAN Phase 9 (Constitution 2 §audit of permission changes): EVERY change to what someone
// may do writes one row to authorization_audit_events (append-only, migration 530: who, whom, what, before / after, why,
// correlation, ip) and one AUTHORIZATION_CHANGED domain event to the outbox — in the SAME transaction as the change, so
// neither can exist without the other. The realtime projection turns the event into `authorization_changed`
// (session / navigation / team-permissions refetch). The audit used to be staff-roles' "old/new template" line only.
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';

export type AuthorizationAction =
  | 'role.assigned' | 'role.base_changed' | 'role.custom_created' | 'role.custom_archived'
  | 'override.granted' | 'override.revoked' | 'override.expired'
  | 'branch_access.changed' | 'ownership.transferred' | 'session.revoked' | 'status.changed' | 'access_review.decided';

export interface AuthorizationChange {
  tenantId: string | null;
  actorUserId: string | null;
  targetUserId: string | null;
  action: AuthorizationAction;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | null | undefined) => (v && UUID.test(v) ? v : null);

/** Write the audit row + the AUTHORIZATION_CHANGED event inside `trx` (pass the transaction, never the root handle). */
export async function recordAuthorizationChange(trx: any, outbox: OutboxWriter | null | undefined, c: AuthorizationChange): Promise<{ correlationId: string; version: number | null }> {
  const target = uuidOrNull(c.targetUserId); const tenantId = uuidOrNull(c.tenantId); const actor = uuidOrNull(c.actorUserId);
  // the version AFTER the change (the triggers bumped it inside this transaction)
  const v: any = target ? (await sql`select authorization_version from users where id = ${target}`.execute(trx)).rows[0] : null;
  const version = v ? Number(v.authorization_version) : null;
  const event = tenantId && outbox ? createDomainEvent({
    eventType: DOMAIN_EVENTS.AUTHORIZATION_CHANGED, tenantId, aggregateType: target ? 'user' : 'tenant', aggregateId: target ?? tenantId,
    actorId: actor ?? undefined, actorType: actor ? 'user' : 'system',
    payload: { userId: target, change: c.action, version },
  }) : null;
  const correlationId = event?.correlationId ?? randomUUID();
  await sql`insert into authorization_audit_events (tenant_id, actor_user_id, target_user_id, action, before_state, after_state, reason, correlation_id, ip)
    values (${tenantId}, ${actor}, ${target}, ${c.action}, ${c.before === undefined ? null : JSON.stringify(c.before)}::jsonb,
            ${c.after === undefined ? null : JSON.stringify(c.after)}::jsonb, ${c.reason ? String(c.reason).slice(0, 500) : null}, ${correlationId}, ${c.ip ? String(c.ip).slice(0, 64) : null})`.execute(trx);
  if (event && outbox) await outbox.write(trx, event);
  return { correlationId, version };
}

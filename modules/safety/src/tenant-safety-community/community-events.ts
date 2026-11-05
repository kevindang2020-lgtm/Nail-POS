// community-events.ts — BUILD_PLAN Phase 8: CommunityEventsPort over the transactional outbox. Every community.*
// domain event is written with the same connection as the change it describes (pass the transaction handle). Realtime
// delivery is the projection consumer's job (apps/api/src/events/consumers/realtime-projection.consumer.ts) — nothing
// in this module emits realtime directly. Payloads carry ids of the RECIPIENT salon's own world only: a post id, a
// status, a severity, a category — never another salon's id or any person.
import type { Kysely } from 'kysely';
import { createDomainEvent, validateDomainEvent, type OutboxWriter, type DomainEventType } from '@aipowersalon/events';
import type { CommunityEventsPort, CommunityAggregateType } from './community.ports';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type EvCtx = { tenantId: string | null; branchId?: string | null; userId?: string | null };

export function communityEvent(ctx: EvCtx, eventType: string, aggregate: { type: CommunityAggregateType; id: string; version?: number | null }, payload: Record<string, unknown>) {
  return createDomainEvent({
    eventType: eventType as DomainEventType,
    tenantId: ctx.tenantId && UUID_RE.test(ctx.tenantId) ? ctx.tenantId : undefined,
    branchId: ctx.branchId && UUID_RE.test(ctx.branchId) ? ctx.branchId : undefined,
    aggregateType: aggregate.type, aggregateId: aggregate.id, aggregateVersion: aggregate.version ?? undefined,
    actorId: ctx.userId && UUID_RE.test(ctx.userId) ? ctx.userId : undefined,
    actorType: ctx.userId && UUID_RE.test(ctx.userId) ? 'user' : 'system',
    payload,
  } as any);
}

export class OutboxCommunityEvents implements CommunityEventsPort {
  constructor(private readonly db: Kysely<any>, private readonly outbox: OutboxWriter) {}
  async emit(ctx: EvCtx, eventType: string, aggregate: { type: CommunityAggregateType; id: string; version?: number | null }, payload: Record<string, unknown>, trx?: unknown): Promise<void> {
    const conn = (trx ?? this.db) as Kysely<any>;
    // The projection fans a salon-wide community event out to the salon's branch rooms, so every user of the salon hears
    // it (a front-desk session sits in one branch room). It cannot look branches up itself — the event carries them.
    const enriched = Array.isArray(payload.branchIds) || !ctx.tenantId || !UUID_RE.test(ctx.tenantId)
      ? payload : { ...payload, branchIds: await salonBranchIds(conn, ctx.tenantId) };
    await this.outbox.write(conn as never, communityEvent(ctx, eventType, aggregate, enriched));
  }
}

/** The salon's active branches (ids only — the recipient salon's own world). */
export async function salonBranchIds(db: Kysely<any>, tenantId: string): Promise<string[]> {
  try {
    const rows = await db.selectFrom('branches').select('id').where('tenant_id', '=', tenantId).where('deleted_at', 'is', null).execute();
    return rows.map((r: any) => String(r.id));
  } catch { return []; }
}

/** Dev / unit tests: records the events, validated exactly as the outbox would. */
export class InMemoryCommunityEvents implements CommunityEventsPort {
  readonly events: { type: string; tenantId: string | null; aggregateId: string; payload: Record<string, unknown> }[] = [];
  async emit(ctx: EvCtx, eventType: string, aggregate: { type: CommunityAggregateType; id: string; version?: number | null }, payload: Record<string, unknown>): Promise<void> {
    const bad = validateDomainEvent(communityEvent(ctx, eventType, aggregate, payload));
    if (bad.length) throw new Error('invalid community event: ' + bad.join(', '));
    this.events.push({ type: eventType, tenantId: ctx.tenantId ?? null, aggregateId: aggregate.id, payload });
  }
}

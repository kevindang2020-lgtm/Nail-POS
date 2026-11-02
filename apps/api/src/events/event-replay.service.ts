// event-replay.service.ts — Constitution 8 §43–47: controlled replay.
//
// The rule that shapes everything here: a replay must never duplicate a real-world effect (§43 — no re-captured
// payment, no re-sent SMS, no re-spent gift card). So replay is NOT a property of an event; it is a property of
// the CONSUMER being replayed into (§44), and a consumer that has not declared itself is NOT_REPLAYABLE.
//
// §45 requires permission, an event range, a consumer, tenant scope, a PREVIEW, a confirmation and an audit —
// so this service has two entry points: preview() answers "what would happen" and changes nothing; run()
// requires the token preview issued. §46: one consumer, one tenant, one range — never platform-wide.
// §47: the ORIGINAL eventId is preserved, because that is what every consumer's processed_events row is keyed
// on. A replay of an event a consumer already processed is therefore a no-op by construction — which is the
// point: rebuilding a projection must not invent new business events.
import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ConsumerRegistry } from './event-transport';
import { ConsumerRunner } from './consumer-runner';
import { replayClassOf, type ReplayClass } from '@aipowersalon/events';
import { rowToEvent } from './outbox-publisher';

export type ReplayRequest = { consumerName: string; tenantId: string; from: string; to: string; eventType?: string; eventId?: string };
export type ReplayPreview = {
  ok: boolean; reason?: string;
  consumerName: string; replayClass: ReplayClass; tenantId: string; from: string; to: string;
  matched: number; alreadyProcessed: number; wouldRun: number; sample: { eventId: string; eventType: string; occurredAt: string }[];
  token?: string;                                    // §45: confirmation — run() will not act without it
};
export type ReplayResult = { ok: boolean; reason?: string; ran: number; processed: number; duplicate: number; failed: number };

const MAX_REPLAY = 5_000;

export class EventReplayService {
  constructor(private readonly db: Kysely<DB>, private readonly registry: ConsumerRegistry, private readonly runner: ConsumerRunner) {}

  /** §45 preview: exactly what run() would do, without doing any of it. */
  async preview(req: ReplayRequest): Promise<ReplayPreview> {
    const base: ReplayPreview = { ok: false, consumerName: req.consumerName, replayClass: 'NOT_REPLAYABLE', tenantId: req.tenantId, from: req.from, to: req.to, matched: 0, alreadyProcessed: 0, wouldRun: 0, sample: [] };
    const consumer = this.registry.get(req.consumerName);
    if (!consumer) return { ...base, reason: 'consumer_not_registered' };
    const replayClass = replayClassOf(consumer);
    if (replayClass === 'NOT_REPLAYABLE') return { ...base, replayClass, reason: 'consumer_not_replayable' };   // §43
    if (!req.tenantId) return { ...base, replayClass, reason: 'tenant_scope_required' };                        // §46
    if (!req.from || !req.to || Number.isNaN(Date.parse(req.from)) || Number.isNaN(Date.parse(req.to))) return { ...base, replayClass, reason: 'range_required' };

    const rows = await this.matching(req, consumer.eventTypes as readonly string[]);
    const already = await this.processedCount(req.consumerName, rows.map((r: any) => r.id));
    const preview: ReplayPreview = {
      ...base, ok: true, replayClass, matched: rows.length, alreadyProcessed: already, wouldRun: rows.length - already,
      sample: rows.slice(0, 5).map((r: any) => ({ eventId: r.id, eventType: r.event_type, occurredAt: new Date(r.occurred_at).toISOString() })),
    };
    if (rows.length > MAX_REPLAY) return { ...preview, ok: false, reason: `range_too_large (${rows.length} > ${MAX_REPLAY})` };
    return { ...preview, token: this.token(req, rows.length) };
  }

  /** §45 run: refuses without the token preview() issued for THIS exact request. */
  async run(req: ReplayRequest, token: string, actor: string): Promise<ReplayResult> {
    // audit_logs.user_id is UUID-typed; a non-UUID actor id would make the audit INSERT throw and (because it is
    // deliberately caught) vanish. Keep the id when it is a UUID, and carry any other form in the metadata.
    const actorUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor) ? actor : null;
    const consumer = this.registry.get(req.consumerName);
    if (!consumer) return { ok: false, reason: 'consumer_not_registered', ran: 0, processed: 0, duplicate: 0, failed: 0 };
    if (replayClassOf(consumer) === 'NOT_REPLAYABLE') return { ok: false, reason: 'consumer_not_replayable', ran: 0, processed: 0, duplicate: 0, failed: 0 };
    const rows = await this.matching(req, consumer.eventTypes as readonly string[]);
    if (rows.length > MAX_REPLAY) return { ok: false, reason: 'range_too_large', ran: 0, processed: 0, duplicate: 0, failed: 0 };
    if (token !== this.token(req, rows.length)) return { ok: false, reason: 'confirmation_token_mismatch', ran: 0, processed: 0, duplicate: 0, failed: 0 };

    let processed = 0, duplicate = 0, failed = 0;
    for (const row of rows) {
      // §47: the ORIGINAL envelope, original eventId. processed_events therefore makes an already-handled
      // event a no-op — a replay rebuilds what is missing and re-does nothing that is already done.
      const outcome = await this.runner.run(consumer, rowToEvent(row));
      if (outcome.status === 'processed') processed++;
      else if (outcome.status === 'duplicate') duplicate++;
      else failed++;
    }
    // §45 audit: who replayed what, when, and with what outcome.
    await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              VALUES (${req.tenantId}, ${actorUuid}, 'SUPER_ADMIN', 'event_replay_executed', 'consumer', ${req.consumerName},
                      ${JSON.stringify({ actor, from: req.from, to: req.to, eventType: req.eventType ?? null, eventId: req.eventId ?? null, ran: rows.length, processed, duplicate, failed })}::jsonb)`
      .execute(this.db).catch(() => { /* the replay HAPPENED; an audit-sink hiccup must not hide that from the caller */ });
    return { ok: true, ran: rows.length, processed, duplicate, failed };
  }

  /** §46: one tenant, one range, only types this consumer subscribes to — never platform-wide. */
  private async matching(req: ReplayRequest, types: readonly string[]): Promise<any[]> {
    let q = this.db.selectFrom('outbox_events').selectAll()
      .where('tenant_id', '=', req.tenantId)
      .where('publish_status', '=', 'published')
      .where('occurred_at', '>=', new Date(req.from))
      .where('occurred_at', '<=', new Date(req.to))
      .where('event_type', 'in', [...types])
      .orderBy('occurred_at', 'asc').limit(MAX_REPLAY + 1);
    if (req.eventType) q = q.where('event_type', '=', req.eventType);
    if (req.eventId) q = q.where('id', '=', req.eventId);
    return q.execute();
  }

  private async processedCount(consumerName: string, ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const r: any = (await sql`SELECT count(*)::int AS n FROM processed_events WHERE consumer_name = ${consumerName} AND event_id = ANY(${ids})`.execute(this.db)).rows[0];
    return Number(r?.n ?? 0);
  }

  /** Binds the confirmation to the exact request AND the row count seen at preview time, so a range that grew
   *  between preview and confirm is refused rather than silently replaying more than the operator approved. */
  private token(req: ReplayRequest, matched: number): string {
    return createHash('sha256').update(JSON.stringify([req.consumerName, req.tenantId, req.from, req.to, req.eventType ?? '', req.eventId ?? '', matched])).digest('hex').slice(0, 16);
  }
}

// deals-release.consumer.ts — BUILD_PLAN Phase 5, bug 12: a cancelled or no-show appointment kept its deal reservation
// forever (releaseDealForAppointment existed and nothing called it), so every cancellation burned one of a capped deal's
// places. This consumer gives the place back on appointment.canceled / appointment.no_show — from EVERY path that
// records them (POS booking, technician app, customer app) — unless the deal was already used on a ticket. The deals
// lifecycle job sweeps the same condition every minute as a safety net for any path that does not emit the event.
import { type EventConsumer, type DomainEvent, DOMAIN_EVENTS, createDomainEvent, OutboxWriter } from '@aipowersalon/events';
import { sql, type Transaction } from 'kysely';
import { canMoveToSql, type DB } from '@aipowersalon/database';
import { DEAL_REDEMPTION_HOLD } from '@aipowersalon/deals';   // Phase 12 (#27)

export class DealsReleaseConsumer implements EventConsumer {
  readonly name = 'deals.release_on_cancel';
  readonly eventTypes = [DOMAIN_EVENTS.APPOINTMENT_CANCELED, DOMAIN_EVENTS.APPOINTMENT_NO_SHOW] as const;
  readonly critical = false;
  // releasing a place that is already released changes nothing — a replay is a no-op by construction
  readonly replay = 'REPLAY_SAFE' as const;
  constructor(private readonly outbox: OutboxWriter = new OutboxWriter()) {}

  async handle(e: DomainEvent<any>, trx: Transaction<DB>): Promise<void> {
    const tenantId = e.tenantId; const appointmentId = e.aggregateId;
    if (!tenantId || !/^[0-9a-f-]{36}$/i.test(String(appointmentId))) return;
    const reason = e.eventType === DOMAIN_EVENTS.APPOINTMENT_NO_SHOW ? 'appointment_no_show' : 'appointment_cancelled';
    const rows = (await sql<{ id: string; deal_id: string }>`
      UPDATE deal_redemption_holds h SET status = 'released', released_reason = ${reason}, updated_at = now()
       WHERE ${canMoveToSql(DEAL_REDEMPTION_HOLD, 'released', 'h')} AND h.tenant_id = ${tenantId} AND h.appointment_id = ${appointmentId} AND h.status IN ('held','consumed')
         AND NOT EXISTS (SELECT 1 FROM deal_redemptions r WHERE r.tenant_id = ${tenantId} AND r.hold_id = h.id AND r.status IN ('applied','redeemed'))
       RETURNING h.id, h.deal_id`.execute(trx)).rows;
    for (const r of rows) {
      await this.outbox.write(trx as any, createDomainEvent({ eventType: DOMAIN_EVENTS.DEAL_RESERVATION_RELEASED, tenantId, branchId: e.branchId, aggregateType: 'deal', aggregateId: String(r.deal_id),
        actorType: 'worker', causationId: e.eventId, correlationId: e.correlationId, payload: { dealId: String(r.deal_id), holdId: String(r.id), appointmentId, reason } }));
      await sql`INSERT INTO deal_analytics_events (deal_id, tenant_id, event_type) VALUES (${r.deal_id}, ${tenantId}, 'cancel')`.execute(trx);
    }
  }
}

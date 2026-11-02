// recipe-usage.consumer.ts — D4 recipes (Oct 22 2026, Kevin: "use the recommended"): a service's product recipe is
// deducted from stock automatically when the service is DONE, not only when someone records it by hand.
//
// Why a consumer and not a hook inside the Service Done transition: there are TWO places a ticket reaches
// service_done — the shared transition (POS serving / tech app) and the split-visit completion
// (tech.kysely.repository completePart) — and both write `service.completed` inside their transaction. The event is
// therefore the one fact that covers every path (§7: one concept, one authority — the ONE deduction lives in
// InventoryService.consumeRecipeForTicketLine; this consumer only feeds it the lines).
//
// Exactly-once on the effect (§25 / §102): processed_events dedupes the delivery, and a `service_usage` movement
// related to the ticket LINE is the business guard — a replay, a redelivery, or both write paths naming the same
// line deduct once. Stock never goes negative (the deduction takes what is on hand and reports the shortfall); a
// manager corrects a wrong deduction with an ordinary, audited stock adjustment (BUG_REGISTER K-03).
// §14: the ticket is loaded tenant-scoped; a mismatch is a security failure, not a retry.
import { type EventConsumer, TenantMismatchError, type DomainEvent, DOMAIN_EVENTS } from '@aipowersalon/events';
import { sql, type Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { InventoryService, InvCtx } from '@aipowersalon/inventory';
import { systemContext } from '@aipowersalon/tenant-context';

export class RecipeUsageConsumer implements EventConsumer {
  readonly name = 'inventory.recipe_usage_on_service_done';
  readonly eventTypes = [DOMAIN_EVENTS.SERVICE_COMPLETED] as const;
  readonly critical = false;                   // stock bookkeeping: standard retries; a salon with no recipes is a no-op
  // §44: safe ONLY because a service_usage movement related to the ticket line refuses a second deduction.
  readonly replay = 'REPLAY_SAFE_WITH_IDEMPOTENCY' as const;

  constructor(private readonly inventory: Pick<InventoryService, 'consumeRecipeForTicketLine'> | null) {}

  async handle(e: DomainEvent<any>, trx: Transaction<DB>): Promise<void> {
    if (!this.inventory) return;
    const tenantId = e.tenantId!; const ticketId = String(e.payload?.ticketId ?? e.aggregateId ?? '');
    if (!ticketId) return;
    const ticket = await trx.selectFrom('tickets').select(['tenant_id', 'branch_id']).where('id', '=', ticketId).executeTakeFirst();
    if (!ticket) return;                                                              // ticket gone → nothing to deduct (§56 revalidate)
    if (String(ticket.tenant_id) !== tenantId) throw new TenantMismatchError(`ticket ${ticketId} belongs to another tenant`);
    if (!ticket.branch_id) return;                                                    // stock is per branch
    // every completed SERVICE line that is still on the ticket (retail lines carry product_id, not a recipe)
    const lines = await sql<{ id: string; service_id: string; quantity: number | null }>`
      SELECT id, service_id, quantity FROM ticket_service_lines
      WHERE tenant_id = ${tenantId} AND ticket_id = ${ticketId} AND removed_at IS NULL AND status = 'completed'
        AND service_id IS NOT NULL AND (line_kind IS NULL OR line_kind <> 'retail') AND product_id IS NULL
      ORDER BY created_at`.execute(trx);
    if (!lines.rows.length) return;
    // the ONE system-context shape (B-14): userId 'system:<job>' — the inventory sinks keep a user id only when it is a UUID
    const ctx: InvCtx = systemContext({ tenantId, branchId: String(ticket.branch_id), actor: 'inventory.recipe_usage_on_service_done' });
    for (const l of lines.rows) {
      await this.inventory.consumeRecipeForTicketLine(ctx, { ticketId, lineId: String(l.id), serviceId: String(l.service_id), quantity: l.quantity }, trx);
    }
  }
}

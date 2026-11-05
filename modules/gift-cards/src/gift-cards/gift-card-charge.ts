// gift-card-charge.ts — the pending gift-card value a customer owes on a ticket: cards SOLD on it (by sale_ticket_id,
// any non-void status — stable across the pending→active flip at payment) plus reload HOLDS on it. Added to the ticket
// total (untaxed) by computeTotals. Shared by the POS checkout totals, the customer display, and the terminal-capture
// charge so every surface derives the SAME amount from current ticket state.
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';

export async function giftCardChargeForTicket(db: Kysely<DB>, tenantId: string, ticketId: string): Promise<number> {
  const [sale, reload] = await Promise.all([
    db.selectFrom('gift_cards').select(sql<number>`coalesce(sum(purchased_cents),0)`.as('c'))
      .where('tenant_id', '=', tenantId).where('sale_ticket_id', '=', ticketId).where('status', '<>', 'void')
      .executeTakeFirst().catch(() => undefined),
    db.selectFrom('gift_card_transactions').select(sql<number>`coalesce(sum(amount_cents),0)`.as('c'))
      .where('tenant_id', '=', tenantId).where('ticket_id', '=', ticketId).where('type', '=', 'hold')
      .executeTakeFirst().catch(() => undefined),
  ]);
  return Number((sale as any)?.c ?? 0) + Number((reload as any)?.c ?? 0);
}

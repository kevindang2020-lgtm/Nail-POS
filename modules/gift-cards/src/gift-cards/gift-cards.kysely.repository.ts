// gift-cards.kysely.repository.ts — Kysely adapter. Tenant/branch scoping is server-derived from ctx
// (never client-supplied), mirroring the shared scoped() pattern used across the codebase.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { branchTimeZone } from '@aipowersalon/database';
import { localDateTimeToEpochMs, addDays } from '@aipowersalon/date-time';
import type { GiftCardsContext, GiftCardRow, GiftCardLedgerRow } from './gift-cards.dto';
import { redemptionSources } from './gift-cards.dto';
import type { GiftCardsRepositoryPort } from './gift-cards.repository';

export class KyselyGiftCardsRepository implements GiftCardsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  private scoped(qb: any, ctx: GiftCardsContext): any {
    let q = qb.where('tenant_id', '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId), eb('branch_id', 'is', null)]));
    return q;
  }

  async listCards(ctx: GiftCardsContext): Promise<GiftCardRow[]> {
    const rows = await this.scoped(this.db.selectFrom('gift_cards'), ctx)
      .select(['id', 'code', 'initial_balance_cents', 'balance_cents', 'status', 'customer_id', 'created_at'])
      .orderBy('created_at', 'desc')
      .limit(500)
      .execute()
      .catch(() => [] as any[]);
    return (rows as any[]).map((r) => ({
      id: String(r.id),
      code: String(r.code),
      initialBalanceCents: Number(r.initial_balance_cents || 0),
      balanceCents: Number(r.balance_cents || 0),
      status: String(r.status),
      customerId: r.customer_id ? String(r.customer_id) : null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    }));
  }

  // Decision 31 — whole-tenant reads (no branch filter): gift-card value is the company's liability.
  async timeZone(ctx: GiftCardsContext): Promise<string> { return branchTimeZone(this.db, ctx.tenantId, ctx.branchId); }
  async ledgerRows(ctx: GiftCardsContext, from: string, to: string, timeZone = 'America/New_York'): Promise<GiftCardLedgerRow[]> {
    // The report's days are the branch's days: [from 00:00, to + 1 day 00:00) in its zone — not UTC days (an 8 pm sale in
    // New Jersey used to land on the next day's report).
    const startMs = localDateTimeToEpochMs(from, '00:00', timeZone), endMs = localDateTimeToEpochMs(addDays(to, 1), '00:00', timeZone);
    // sold_branch: where the card was sold — its first issue/activation row's branch, else the card's own branch — at
    // ANY date, so a card sold last year and redeemed this month still clears to the branch that sold it.
    const rows = await this.db.selectFrom('gift_card_transactions as t').innerJoin('gift_cards as g', (j: any) => j.onRef('g.id', '=', 't.gift_card_id').onRef('g.tenant_id', '=', 't.tenant_id'))
      .select((eb: any) => ['t.id as id', 't.gift_card_id as gift_card_id', 't.branch_id as branch_id', 't.type as type', 't.amount_cents as amount_cents', 't.idempotency_key as idempotency_key',
        eb.fn.coalesce(
          eb.selectFrom('gift_card_transactions as s').select('s.branch_id').whereRef('s.gift_card_id', '=', 't.gift_card_id').whereRef('s.tenant_id', '=', 't.tenant_id')
            .where('s.type', 'in', ['issue', 'activate']).where('s.branch_id', 'is not', null).orderBy('s.created_at').limit(1),
          eb.ref('g.branch_id'),
        ).as('sold_branch_id')])
      .where('t.tenant_id', '=', ctx.tenantId)
      .where('t.created_at', '>=', new Date(startMs) as any).where('t.created_at', '<', new Date(endMs) as any)
      .execute();
    // Decision 31 (Oct 2 2026): which SALES each redemption spent — first in, first out over the card's whole history up to
    // the end of the range (a reload sold at another branch counts for that branch, not the card's first seller).
    const redeemedCards = [...new Set((rows as any[]).filter((r) => r.type === 'redeem').map((r) => String(r.gift_card_id)))];
    const splits = new Map<string, { branchId: string | null; cents: number }[]>();
    if (redeemedCards.length) {
      const hist: any[] = await (this.db as any).selectFrom('gift_card_transactions as h').innerJoin('gift_cards as c', (j: any) => j.onRef('c.id', '=', 'h.gift_card_id').onRef('c.tenant_id', '=', 'h.tenant_id'))
        .select(['h.id as id', 'h.gift_card_id as gift_card_id', 'h.type as type', 'h.idempotency_key as idempotency_key', 'h.amount_cents as amount_cents', 'h.branch_id as branch_id', 'c.branch_id as card_branch_id'])
        .where('h.tenant_id', '=', ctx.tenantId).where('h.gift_card_id', 'in', redeemedCards).where('h.created_at', '<', new Date(endMs))
        .orderBy('h.gift_card_id').orderBy('h.created_at').orderBy('h.id').execute();
      const byCard = new Map<string, any[]>();
      for (const h of hist) { const k = String(h.gift_card_id); if (!byCard.has(k)) byCard.set(k, []); byCard.get(k)!.push(h); }
      for (const [, list] of byCard) {
        const res = redemptionSources(list.map((h) => ({ id: String(h.id), type: String(h.type), idempotencyKey: h.idempotency_key ?? null, amountCents: Number(h.amount_cents || 0), branchId: h.branch_id ? String(h.branch_id) : null })), list[0]?.card_branch_id ? String(list[0].card_branch_id) : null);
        for (const [id, parts] of res) splits.set(id, parts);
      }
    }
    return (rows as any[]).map((r) => ({ sourceSplits: splits.get(String(r.id)), branchId: r.branch_id ? String(r.branch_id) : null, type: String(r.type), amountCents: Number(r.amount_cents || 0), idempotencyKey: r.idempotency_key ?? null, soldBranchId: r.sold_branch_id ? String(r.sold_branch_id) : null }));
  }
  async outstandingLiabilityCents(ctx: GiftCardsContext): Promise<number> {
    const r: any = await this.db.selectFrom('gift_cards').select((eb: any) => eb.fn.coalesce(eb.fn.sum('balance_cents'), eb.lit(0)).as('c'))
      .where('tenant_id', '=', ctx.tenantId).where('status', 'in', ['active', 'frozen', 'partially_redeemed']).where('balance_cents', '>', 0).executeTakeFirst();
    return Number(r?.c ?? 0);
  }
  async branchNames(ctx: GiftCardsContext): Promise<Map<string, string>> {
    const rows = await this.db.selectFrom('branches').select(['id', 'name']).where('tenant_id', '=', ctx.tenantId).execute();
    return new Map((rows as any[]).map((r) => [String(r.id), String(r.name)]));
  }
}

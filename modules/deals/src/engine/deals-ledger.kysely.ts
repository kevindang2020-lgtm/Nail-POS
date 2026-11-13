// deals-ledger.kysely.ts — BUILD_PLAN Phase 5: the ONE ledger of who holds which deal, on which ticket, for how much.
//
//   deal_redemption_holds — the CAPACITY ledger. Every use of a deal holds exactly one place: a booking holds it from the
//     reservation (held → consumed by the appointment), a walk-in ticket holds it from the moment the deal is applied
//     (consumed by the ticket). A place stops counting only when it is released (cancel / no-show / removed / void /
//     refund) or expires unbooked. Bug 1 was that a consumed place stopped counting — a deal capped at N sold N+k.
//   deal_redemptions — the APPLICATION ledger, one row per offer on a ticket: applied → redeemed when the ticket is PAID
//     → released (taken off before payment) / reversed / partially_reversed (void or refund). Bug 4 was that a deal
//     counted as redeemed the moment it was put on a ticket and was never given back.
//
// Every capacity decision runs in ONE transaction under a per-deal advisory lock, so concurrent bookings, registers and
// coupon redemptions serialize on the deal: the cap, the per-customer limit, the budget and a coupon code's uses cannot
// be exceeded (proven on real Postgres: deals-capacity.postgres-race.vitest.spec.ts). The budget and a code's uses are
// ALSO guarded by CHECK constraints, so even a bug here cannot overspend them.
import { utcDate } from '@aipowersalon/date-time';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import type { AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { DEAL_REDEMPTION_HOLD, DEAL_REDEMPTION, DEAL_COUPON_CODE, LIVE_USE_STATUSES } from './deal-lifecycles';
/** round 11: the live uses (applied / redeemed / partly reversed) — one per deal + ticket. */
const LIVE_USES: string[] = [...LIVE_USE_STATUSES];
import type { DealTerms, CustomerFacts } from './eligibility';
import type { OfferRule, LineAllocation } from './pricing';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English
import { refundOutcome } from './refund-outcome';

const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : []);
const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);
const num = (v: any): number | null => (v == null ? null : Number(v));

export class LedgerRefusal extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'LedgerRefusal'; }
}

/** A deal row as the engine needs it: eligibility terms + pricing terms + presentation. */
export interface DealRecord extends DealTerms {
  tenantId: string; title: string; shortDescription: string | null; terms_text: string | null;
  discountType: 'percent' | 'fixed' | 'fixed_price'; discountPercent: number | null; discountCents: number | null; maxDiscountCents: number | null;
  originalPriceCents: number | null; finalPriceCents: number | null;
  stackable: boolean; stackGroup: string | null; priority: number; version: number; redemptionCount: number;
  imageUrl: string | null; ownerType: string; technicianId: string | null;
}

export function dealRule(d: Pick<DealRecord, 'discountType' | 'discountPercent' | 'discountCents' | 'maxDiscountCents'>): OfferRule {
  return { type: d.discountType, percent: d.discountPercent, cents: d.discountCents, maxCents: d.maxDiscountCents };
}

export function toDealRecord(r: any, serviceIds: string[]): DealRecord {
  return {
    id: String(r.id), tenantId: String(r.tenant_id), kind: String(r.kind ?? 'deal'), status: String(r.status), branchId: r.branch_id ? String(r.branch_id) : null,
    ownerType: String(r.owner_type), technicianId: r.technician_id ? String(r.technician_id) : null,
    startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), daysOfWeek: Array.isArray(r.days_of_week) ? r.days_of_week.map(Number) : null,
    validFromMinute: num(r.valid_from_minute), validToMinute: num(r.valid_to_minute),
    newCustomersOnly: !!r.new_customers_only, memberOnly: !!r.member_only, minSpendCents: num(r.min_spend_cents), bookingLeadMinutes: num(r.booking_lead_minutes),
    maxRedemptions: num(r.max_redemptions), maxPerCustomer: num(r.max_per_customer), serviceIds,
    channels: Array.isArray(r.channels) ? r.channels.map(String) : null, requiresCode: !!r.requires_code,
    rules: r.rules && typeof r.rules === 'object' ? r.rules : (typeof r.rules === 'string' ? JSON.parse(r.rules) : null),
    suspendedAt: iso(r.suspended_at), budgetCents: num(r.budget_cents), budgetReservedCents: Number(r.budget_reserved_cents ?? 0),
    allowTechSubstitution: !!r.allow_tech_substitution,
    title: String(r.title), shortDescription: r.short_description ?? null, terms_text: r.terms ?? null, imageUrl: r.image_url ?? null,
    discountType: String(r.discount_type) as any, discountPercent: num(r.discount_percent), discountCents: num(r.discount_cents), maxDiscountCents: num(r.max_discount_cents),
    originalPriceCents: num(r.original_price_cents), finalPriceCents: num(r.final_price_cents),
    stackable: !!r.stackable, stackGroup: r.stack_group ?? null, priority: Number(r.priority ?? 100), version: Number(r.version ?? 1), redemptionCount: Number(r.redemption_count ?? 0),
  };
}

/** What a customer saw and agreed to — frozen on the application so a later edit never changes a sale. */
export function termsSnapshot(d: DealRecord): Record<string, unknown> {
  return { dealId: d.id, version: d.version, title: d.title, kind: d.kind, discountType: d.discountType, discountPercent: d.discountPercent, discountCents: d.discountCents,
    maxDiscountCents: d.maxDiscountCents, serviceIds: d.serviceIds, stackable: d.stackable, stackGroup: d.stackGroup, terms: d.terms_text };
}

export interface TicketFacts { ticketId: string; tenantId: string; branchId: string; customerId: string | null; status: string; paymentStatus: string;
  lines: { lineId: string; serviceId: string | null; priceCents: number }[]; appointmentId: string | null }

export interface LiveApplication {
  redemptionId: string; dealId: string; kind: string; status: string; holdId: string | null; couponCodeId: string | null;
  discountCents: number; lines: LineAllocation[]; dealVersion: number; terms: Record<string, any> | null; customerId: string | null; appliedAt: string | null;
}

export interface ApplyInput {
  tenantId: string; branchId: string; ticketId: string; customerId: string | null; dealId: string; kind: 'deal' | 'coupon' | 'automatic';
  /** the booking's consumed hold for this deal, when the ticket came from a booked appointment */
  appointmentHoldId?: string | null; appointmentId?: string | null;
  couponCodeId?: string | null; discountCents: number; lines: LineAllocation[]; terms: Record<string, unknown>; dealVersion: number; userId: string | null;
  /** Deals & Offers 08: the ticket's lines when this discount was first priced (kept once in estimate_snapshot) */
  estimateLines?: { lineId: string; priceCents: number }[];
}

export class KyselyDealsLedger {
  constructor(private readonly db: AppDatabase, private readonly outbox: OutboxWriter | null = null) {}
  private get d(): any { return this.db; }

  // ── reads ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  async deal(tenantId: string, id: string, trx?: any): Promise<DealRecord | null> {
    const q = trx ?? this.d;
    const r = rowsOf(await sql`SELECT * FROM deals WHERE tenant_id = ${tenantId} AND (id::text = ${id} OR (legacy_id::text = ${id} AND legacy_source IS NOT NULL)) LIMIT 1`.execute(q))[0];
    if (!r) return null;
    const services = rowsOf(await sql`SELECT service_id FROM deal_services WHERE tenant_id = ${tenantId} AND deal_id = ${r.id}`.execute(q)).map((x) => String(x.service_id));
    return toDealRecord(r, services);
  }

  /** Every deal of a kind the POS may offer on a ticket: live (active) and redeemable. */
  async liveDeals(tenantId: string, kinds: string[] = ['deal', 'coupon', 'automatic']): Promise<DealRecord[]> {
    const rows = rowsOf(await sql`SELECT * FROM deals WHERE tenant_id = ${tenantId} AND status = 'active' AND kind IN (${sql.join(kinds)}) ORDER BY priority, created_at LIMIT 200`.execute(this.d));
    if (!rows.length) return [];
    const svc = rowsOf(await sql`SELECT deal_id, service_id FROM deal_services WHERE tenant_id = ${tenantId} AND deal_id IN (${sql.join(rows.map((r) => r.id))})`.execute(this.d));
    return rows.map((r) => toDealRecord(r, svc.filter((s) => String(s.deal_id) === String(r.id)).map((s) => String(s.service_id))));
  }

  async ticket(tenantId: string, ticketId: string): Promise<TicketFacts | null> {
    const t = rowsOf(await sql`SELECT t.id, t.branch_id, t.customer_id, t.status, t.payment_status, q.appointment_id
                                 FROM tickets t LEFT JOIN pos_queue_items q ON q.id = t.queue_item_id AND q.tenant_id = t.tenant_id
                                WHERE t.tenant_id = ${tenantId} AND t.id = ${ticketId} LIMIT 1`.execute(this.d))[0];
    if (!t) return null;
    const lines = rowsOf(await sql`SELECT id, service_id, line_total_cents FROM ticket_service_lines
                                    WHERE tenant_id = ${tenantId} AND ticket_id = ${ticketId} AND removed_at IS NULL ORDER BY created_at, id`.execute(this.d));
    return { ticketId: String(t.id), tenantId, branchId: String(t.branch_id), customerId: t.customer_id ? String(t.customer_id) : null, status: String(t.status), paymentStatus: String(t.payment_status ?? 'unpaid'),
      lines: lines.map((l) => ({ lineId: String(l.id), serviceId: l.service_id ? String(l.service_id) : null, priceCents: Number(l.line_total_cents || 0) })), appointmentId: t.appointment_id ? String(t.appointment_id) : null };
  }

  async customerFacts(tenantId: string, customerId: string | null, excludeTicketId?: string | null): Promise<CustomerFacts | null> {
    if (!customerId) return null;
    const v = rowsOf(await sql`SELECT count(*)::int AS n, max(paid_at) AS last FROM tickets
                                WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND (status = 'paid' OR payment_status = 'paid')
                                  ${excludeTicketId ? sql`AND id <> ${excludeTicketId}` : sql``}`.execute(this.d))[0];
    const m = rowsOf(await sql`SELECT 1 FROM customer_memberships WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND status = 'active' LIMIT 1`.execute(this.d).catch(() => ({ rows: [] })));
    const c = rowsOf(await sql`SELECT birthday FROM customers WHERE tenant_id = ${tenantId} AND id = ${customerId} LIMIT 1`.execute(this.d).catch(() => ({ rows: [] })))[0];
    const bm = c?.birthday ? new Date(c.birthday).getUTCMonth() + 1 : null;
    return { id: customerId, paidVisits: Number(v?.n ?? 0), isMember: m.length > 0, birthdayMonth: bm, lastVisitAt: v?.last ? new Date(v.last).getTime() : null };
  }

  async branchTimezone(tenantId: string, branchId: string | null): Promise<string | null> {
    if (!branchId) return null;
    const r = rowsOf(await sql`SELECT timezone FROM branches WHERE tenant_id = ${tenantId} AND id = ${branchId} LIMIT 1`.execute(this.d))[0];
    return r?.timezone ?? null;
  }

  /** Places taken (held-and-unexpired, consumed, redeemed) and this customer's own. */
  async usage(tenantId: string, dealId: string, customerId: string | null, trx?: any): Promise<{ taken: number; byCustomer: number }> {
    const r = rowsOf(await sql`SELECT count(*) FILTER (WHERE status IN ('consumed','redeemed') OR (status = 'held' AND expires_at > now()))::int AS taken,
                                      count(*) FILTER (WHERE customer_id = ${customerId} AND (status IN ('consumed','redeemed') OR (status = 'held' AND expires_at > now())))::int AS mine
                                 FROM deal_redemption_holds WHERE tenant_id = ${tenantId} AND deal_id = ${dealId}`.execute(trx ?? this.d))[0];
    return { taken: Number(r?.taken ?? 0), byCustomer: customerId ? Number(r?.mine ?? 0) : 0 };
  }

  async liveApplications(tenantId: string, ticketId: string): Promise<LiveApplication[]> {
    return rowsOf(await sql`SELECT * FROM deal_redemptions WHERE tenant_id = ${tenantId} AND ticket_id = ${ticketId} AND status IN ('applied','redeemed') ORDER BY applied_at, id`.execute(this.d)).map(toApplication);
  }
  async applicationsForTicket(tenantId: string, ticketId: string): Promise<LiveApplication[]> {
    return rowsOf(await sql`SELECT * FROM deal_redemptions WHERE tenant_id = ${tenantId} AND ticket_id = ${ticketId} ORDER BY applied_at, id`.execute(this.d)).map(toApplication);
  }

  /** The consumed hold an appointment booked for a deal (a ticket made from the appointment inherits it). */
  async appointmentHold(tenantId: string, appointmentId: string): Promise<{ holdId: string; dealId: string; dealVersion: number | null; ticketId: string | null } | null> {
    const r = rowsOf(await sql`SELECT id, deal_id, deal_version, ticket_id FROM deal_redemption_holds WHERE tenant_id = ${tenantId} AND appointment_id = ${appointmentId} AND status = 'consumed' ORDER BY created_at LIMIT 1`.execute(this.d))[0];
    return r ? { holdId: String(r.id), dealId: String(r.deal_id), dealVersion: num(r.deal_version), ticketId: r.ticket_id ? String(r.ticket_id) : null } : null;
  }

  // ── booking: reserve a place ──────────────────────────────────────────────────────────────────────────────────────
  /** Reserve one place for a booking. Capacity and the per-customer limit are re-read under the deal's lock. */
  async reserveForBooking(tenantId: string, dealId: string, customerId: string, idempotencyKey: string, expiresAtIso: string, limits: { maxRedemptions: number | null; maxPerCustomer: number | null }, actorId: string | null): Promise<{ soldOut: boolean; holdId?: string; alreadyHeld?: boolean; limitReached?: boolean }> {
    return this.d.transaction().execute(async (trx: any) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'dealhold:' + dealId}, 0))`.execute(trx);
      await this.expireStale(tenantId, dealId, trx);
      const prior = rowsOf(await sql`SELECT id, status FROM deal_redemption_holds WHERE tenant_id = ${tenantId} AND deal_id = ${dealId} AND idempotency_key = ${idempotencyKey} LIMIT 1`.execute(trx))[0];
      if (prior && ['held', 'consumed', 'redeemed'].includes(String(prior.status))) return { soldOut: false, holdId: String(prior.id), alreadyHeld: true };
      const status = rowsOf(await sql`SELECT status FROM deals WHERE tenant_id = ${tenantId} AND id = ${dealId} FOR UPDATE`.execute(trx))[0];
      if (!status || status.status !== 'active') return { soldOut: true };
      const u = await this.usage(tenantId, dealId, customerId, trx);
      if (limits.maxRedemptions != null && u.taken >= limits.maxRedemptions) return { soldOut: true };
      if (limits.maxPerCustomer != null && u.byCustomer >= limits.maxPerCustomer) return { soldOut: false, limitReached: true };
      const key = prior ? `${idempotencyKey}:${Date.now()}` : idempotencyKey;   // a released/expired key may be reused
      const row = rowsOf(await sql`INSERT INTO deal_redemption_holds (deal_id, tenant_id, customer_id, idempotency_key, status, expires_at)
                                    VALUES (${dealId}, ${tenantId}, ${customerId}, ${key}, 'held', ${expiresAtIso}) RETURNING id`.execute(trx))[0];
      await this.event(trx, DOMAIN_EVENTS.DEAL_RESERVED, tenantId, null, 'deal', dealId, actorId, { dealId, holdId: String(row.id), customerId });
      return { soldOut: false, holdId: String(row.id), alreadyHeld: false };
    });
  }

  async consumeForAppointment(tenantId: string, holdId: string, appointmentId: string, dealVersion: number): Promise<boolean> {
    const r = rowsOf(await sql`UPDATE deal_redemption_holds SET status = 'consumed', appointment_id = ${appointmentId}, deal_version = ${dealVersion}, updated_at = now()
                                WHERE ${canMoveToSql(DEAL_REDEMPTION_HOLD, 'consumed')} AND tenant_id = ${tenantId} AND id = ${holdId} AND status = 'held' AND expires_at > now() RETURNING id`.execute(this.d))[0];
    return !!r;
  }

  async releaseHold(tenantId: string, holdId: string, reason: string): Promise<boolean> {
    return this.d.transaction().execute(async (trx: any) => {
      const r = rowsOf(await sql`UPDATE deal_redemption_holds SET status = 'released', released_reason = ${reason}, updated_at = now()
                                  WHERE ${canMoveToSql(DEAL_REDEMPTION_HOLD, 'released')} AND tenant_id = ${tenantId} AND id = ${holdId} AND status IN ('held','consumed') RETURNING id, deal_id`.execute(trx))[0];
      if (r) await this.event(trx, DOMAIN_EVENTS.DEAL_RESERVATION_RELEASED, tenantId, null, 'deal', String(r.deal_id), null, { dealId: String(r.deal_id), holdId, reason });
      return !!r;
    });
  }

  /** Cancel / no-show: the appointment's places come back — unless the deal was already used on a ticket. */
  async releaseForAppointment(tenantId: string, appointmentId: string, reason: string): Promise<number> {
    return this.d.transaction().execute(async (trx: any) => {
      const rows = rowsOf(await sql`UPDATE deal_redemption_holds h SET status = 'released', released_reason = ${reason}, updated_at = now()
                                     WHERE ${canMoveToSql(DEAL_REDEMPTION_HOLD, 'released', 'h')} AND h.tenant_id = ${tenantId} AND h.appointment_id = ${appointmentId} AND h.status IN ('held','consumed')
                                       AND NOT EXISTS (SELECT 1 FROM deal_redemptions r WHERE r.tenant_id = ${tenantId} AND r.hold_id = h.id AND r.status = ANY(${LIVE_USES}::text[]))
                                     RETURNING h.id, h.deal_id`.execute(trx));
      for (const r of rows) await this.event(trx, DOMAIN_EVENTS.DEAL_RESERVATION_RELEASED, tenantId, null, 'deal', String(r.deal_id), null, { dealId: String(r.deal_id), holdId: String(r.id), appointmentId, reason });
      return rows.length;
    });
  }

  // ── checkout: apply, release, paid, reversed ─────────────────────────────────────────────────────────────────────
  /** Put a deal / coupon on a ticket: one place, the budget, the code's use, the application row — all or nothing. */
  async apply(i: ApplyInput, limits: { maxRedemptions: number | null; maxPerCustomer: number | null; budgetCents: number | null }): Promise<LiveApplication> {
    return this.d.transaction().execute(async (trx: any) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'dealhold:' + i.dealId}, 0))`.execute(trx);
      const existing = rowsOf(await sql`SELECT * FROM deal_redemptions WHERE tenant_id = ${i.tenantId} AND ticket_id = ${i.ticketId} AND deal_id = ${i.dealId} AND status = ANY(${LIVE_USES}::text[]) ORDER BY id LIMIT 1`.execute(trx))[0];
      // round 11 (Deals live-use count): a PARTLY reversed use is still this ticket's use of the offer — its place and count
      // stay — so the offer cannot be applied to the same ticket a second time (it used to be: a second completed use).
      if (existing?.status === 'partially_reversed') throw withCode(new LedgerRefusal('used_on_ticket', 'This offer was already used on this ticket (part of it was refunded).'), 'DEAL_REFUSED');
      if (existing) return toApplication(existing);   // idempotent: applying the same deal twice is one application
      const live = rowsOf(await sql`SELECT status FROM deals WHERE tenant_id = ${i.tenantId} AND id = ${i.dealId} FOR UPDATE`.execute(trx))[0];
      if (!live || live.status !== 'active') throw withCode(new LedgerRefusal('not_active', 'This deal is not available.'), 'DEAL_NOT_AVAILABLE');
      await this.expireStale(i.tenantId, i.dealId, trx);
      let holdId: string;
      const booked = i.appointmentHoldId
        ? rowsOf(await sql`UPDATE deal_redemption_holds SET ticket_id = ${i.ticketId}, updated_at = now() WHERE tenant_id = ${i.tenantId} AND id = ${i.appointmentHoldId} AND deal_id = ${i.dealId} AND status = 'consumed' RETURNING id`.execute(trx))[0]
        : null;
      if (booked) holdId = String(booked.id);
      else {
        const u = await this.usage(i.tenantId, i.dealId, i.customerId, trx);
        if (limits.maxRedemptions != null && u.taken >= limits.maxRedemptions) throw withCode(new LedgerRefusal('sold_out', 'This deal has sold out.'), 'DEAL_SOLD_OUT');
        if (limits.maxPerCustomer != null && i.customerId && u.byCustomer >= limits.maxPerCustomer) throw withCode(new LedgerRefusal('per_customer_limit', 'Already used — the limit per customer.'), 'DEAL_PER_CUSTOMER_LIMIT');
        const h = rowsOf(await sql`INSERT INTO deal_redemption_holds (deal_id, tenant_id, customer_id, idempotency_key, status, expires_at, ticket_id, appointment_id)
                                    VALUES (${i.dealId}, ${i.tenantId}, ${i.customerId}, ${'ticket:' + i.ticketId + ':' + randomUUID()}, 'consumed', now(), ${i.ticketId}, ${i.appointmentId ?? null})
                                    RETURNING id`.execute(trx))[0];
        holdId = String(h.id);
      }
      let budget = 0;
      if (limits.budgetCents != null && i.discountCents > 0) {
        const ok = rowsOf(await sql`UPDATE deals SET budget_reserved_cents = budget_reserved_cents + ${i.discountCents}
                                     WHERE tenant_id = ${i.tenantId} AND id = ${i.dealId} AND budget_cents IS NOT NULL AND budget_reserved_cents + ${i.discountCents} <= budget_cents RETURNING id`.execute(trx))[0];
        if (!ok) throw withCode(new LedgerRefusal('budget_exhausted', 'This deal’s budget has been used up.'), 'DEAL_BUDGET_USED');
        budget = i.discountCents;
      }
      if (i.couponCodeId) {
        const c = rowsOf(await sql`UPDATE deal_coupon_codes SET use_count = use_count + 1, updated_at = now(),
                                      status = CASE WHEN (single_use AND use_count + 1 >= 1) OR (max_uses IS NOT NULL AND use_count + 1 >= max_uses) THEN 'exhausted' ELSE status END
                                    WHERE tenant_id = ${i.tenantId} AND id = ${i.couponCodeId} AND deal_id = ${i.dealId} AND status = 'active' AND ${canMoveToSql(DEAL_COUPON_CODE, 'exhausted')}
                                      AND (expires_at IS NULL OR expires_at > now()) AND (customer_id IS NULL OR customer_id = ${i.customerId})
                                      AND (max_uses IS NULL OR use_count < max_uses) AND (NOT single_use OR use_count < 1)
                                    RETURNING id`.execute(trx))[0];
        if (!c) throw withCode(new LedgerRefusal('code_used', 'That code has already been used or is no longer valid.'), 'DEAL_CODE_USED');
      }
      // Deals & Offers 08: the figure the desk first saw, kept once (migration 871 makes it immutable)
      const estimate = i.estimateLines ? JSON.stringify({ discountCents: i.discountCents, allocations: i.lines, lines: i.estimateLines.map((l) => ({ lineId: l.lineId, priceCents: l.priceCents })) }) : null;
      const row = rowsOf(await sql`INSERT INTO deal_redemptions (deal_id, tenant_id, branch_id, customer_id, appointment_id, ticket_id, amount_discounted_cents, deal_version,
                                      status, kind, hold_id, coupon_code_id, line_allocations, terms_snapshot, applied_by_user_id, budget_reserved_cents, estimate_snapshot)
                                    VALUES (${i.dealId}, ${i.tenantId}, ${i.branchId}, ${i.customerId}, ${i.appointmentId ?? null}, ${i.ticketId}, ${i.discountCents}, ${i.dealVersion},
                                      'applied', ${i.kind}, ${holdId}, ${i.couponCodeId ?? null}, ${JSON.stringify(i.lines)}::jsonb, ${JSON.stringify(i.terms)}::jsonb, ${i.userId}, ${budget}, ${estimate}::jsonb)
                                    RETURNING *`.execute(trx))[0];
      await this.event(trx, DOMAIN_EVENTS.DEAL_APPLIED, i.tenantId, i.branchId, 'deal_redemption', String(row.id), i.userId,
        { redemptionId: String(row.id), dealId: i.dealId, ticketId: i.ticketId, kind: i.kind, discountCents: i.discountCents });
      await this.analytics(trx, i.tenantId, i.dealId, i.customerId, 'apply');
      return toApplication(row);
    });
  }

  /** The discount an application carries changed (lines changed, another offer won). Budget follows the amount. */
  async syncAmount(tenantId: string, redemptionId: string, discountCents: number, lines: LineAllocation[]): Promise<void> {
    await this.d.transaction().execute(async (trx: any) => {
      const r = rowsOf(await sql`SELECT deal_id, amount_discounted_cents, budget_reserved_cents, status FROM deal_redemptions WHERE tenant_id = ${tenantId} AND id = ${redemptionId} FOR UPDATE`.execute(trx))[0];
      if (!r || r.status !== 'applied') return;
      const budgeted = Number(r.budget_reserved_cents || 0);
      let newBudget = budgeted;
      if (budgeted > 0 || discountCents > Number(r.amount_discounted_cents)) {
        const deal = rowsOf(await sql`SELECT budget_cents FROM deals WHERE tenant_id = ${tenantId} AND id = ${r.deal_id}`.execute(trx))[0];
        if (deal?.budget_cents != null) {
          const delta = discountCents - budgeted;
          const ok = rowsOf(await sql`UPDATE deals SET budget_reserved_cents = budget_reserved_cents + ${delta} WHERE tenant_id = ${tenantId} AND id = ${r.deal_id}
                                       AND budget_reserved_cents + ${delta} <= budget_cents AND budget_reserved_cents + ${delta} >= 0 RETURNING id`.execute(trx))[0];
          if (!ok) throw withCode(new LedgerRefusal('budget_exhausted', 'This deal’s budget has been used up.'), 'DEAL_BUDGET_USED');
          newBudget = discountCents;
        }
      }
      await sql`UPDATE deal_redemptions SET amount_discounted_cents = ${discountCents}, line_allocations = ${JSON.stringify(lines)}::jsonb, budget_reserved_cents = ${newBudget}, updated_at = now()
                 WHERE tenant_id = ${tenantId} AND id = ${redemptionId} AND status = 'applied'`.execute(trx);
    });
  }

  /** Take an application off an unpaid ticket: the place, the budget and the code's use come back. */
  async release(tenantId: string, redemptionId: string, reason: string, actorId: string | null): Promise<boolean> {
    return this.d.transaction().execute(async (trx: any) => {
      const r = rowsOf(await sql`UPDATE deal_redemptions SET status = 'released', reversal_reason = ${reason}, updated_at = now()
                                  WHERE ${canMoveToSql(DEAL_REDEMPTION, 'released')} AND tenant_id = ${tenantId} AND id = ${redemptionId} AND status = 'applied' RETURNING *`.execute(trx))[0];
      if (!r) return false;
      await this.giveBack(trx, tenantId, r, reason);
      await this.event(trx, DOMAIN_EVENTS.DEAL_RESERVATION_RELEASED, tenantId, r.branch_id, 'deal', String(r.deal_id), actorId, { dealId: String(r.deal_id), redemptionId, ticketId: r.ticket_id, reason });
      await this.analytics(trx, tenantId, String(r.deal_id), r.customer_id, 'release');
      return true;
    });
  }

  /** The ticket is PAID: every application on it is redeemed now (idempotent). A zero-value one is released instead. */
  async markTicketPaid(tenantId: string, ticketId: string): Promise<{ redeemed: number; released: number }> {
    return this.d.transaction().execute(async (trx: any) => {
      const rows = rowsOf(await sql`SELECT * FROM deal_redemptions WHERE tenant_id = ${tenantId} AND ticket_id = ${ticketId} AND status = 'applied' ORDER BY id FOR UPDATE`.execute(trx));
      let redeemed = 0; let released = 0;
      for (const r of rows) {
        if (Number(r.amount_discounted_cents) <= 0) {
          await sql`UPDATE deal_redemptions SET status = 'released', reversal_reason = 'no_value_at_payment', updated_at = now() WHERE ${canMoveToSql(DEAL_REDEMPTION, 'released')} AND tenant_id = ${tenantId} AND id = ${r.id}`.execute(trx);
          await this.giveBack(trx, tenantId, r, 'no_value_at_payment'); released++; continue;
        }
        await sql`UPDATE deal_redemptions SET status = 'redeemed', redeemed_at = now(), updated_at = now() WHERE ${canMoveToSql(DEAL_REDEMPTION, 'redeemed')} AND tenant_id = ${tenantId} AND id = ${r.id}`.execute(trx);
        if (r.hold_id) await sql`UPDATE deal_redemption_holds SET status = 'redeemed', updated_at = now() WHERE ${canMoveToSql(DEAL_REDEMPTION_HOLD, 'redeemed')} AND tenant_id = ${tenantId} AND id = ${r.hold_id}`.execute(trx);
        await sql`UPDATE deals SET redemption_count = redemption_count + 1 WHERE tenant_id = ${tenantId} AND id = ${r.deal_id}`.execute(trx);
        const coupon = r.kind === 'coupon';
        await this.event(trx, coupon ? DOMAIN_EVENTS.COUPON_REDEEMED : DOMAIN_EVENTS.DEAL_REDEEMED, tenantId, r.branch_id, coupon ? 'coupon_redemption' : 'deal_redemption', String(r.id), r.applied_by_user_id,
          { redemptionId: String(r.id), dealId: String(r.deal_id), ticketId, customerId: r.customer_id ?? null, appointmentId: r.appointment_id ?? null, amountDiscountedCents: Number(r.amount_discounted_cents), discountCents: Number(r.amount_discounted_cents) });
        await this.analytics(trx, tenantId, String(r.deal_id), r.customer_id, 'redemption');
        redeemed++;
      }
      return { redeemed, released };
    });
  }

  /**
   * Void / refund. `lineIds` null = the whole ticket: every redeemed application is reversed and its place, budget and
   * code use come back. With lines: an application whose discounted lines are ALL refunded is reversed; one that is only
   * partly refunded is partially_reversed (the share on the refunded lines is recorded; the place stays used — the
   * customer kept part of the service). Applications still 'applied' (unpaid ticket) are simply released.
   */
  async reverseForTicket(tenantId: string, ticketId: string, lineIds: string[] | null, reason: string, actorId: string | null): Promise<{ reversed: number; partial: number; reversedCents: number }> {
    return this.d.transaction().execute(async (trx: any) => {
      const rows = rowsOf(await sql`SELECT * FROM deal_redemptions WHERE tenant_id = ${tenantId} AND ticket_id = ${ticketId} AND status IN ('applied','redeemed','partially_reversed') ORDER BY id FOR UPDATE`.execute(trx));
      let reversed = 0; let partial = 0; let reversedCents = 0;
      for (const r of rows) {
        const already = Number(r.reversed_cents || 0);
        const total = Number(r.amount_discounted_cents || 0);
        const out = refundOutcome(r, lineIds);   // the one refund rule (engine/refund-outcome.ts), shared with the read-only preview
        const allLines = out.kind === 'reverse';
        if (r.status === 'applied') {
          if (!lineIds) { await sql`UPDATE deal_redemptions SET status = 'released', reversal_reason = ${reason}, updated_at = now() WHERE ${canMoveToSql(DEAL_REDEMPTION, 'released')} AND tenant_id = ${tenantId} AND id = ${r.id}`.execute(trx); await this.giveBack(trx, tenantId, r, reason); }
          continue;
        }
        if (allLines) {
          await sql`UPDATE deal_redemptions SET status = 'reversed', reversed_at = now(), reversal_reason = ${reason}, reversed_cents = ${total}, updated_at = now() WHERE ${canMoveToSql(DEAL_REDEMPTION, 'reversed')} AND tenant_id = ${tenantId} AND id = ${r.id}`.execute(trx);
          await sql`UPDATE deals SET redemption_count = GREATEST(0, redemption_count - 1) WHERE tenant_id = ${tenantId} AND id = ${r.deal_id}`.execute(trx);
          await this.giveBack(trx, tenantId, r, reason);
          reversed++; reversedCents += total - already;
          await this.event(trx, DOMAIN_EVENTS.DEAL_REDEMPTION_REVERSED, tenantId, r.branch_id, 'deal_redemption', String(r.id), actorId, { redemptionId: String(r.id), dealId: String(r.deal_id), ticketId, kind: r.kind, full: true, reversedCents: total - already, reason });
          await this.analytics(trx, tenantId, String(r.deal_id), r.customer_id, 'reversal');
        } else if (out.kind === 'partial') {
          const next = out.nextReversedCents;
          await sql`UPDATE deal_redemptions SET status = 'partially_reversed', reversed_at = now(), reversal_reason = ${reason}, reversed_cents = ${next}, updated_at = now() WHERE ${canMoveToSql(DEAL_REDEMPTION, 'partially_reversed')} AND tenant_id = ${tenantId} AND id = ${r.id}`.execute(trx);
          partial++; reversedCents += next - already;
          await this.event(trx, DOMAIN_EVENTS.DEAL_REDEMPTION_REVERSED, tenantId, r.branch_id, 'deal_redemption', String(r.id), actorId, { redemptionId: String(r.id), dealId: String(r.deal_id), ticketId, kind: r.kind, full: false, reversedCents: next - already, reason });
        }
      }
      return { reversed, partial, reversedCents };
    });
  }

  /** The place, the budget and the code's use go back (release or full reversal). */
  private async giveBack(trx: any, tenantId: string, r: any, reason: string): Promise<void> {
    if (r.hold_id) await sql`UPDATE deal_redemption_holds SET status = 'released', released_reason = ${reason}, updated_at = now() WHERE ${canMoveToSql(DEAL_REDEMPTION_HOLD, 'released')} AND tenant_id = ${tenantId} AND id = ${r.hold_id} AND status IN ('held','consumed','redeemed')`.execute(trx);
    const b = Number(r.budget_reserved_cents || 0);
    if (b > 0) await sql`UPDATE deals SET budget_reserved_cents = GREATEST(0, budget_reserved_cents - ${b}) WHERE tenant_id = ${tenantId} AND id = ${r.deal_id}`.execute(trx);
    if (r.coupon_code_id) await sql`UPDATE deal_coupon_codes SET use_count = GREATEST(0, use_count - 1), status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END, updated_at = now()
                                     WHERE tenant_id = ${tenantId} AND id = ${r.coupon_code_id} AND ${canMoveToSql(DEAL_COUPON_CODE, 'active')}`.execute(trx);
  }

  private async expireStale(tenantId: string, dealId: string, trx: any): Promise<void> {
    await sql`UPDATE deal_redemption_holds SET status = 'expired', updated_at = now() WHERE ${canMoveToSql(DEAL_REDEMPTION_HOLD, 'expired')} AND tenant_id = ${tenantId} AND deal_id = ${dealId} AND status = 'held' AND expires_at < now()`.execute(trx);
  }

  // ── coupons ───────────────────────────────────────────────────────────────────────────────────────────────────────
  async findCode(tenantId: string, codeHash: string): Promise<{ id: string; dealId: string; status: string; customerId: string | null; expiresAt: string | null; hint: string } | null> {
    const r = rowsOf(await sql`SELECT id, deal_id, status, customer_id, expires_at, code_hint FROM deal_coupon_codes WHERE tenant_id = ${tenantId} AND code_hash = ${codeHash} LIMIT 1`.execute(this.d))[0];
    return r ? { id: String(r.id), dealId: String(r.deal_id), status: String(r.status), customerId: r.customer_id ? String(r.customer_id) : null, expiresAt: iso(r.expires_at), hint: String(r.code_hint) } : null;
  }
  async findCodeById(tenantId: string, id: string): Promise<{ id: string; dealId: string; status: string; customerId: string | null; expiresAt: string | null; hint: string } | null> {
    const r = rowsOf(await sql`SELECT id, deal_id, status, customer_id, expires_at, code_hint FROM deal_coupon_codes WHERE tenant_id = ${tenantId} AND id = ${id} LIMIT 1`.execute(this.d))[0];
    return r ? { id: String(r.id), dealId: String(r.deal_id), status: String(r.status), customerId: r.customer_id ? String(r.customer_id) : null, expiresAt: iso(r.expires_at), hint: String(r.code_hint) } : null;
  }
  async lookupFailures(tenantId: string, actorKey: string, windowMs: number): Promise<{ actor: number; tenant: number }> {
    const since = new Date(Date.now() - windowMs).toISOString();
    const r = rowsOf(await sql`SELECT count(*) FILTER (WHERE actor_key = ${actorKey})::int AS a, count(*)::int AS t FROM deal_code_lookup_failures WHERE tenant_id = ${tenantId} AND created_at > ${since}`.execute(this.d))[0];
    return { actor: Number(r?.a ?? 0), tenant: Number(r?.t ?? 0) };
  }
  async recordLookupFailure(tenantId: string, actorKey: string): Promise<void> {
    await sql`INSERT INTO deal_code_lookup_failures (tenant_id, actor_key) VALUES (${tenantId}, ${actorKey})`.execute(this.d);
  }
  async insertCodes(tenantId: string, dealId: string, batch: { quantity: number; prefix: string | null; singleUse: boolean; purpose: string; campaignId: string | null; expiresAt: string | null; userId: string | null },
    codes: { hash: string; hint: string; customerId?: string | null; maxUses?: number | null }[]): Promise<{ batchId: string; inserted: number }> {
    return this.d.transaction().execute(async (trx: any) => {
      const b = rowsOf(await sql`INSERT INTO deal_coupon_batches (tenant_id, deal_id, quantity, prefix, single_use, purpose, campaign_id, expires_at, created_by_user_id)
                                  VALUES (${tenantId}, ${dealId}, ${batch.quantity}, ${batch.prefix}, ${batch.singleUse}, ${batch.purpose}, ${batch.campaignId}, ${batch.expiresAt}, ${batch.userId}) RETURNING id`.execute(trx))[0];
      let inserted = 0;
      for (let k = 0; k < codes.length; k += 500) {
        const chunk = codes.slice(k, k + 500);
        const res = rowsOf(await sql`INSERT INTO deal_coupon_codes (tenant_id, deal_id, batch_id, code_hash, code_hint, single_use, max_uses, customer_id, expires_at)
          VALUES ${sql.join(chunk.map((c) => sql`(${tenantId}, ${dealId}, ${b.id}, ${c.hash}, ${c.hint}, ${batch.singleUse}, ${c.maxUses ?? null}, ${c.customerId ?? null}, ${batch.expiresAt})`))}
          ON CONFLICT (tenant_id, code_hash) DO NOTHING RETURNING id`.execute(trx));
        inserted += res.length;
      }
      if (inserted !== codes.length) throw withCode(new LedgerRefusal('code_collision', 'A generated code collided with an existing one — try again.'), 'CODE_COLLISION_RETRY');
      await this.event(trx, DOMAIN_EVENTS.COUPON_CODES_GENERATED, tenantId, null, 'deal', dealId, batch.userId, { dealId, batchId: String(b.id), quantity: inserted, purpose: batch.purpose, singleUse: batch.singleUse });
      return { batchId: String(b.id), inserted };
    });
  }
  async listCodes(tenantId: string, dealId: string, limit = 500): Promise<any[]> {
    return rowsOf(await sql`SELECT c.id, c.code_hint, c.status, c.single_use, c.max_uses, c.use_count, c.customer_id, c.expires_at, c.batch_id, c.created_at, cu.full_name AS customer_name
                              FROM deal_coupon_codes c LEFT JOIN customers cu ON cu.id = c.customer_id AND cu.tenant_id = c.tenant_id
                             WHERE c.tenant_id = ${tenantId} AND c.deal_id = ${dealId} ORDER BY c.created_at DESC LIMIT ${limit}`.execute(this.d))
      .map((r) => ({ id: String(r.id), hint: String(r.code_hint), status: String(r.status), singleUse: !!r.single_use, maxUses: num(r.max_uses), useCount: Number(r.use_count), customerId: r.customer_id ? String(r.customer_id) : null, customerName: r.customer_name ?? null, expiresAt: iso(r.expires_at), batchId: r.batch_id ? String(r.batch_id) : null, createdAt: iso(r.created_at) }));
  }
  async revokeCode(tenantId: string, dealId: string, codeId: string, reason: string): Promise<boolean> {
    const r = rowsOf(await sql`UPDATE deal_coupon_codes SET status = 'revoked', revoked_at = now(), revoked_reason = ${reason}, updated_at = now()
                                WHERE tenant_id = ${tenantId} AND deal_id = ${dealId} AND id = ${codeId} AND status <> 'revoked' AND ${canMoveToSql(DEAL_COUPON_CODE, 'revoked')} RETURNING id`.execute(this.d))[0];
    return !!r;
  }
  /** A customer's wallet: the coupons issued to them, still usable. */
  async walletFor(tenantId: string, customerId: string): Promise<any[]> {
    return rowsOf(await sql`SELECT c.id, c.code_hint, c.status, c.expires_at, c.use_count, d.id AS deal_id, d.title, d.short_description, d.terms, d.discount_type, d.discount_percent, d.discount_cents, d.ends_at, d.status AS deal_status
                              FROM deal_coupon_codes c JOIN deals d ON d.id = c.deal_id AND d.tenant_id = c.tenant_id
                             WHERE c.tenant_id = ${tenantId} AND c.customer_id = ${customerId} ORDER BY c.created_at DESC LIMIT 100`.execute(this.d));
  }

  async knownCustomers(tenantId: string, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    return rowsOf(await sql`SELECT id FROM customers WHERE tenant_id = ${tenantId} AND id IN (${sql.join(ids)})`.execute(this.d)).map((r) => String(r.id));
  }

  /** Dashboard figures: totals and per-day over a window, the top deals, open applications, budget use. */
  async dashboard(tenantId: string, days: number): Promise<any> {
    const since = utcDate(new Date(Date.now() - days * 86_400_000));   // salon-local days (deal_daily_stats); the cutoff is approximate by design
    const daily = rowsOf(await sql`SELECT day, sum(views)::int AS views, sum(bookings)::int AS bookings, sum(applications)::int AS applications, sum(redemptions)::int AS redemptions,
                                          sum(reversals)::int AS reversals, sum(discounted_cents)::bigint AS discounted, sum(reversed_cents)::bigint AS reversed
                                     FROM deal_daily_stats WHERE tenant_id = ${tenantId} AND day >= ${since}::date GROUP BY day ORDER BY day`.execute(this.d))
      .map((r) => ({ day: (r.day instanceof Date ? utcDate(r.day) : String(r.day)).slice(0, 10), views: Number(r.views), bookings: Number(r.bookings), applications: Number(r.applications), redemptions: Number(r.redemptions), reversals: Number(r.reversals), discountedCents: Number(r.discounted), reversedCents: Number(r.reversed) }));
    const live = rowsOf(await sql`SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
                                         count(*) FILTER (WHERE status = 'pending_approval')::int AS pending, count(*) FILTER (WHERE kind = 'coupon' AND status = 'active')::int AS coupons
                                    FROM deals WHERE tenant_id = ${tenantId}`.execute(this.d))[0];
    const money = rowsOf(await sql`SELECT count(*) FILTER (WHERE status = 'applied')::int AS open, coalesce(sum(amount_discounted_cents) FILTER (WHERE status = 'applied'),0)::bigint AS open_cents,
                                          count(*) FILTER (WHERE status IN ('redeemed','partially_reversed') AND redeemed_at >= ${since}::date)::int AS redeemed,
                                          coalesce(sum(amount_discounted_cents - reversed_cents) FILTER (WHERE status IN ('redeemed','partially_reversed') AND redeemed_at >= ${since}::date),0)::bigint AS net_cents
                                     FROM deal_redemptions WHERE tenant_id = ${tenantId}`.execute(this.d))[0];
    const top = rowsOf(await sql`SELECT d.id, d.title, d.kind, d.status, d.redemption_count, d.max_redemptions, d.budget_cents, d.budget_reserved_cents,
                                        coalesce(sum(s.discounted_cents),0)::bigint AS discounted, coalesce(sum(s.views),0)::int AS views, coalesce(sum(s.redemptions),0)::int AS redemptions
                                   FROM deals d LEFT JOIN deal_daily_stats s ON s.deal_id = d.id AND s.tenant_id = d.tenant_id AND s.day >= ${since}::date
                                  WHERE d.tenant_id = ${tenantId} AND d.kind <> 'announcement'
                                  GROUP BY d.id ORDER BY coalesce(sum(s.redemptions),0) DESC, d.created_at DESC LIMIT 10`.execute(this.d))
      .map((r) => ({ dealId: String(r.id), title: String(r.title), kind: String(r.kind), status: String(r.status), redemptionCount: Number(r.redemption_count), maxRedemptions: num(r.max_redemptions),
        budgetCents: num(r.budget_cents), budgetReservedCents: Number(r.budget_reserved_cents || 0), discountedCents: Number(r.discounted), views: Number(r.views), redemptions: Number(r.redemptions),
        conversion: Number(r.views) > 0 ? Math.round((Number(r.redemptions) / Number(r.views)) * 1000) / 10 : null }));
    // Extras · Deals 11: verified uses and discount cost per location (paid uses only, net of refunds). Associated revenue is
    // deliberately not reported here — it is not incremental lift.
    const byBranch = (await sql<{ branch_id: string | null; branch_name: string | null; uses: number; customers: number; net_cents: string | number }>`
                                  SELECT r.branch_id, br.name AS branch_name, count(*)::int AS uses, count(DISTINCT r.customer_id)::int AS customers,
                                         coalesce(sum(r.amount_discounted_cents - r.reversed_cents),0)::bigint AS net_cents
                                    FROM deal_redemptions r LEFT JOIN branches br ON br.id = r.branch_id AND br.tenant_id = r.tenant_id
                                   WHERE r.tenant_id = ${tenantId} AND r.status IN ('redeemed','partially_reversed') AND r.redeemed_at >= ${since}::date
                                   GROUP BY r.branch_id, br.name ORDER BY net_cents DESC, br.name`.execute(this.d)).rows
      .map((r) => { const uses = Number(r.uses); const net = Number(r.net_cents); return { branchId: r.branch_id ? String(r.branch_id) : null, branchName: r.branch_name ? String(r.branch_name) : null,
        uses, customers: Number(r.customers), netDiscountCents: net, avgDiscountCents: uses > 0 ? Math.round(net / uses) : null }; });
    return { days, byBranch, live: { active: Number(live?.active ?? 0), scheduled: Number(live?.scheduled ?? 0), pendingApproval: Number(live?.pending ?? 0), activeCoupons: Number(live?.coupons ?? 0) },
      totals: { openApplications: Number(money?.open ?? 0), openDiscountCents: Number(money?.open_cents ?? 0), redemptions: Number(money?.redeemed ?? 0), netDiscountCents: Number(money?.net_cents ?? 0),
        views: daily.reduce((n, d) => n + d.views, 0), reversals: daily.reduce((n, d) => n + d.reversals, 0) },
      daily, top };
  }

  /** Phase 5 reports/exports: every use of a deal or coupon in the window, with what it took off and gave back. */
  async exportRedemptions(tenantId: string, days: number): Promise<{ appliedAt: string; redeemedAt: string | null; deal: string; kind: string; ticketId: string | null; customerId: string | null; status: string; discountCents: number; reversedCents: number; reversalReason: string | null; codeHint: string | null }[]> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    return rowsOf(await sql`SELECT r.applied_at, r.redeemed_at, d.title, d.kind, r.ticket_id, r.customer_id, r.status, r.amount_discounted_cents, r.reversed_cents, r.reversal_reason, c.code_hint
                              FROM deal_redemptions r JOIN deals d ON d.id = r.deal_id AND d.tenant_id = r.tenant_id
                              LEFT JOIN deal_coupon_codes c ON c.id = r.coupon_code_id AND c.tenant_id = r.tenant_id
                             WHERE r.tenant_id = ${tenantId} AND coalesce(r.applied_at, r.created_at) >= ${since}
                             ORDER BY coalesce(r.applied_at, r.created_at) DESC LIMIT 50000`.execute(this.d))
      .map((r) => ({ appliedAt: iso(r.applied_at) ?? '', redeemedAt: iso(r.redeemed_at), deal: String(r.title), kind: String(r.kind), ticketId: r.ticket_id ? String(r.ticket_id) : null,
        customerId: r.customer_id ? String(r.customer_id) : null, status: String(r.status), discountCents: Number(r.amount_discounted_cents || 0), reversedCents: Number(r.reversed_cents || 0),
        reversalReason: r.reversal_reason ? String(r.reversal_reason) : null, codeHint: r.code_hint ? String(r.code_hint) : null }));
  }

  async customerIdForUser(tenantId: string, userId: string): Promise<string | null> {
    if (!/^[0-9a-f-]{36}$/i.test(String(userId || ''))) return null;
    const r = rowsOf(await sql`SELECT id FROM customers WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND archived_at IS NULL LIMIT 1`.execute(this.d))[0];
    return r ? String(r.id) : null;
  }

  // ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────
  async event(trx: any, type: any, tenantId: string, branchId: string | null, aggregateType: string, aggregateId: string, actorId: string | null, payload: Record<string, unknown>): Promise<void> {
    if (!this.outbox) return;
    await this.outbox.write(trx, createDomainEvent({ eventType: type, tenantId, branchId: branchId ?? undefined, aggregateType, aggregateId,
      actorId: actorId || undefined, actorType: actorId ? 'user' : 'system', correlationId: payload.ticketId ? `ticket:${payload.ticketId}` : undefined, payload }));
  }
  private async analytics(trx: any, tenantId: string, dealId: string, customerId: string | null, type: string): Promise<void> {
    await sql`INSERT INTO deal_analytics_events (deal_id, tenant_id, customer_id, event_type) VALUES (${dealId}, ${tenantId}, ${customerId ?? null}, ${type})`.execute(trx);
  }
}

function toApplication(r: any): LiveApplication {
  const lines = Array.isArray(r.line_allocations) ? r.line_allocations : (typeof r.line_allocations === 'string' ? JSON.parse(r.line_allocations) : []);
  const terms = r.terms_snapshot && typeof r.terms_snapshot === 'object' ? r.terms_snapshot : (typeof r.terms_snapshot === 'string' ? JSON.parse(r.terms_snapshot) : null);
  return { redemptionId: String(r.id), dealId: String(r.deal_id), kind: String(r.kind ?? 'deal'), status: String(r.status), holdId: r.hold_id ? String(r.hold_id) : null, couponCodeId: r.coupon_code_id ? String(r.coupon_code_id) : null,
    discountCents: Number(r.amount_discounted_cents || 0), lines: lines ?? [], dealVersion: Number(r.deal_version || 1), terms, customerId: r.customer_id ? String(r.customer_id) : null, appliedAt: iso(r.applied_at) };
}

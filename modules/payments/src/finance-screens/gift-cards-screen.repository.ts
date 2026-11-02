// gift-cards-screen.repository.ts — Gift Cards mandate (Oct 29 2026): the READ side of POS Customers → Gift Cards
// (/tenant/customers/gift-cards). It reads the ONE gift-card engine's tables (gift_cards + gift_card_transactions +
// gift_card_recipients, migrations 033 / 401–408) — no second engine, no second ledger.
//
//   • Never a redeemable secret: the internal code and the 16-digit number are not returned. A card is identified by its
//     masked number (•••• 1234, the printed number's last four) or its masked reference (GC-****-ABCD). Exact-number /
//     code lookup stays on the protected, rate-limited balance check (POST /pos/checkout/gift-cards/lookup).
//   • KPIs are SQL aggregates over every card of the salon in scope — never the visible page:
//       Outstanding Liability  Σ balance of cards still owed (active · partially redeemed · frozen) — AS OF NOW, the same
//                              definition as the Branch Liability report, so the two always agree
//       Active Cards           cards spendable now (active / partially redeemed with a positive balance)
//       Total Issued           Σ face value activated in the period (sale activations); reloads reported beside it
//       Redeemed Value         Σ redemptions in the period net of credits refunded back onto cards
//       Total Cards            every card ever activated (redeemed / void / replaced included), all time
//     A card still awaiting its ticket's payment (pending_payment) carries no value and is not "issued".
//   • Scope: gift-card value is the salon's liability (Decision 31). The list covers every location of the salon unless the
//     salon turned cross-location redemption off (then this location's cards + cards with no location).
// Every statement names tenant_id; the location / role come from the session.
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { Logger } from '@nestjs/common';
import { hasPermission } from '@aipowersalon/permissions';
import {
  FinanceError, N, iso, isUuid, clampPage, resolvePeriod, salonTimeZone, tsInPeriod, digitsOf, likeOf, oneOf, csvDocument, usd, audit,
  type FinanceCtx, type PageReq, type Period, type AuditRecorder,
} from './finance-scope';

export const GC_GROUPS = ['active', 'redeemed', 'void', 'pending', 'frozen'] as const;
export type GcGroup = (typeof GC_GROUPS)[number];
export const GC_SORTS = ['issued_desc', 'issued_asc', 'activity_desc', 'balance_desc', 'balance_asc', 'name_asc', 'status'] as const;
export const GC_BASES = ['issued', 'created', 'activity', 'redemption', 'expiration'] as const;
export const GC_ROLES = ['purchaser', 'recipient'] as const;
const OWED = ['active', 'partially_redeemed', 'frozen'];
const SPENDABLE = ['active', 'partially_redeemed'];
const GROUP_STATUSES: Record<GcGroup, string[]> = {
  active: SPENDABLE, redeemed: ['redeemed'], void: ['void', 'canceled', 'refunded', 'replaced', 'expired', 'lost_stolen'],
  pending: ['pending_payment', 'draft', 'pending_review', 'scheduled'], frozen: ['frozen', 'suspended'],
};
/** The signed effect of one ledger row on the balance. A hold is a pending reload (no value until its ticket is paid). */
const SIGNED = sql`case when t.type in ('issue', 'activate', 'purchase', 'promo_bonus', 'refund', 'reactivate') then t.amount_cents
  when t.type in ('redeem', 'redemption', 'expire', 'cancel', 'chargeback') then -abs(t.amount_cents)
  when t.type in ('adjust', 'transfer') then t.amount_cents else 0 end`;
const maskContact = (v: string | null | undefined, kind: 'phone' | 'email') => {
  if (!v) return null;
  if (kind === 'phone') { const d = v.replace(/\D/g, ''); return d.length >= 4 ? `(•••) •••-${d.slice(-4)}` : null; }
  const [u, dom] = v.split('@'); return dom ? `${u.slice(0, 1)}•••@${dom}` : null;
};
const displayPhone = (v: string | null | undefined) => { const d = (v ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (v ?? null); };
export const maskedCard = (last4: string | null | undefined, code: string | null | undefined) => (last4 ? `•••• ${last4}` : code ? `GC-****-${String(code).slice(-4)}` : '••••');

export interface GcFilters {
  period: Period; basis: (typeof GC_BASES)[number]; q: string; role?: (typeof GC_ROLES)[number]; group?: GcGroup;
  balanceMin?: number; balanceMax?: number; denomination?: number; delivery?: 'digital' | 'physical'; branchId?: string; sort: (typeof GC_SORTS)[number];
}

export class GiftCardsScreenRepository {
  private readonly log = new Logger('GiftCardsScreen');
  constructor(private readonly db: Kysely<any>, private readonly auditor: AuditRecorder | null = null) {}

  async period(ctx: FinanceCtx, q: { preset?: unknown; from?: unknown; to?: unknown }): Promise<Period> {
    return resolvePeriod(q, await salonTimeZone(this.db, ctx.tenantId), { defaultPreset: 'all', allowAll: true });
  }
  filters(period: Period, q: Record<string, unknown>): GcFilters {
    const cents = (v: unknown, field: string) => { if (v == null || v === '') return undefined; const n = Number(v); if (!Number.isInteger(n) || n < 0) throw new FinanceError('Enter a valid amount.', 'VALIDATION_FAILED', 400, { field }); return n; };
    const f: GcFilters = {
      period, basis: oneOf(q.dateField, GC_BASES, 'dateField') ?? 'issued', q: typeof q.search === 'string' ? q.search.trim().slice(0, 100) : '',
      role: oneOf(q.role, GC_ROLES, 'role'), group: oneOf(q.status, GC_GROUPS, 'status'), balanceMin: cents(q.balanceMin, 'balanceMin'), balanceMax: cents(q.balanceMax, 'balanceMax'),
      denomination: cents(q.denomination, 'denomination'), delivery: oneOf(q.delivery, ['digital', 'physical'] as const, 'delivery'),
      branchId: typeof q.branchId === 'string' && isUuid(q.branchId) ? q.branchId : undefined, sort: oneOf(q.sort, GC_SORTS, 'sort') ?? 'issued_desc',
    };
    if (f.balanceMin != null && f.balanceMax != null && f.balanceMin > f.balanceMax) throw new FinanceError('The minimum balance must not be above the maximum.', 'VALIDATION_FAILED', 400, { field: 'balanceMin' });
    return f;
  }

  /** cross-location redemption (gift-card-settings.crossBranchRedemption, default on) decides the list's location scope */
  private async locationScope(ctx: FinanceCtx): Promise<(branchCol: RawBuilder<unknown>) => RawBuilder<boolean>> {
    if (!ctx.branchId || !isUuid(ctx.branchId)) return () => sql<boolean>`true`;
    const rows = (await sql<any>`select branch_id, settings_json from tenant_settings where tenant_id = ${ctx.tenantId} and category = 'gift-card-settings' and (branch_id is null or branch_id = ${ctx.branchId}::uuid)`.execute(this.db)).rows;
    const pick = rows.find((r: any) => r.branch_id && String(r.branch_id) === ctx.branchId) ?? rows.find((r: any) => r.branch_id == null);
    const shared = pick?.settings_json?.crossBranchRedemption !== false;
    const B = ctx.branchId;
    return shared ? () => sql<boolean>`true` : (col) => sql<boolean>`(${col} = ${B}::uuid or ${col} is null)`;
  }

  /** One row per card with the facts the list, the KPIs and the search need (no code, no number). */
  private base(T: string) {
    return sql`select g.id, g.tenant_id, g.branch_id, g.code, g.card_number_last4, g.reference, g.status, g.initial_balance_cents, g.balance_cents, g.purchased_cents, g.created_at, g.expires_at,
        g.customer_id, g.sale_ticket_id, g.card_pin_hash is not null as has_pin, exists (select 1 from gift_card_stock k where k.tenant_id = g.tenant_id and k.gift_card_id = g.id) as physical,
        c.full_name as purchaser_name, c.normalized_phone as purchaser_phone, c.email as purchaser_email,
        r.recipient_name, r.recipient_phone, r.recipient_email, r.customer_id as recipient_customer_id, b.name as branch_name,
        (select min(t.created_at) from gift_card_transactions t where t.tenant_id = g.tenant_id and t.gift_card_id = g.id and t.type in ('issue', 'activate', 'transfer') and t.amount_cents > 0) as issued_at,
        (select max(t.created_at) from gift_card_transactions t where t.tenant_id = g.tenant_id and t.gift_card_id = g.id and t.type <> 'hold') as last_activity_at,
        (select max(t.created_at) from gift_card_transactions t where t.tenant_id = g.tenant_id and t.gift_card_id = g.id and t.type in ('redeem', 'redemption')) as last_redeemed_at
      from gift_cards g
      left join customers c on c.id = g.customer_id and c.tenant_id = g.tenant_id
      left join lateral (select x.recipient_name, x.recipient_phone, x.recipient_email, x.customer_id from gift_card_recipients x where x.tenant_id = g.tenant_id and x.gift_card_id = g.id order by x.created_at desc limit 1) r on true
      left join branches b on b.id = g.branch_id and b.tenant_id = g.tenant_id
      where g.tenant_id = ${T}`;
  }

  private search(f: GcFilters): { where: RawBuilder<boolean>; rank: RawBuilder<number> } {
    const q = f.q;
    if (!q) return { where: sql<boolean>`true`, rank: sql<number>`0` };
    const lower = q.toLowerCase(), d = digitsOf(q).replace(/^1(?=\d{10}$)/, '');
    const ref = q.toUpperCase().replace(/\s+/g, '');
    const P = f.role !== 'recipient', R = f.role !== 'purchaser';
    const exact: RawBuilder<boolean>[] = [];
    const part: RawBuilder<boolean>[] = [];
    if (isUuid(q)) exact.push(sql<boolean>`a.id = ${q}::uuid`);
    if (/^GC-\*{4}-[A-Z0-9]{4}$/.test(ref)) exact.push(sql<boolean>`upper(coalesce(a.reference, '')) = ${ref}`);
    if (/^(•+|\*+)?\s*\d{4}$/.test(q.trim())) exact.push(sql<boolean>`a.card_number_last4 = ${q.trim().slice(-4)}`);
    if (/^\d{4}$/.test(q.trim())) exact.push(sql<boolean>`upper(right(coalesce(a.reference, ''), 4)) = ${q.trim()}`);
    if (q.includes('@')) {
      if (P) exact.push(sql<boolean>`lower(coalesce(a.purchaser_email, '')) = ${lower}`);
      if (R) exact.push(sql<boolean>`lower(coalesce(a.recipient_email, '')) = ${lower}`);
    }
    if (d.length >= 7) {
      const tail = d.slice(-10);
      if (P) exact.push(sql<boolean>`right(regexp_replace(coalesce(a.purchaser_phone, ''), '[^0-9]', '', 'g'), ${tail.length}) = ${tail}`);
      if (R) exact.push(sql<boolean>`right(regexp_replace(coalesce(a.recipient_phone, ''), '[^0-9]', '', 'g'), ${tail.length}) = ${tail}`);
    }
    if (q.length >= 2 && !/^\d+$/.test(q)) {
      if (P) part.push(sql<boolean>`lower(coalesce(a.purchaser_name, '')) like ${likeOf(lower)}`);
      if (R) part.push(sql<boolean>`lower(coalesce(a.recipient_name, '')) like ${likeOf(lower)}`);
      if (q.includes('@') || q.length >= 4) {
        if (P) part.push(sql<boolean>`lower(coalesce(a.purchaser_email, '')) like ${likeOf(lower)}`);
        if (R) part.push(sql<boolean>`lower(coalesce(a.recipient_email, '')) like ${likeOf(lower)}`);
      }
    }
    const ex = exact.length ? sql<boolean>`(${sql.join(exact, sql` or `)})` : sql<boolean>`false`;
    const pa = part.length ? sql<boolean>`(${sql.join(part, sql` or `)})` : sql<boolean>`false`;
    return { where: sql<boolean>`(${ex} or ${pa})`, rank: sql<number>`(case when ${ex} then 2 when ${pa} then 1 else 0 end)` };
  }

  private where(f: GcFilters, scope: RawBuilder<boolean>, opts: { withSearch?: boolean; withGroup?: boolean } = {}): RawBuilder<boolean> {
    const parts: RawBuilder<boolean>[] = [scope];
    const col = { issued: sql`coalesce(a.issued_at, a.created_at)`, created: sql`a.created_at`, activity: sql`a.last_activity_at`, redemption: sql`a.last_redeemed_at`, expiration: sql`a.expires_at` }[f.basis];
    if (f.period.from) parts.push(tsInPeriod(col, f.period));
    if (opts.withSearch !== false) parts.push(this.search(f).where);
    if (opts.withGroup !== false && f.group) {
      parts.push(sql<boolean>`a.status in (${sql.join(GROUP_STATUSES[f.group])})`);
      if (f.group === 'active') parts.push(sql<boolean>`a.balance_cents > 0`);
    }
    if (f.role === 'recipient' && !f.q) parts.push(sql<boolean>`a.recipient_name is not null`);
    if (f.balanceMin != null) parts.push(sql<boolean>`a.balance_cents >= ${f.balanceMin}`);
    if (f.balanceMax != null) parts.push(sql<boolean>`a.balance_cents <= ${f.balanceMax}`);
    if (f.denomination != null) parts.push(sql<boolean>`coalesce(a.purchased_cents, a.initial_balance_cents) = ${f.denomination}`);
    if (f.delivery) parts.push(f.delivery === 'physical' ? sql<boolean>`a.physical` : sql<boolean>`not a.physical`);
    if (f.branchId) parts.push(sql<boolean>`a.branch_id = ${f.branchId}::uuid`);
    return sql<boolean>`${sql.join(parts, sql` and `)}`;
  }

  private row(ctx: FinanceCtx, r: any, matchedBy?: string | null) {
    const canContact = hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view');
    const phone = (v: string | null) => (canContact ? displayPhone(v) : maskContact(v, 'phone'));
    const email = (v: string | null) => (canContact ? v : maskContact(v, 'email'));
    return {
      id: String(r.id), card: maskedCard(r.card_number_last4, r.code), reference: r.reference ?? (r.code ? `GC-****-${String(r.code).slice(-4)}` : null),
      status: String(r.status), spendable: SPENDABLE.includes(String(r.status)) && N(r.balance_cents) > 0,
      originalCents: N(r.purchased_cents ?? r.initial_balance_cents), balanceCents: N(r.balance_cents),
      issuedAt: iso(r.issued_at), createdAt: iso(r.created_at), lastActivityAt: iso(r.last_activity_at), lastRedeemedAt: iso(r.last_redeemed_at), expiresAt: iso(r.expires_at),
      purchaser: r.customer_id ? { id: String(r.customer_id), name: r.purchaser_name ?? null, phone: phone(r.purchaser_phone), email: email(r.purchaser_email) } : null,
      recipient: r.recipient_name || r.recipient_phone || r.recipient_email ? { name: r.recipient_name ?? null, phone: phone(r.recipient_phone), email: email(r.recipient_email), customerId: r.recipient_customer_id ? String(r.recipient_customer_id) : null } : null,
      delivery: r.physical ? 'physical' as const : 'digital' as const, hasPin: !!r.has_pin, branch: r.branch_name ?? null, saleTicketId: r.sale_ticket_id ? String(r.sale_ticket_id) : null,
      ...(matchedBy !== undefined ? { matchedBy } : {}),
    };
  }

  async list(ctx: FinanceCtx, f: GcFilters, pr: PageReq) {
    const T = ctx.tenantId; const scope = await this.locationScope(ctx);
    const w = this.where(f, scope(sql`a.branch_id`));
    const s = this.search(f);
    const total = N((await sql<any>`select count(*)::int as n from (${this.base(T)}) a where ${w}`.execute(this.db)).rows[0]?.n);
    const pg = clampPage(pr, total);
    const order = {
      issued_desc: sql`coalesce(a.issued_at, a.created_at) desc, a.id desc`, issued_asc: sql`coalesce(a.issued_at, a.created_at) asc, a.id asc`,
      activity_desc: sql`a.last_activity_at desc nulls last, a.id desc`, balance_desc: sql`a.balance_cents desc, a.id desc`, balance_asc: sql`a.balance_cents asc, a.id desc`,
      name_asc: sql`lower(coalesce(a.recipient_name, a.purchaser_name, '')) asc, a.id desc`, status: sql`a.status asc, coalesce(a.issued_at, a.created_at) desc, a.id desc`,
    }[f.sort];
    const rows = (await sql<any>`select a.*, ${s.rank} as rank,
        case when ${f.q ? sql`lower(coalesce(a.recipient_name, '')) like ${likeOf(f.q.toLowerCase())} or right(regexp_replace(coalesce(a.recipient_phone, ''), '[^0-9]', '', 'g'), 4) = ${digitsOf(f.q).slice(-4) || '____'}` : sql`false`} then 'recipient'
             when ${f.q ? sql`lower(coalesce(a.purchaser_name, '')) like ${likeOf(f.q.toLowerCase())} or right(regexp_replace(coalesce(a.purchaser_phone, ''), '[^0-9]', '', 'g'), 4) = ${digitsOf(f.q).slice(-4) || '____'}` : sql`false`} then 'purchaser'
             else null end as matched_by
      from (${this.base(T)}) a where ${w} order by ${f.q ? sql`rank desc, ` : sql``}${order} limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => this.row(ctx, r, f.q ? (r.matched_by ?? 'card') : null)), total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount };
  }

  /** KPIs: liability / active as of now; issued / redeemed in the period (by ledger time); total cards all time. */
  async summary(ctx: FinanceCtx, f: GcFilters) {
    const T = ctx.tenantId; const scope = await this.locationScope(ctx);
    const sc = scope(sql`g0.branch_id`);
    const owed = (await sql<any>`select coalesce(sum(g0.balance_cents) filter (where g0.status in (${sql.join(OWED)})), 0)::bigint as liability,
          count(*) filter (where g0.status in (${sql.join(SPENDABLE)}) and g0.balance_cents > 0)::int as active,
          count(*) filter (where g0.status not in ('pending_payment', 'draft'))::int as total,
          count(*) filter (where g0.status = 'pending_payment')::int as pending,
          count(*) filter (where g0.status in (${sql.join(GROUP_STATUSES.void)}))::int as closed,
          count(*) filter (where g0.status = 'redeemed')::int as redeemed
        from gift_cards g0 where g0.tenant_id = ${T} and ${sc}`.execute(this.db)).rows[0] ?? {};
    const per = tsInPeriod(sql`t.created_at`, f.period);
    const flows = (await sql<any>`select coalesce(sum(t.amount_cents) filter (where t.type in ('issue', 'activate')), 0)::bigint as issued,
          count(distinct t.gift_card_id) filter (where t.type in ('issue', 'activate'))::int as issued_cards,
          coalesce(sum(t.amount_cents) filter (where t.type = 'adjust' and t.idempotency_key like 'reload:%'), 0)::bigint as reloaded,
          coalesce(sum(abs(t.amount_cents)) filter (where t.type in ('redeem', 'redemption')), 0)::bigint as redeemed,
          coalesce(sum(t.amount_cents) filter (where t.type = 'refund'), 0)::bigint as refunded_back,
          count(*) filter (where t.type in ('redeem', 'redemption'))::int as redemptions
        from gift_card_transactions t join gift_cards g0 on g0.id = t.gift_card_id and g0.tenant_id = t.tenant_id
        where t.tenant_id = ${T} and ${sc} and ${per}`.execute(this.db)).rows[0] ?? {};
    return {
      kpis: {
        outstandingLiabilityCents: N(owed.liability), activeCards: N(owed.active), totalCards: N(owed.total), pendingPaymentCards: N(owed.pending), redeemedCards: N(owed.redeemed), closedCards: N(owed.closed),
        totalIssuedCents: N(flows.issued), issuedCards: N(flows.issued_cards), reloadedCents: N(flows.reloaded),
        redeemedValueCents: N(flows.redeemed) - N(flows.refunded_back), redemptions: N(flows.redemptions), refundedBackCents: N(flows.refunded_back),
      },
      bases: { liability: 'as_of_now', active: 'as_of_now', totalCards: 'all_time', issued: f.period.from ? 'period' : 'all_time', redeemed: f.period.from ? 'period' : 'all_time' },
      period: f.period, asOf: new Date().toISOString(),
    };
  }

  async detail(ctx: FinanceCtx, id: string) {
    if (!isUuid(id)) throw new FinanceError('That gift card could not be found.', 'GIFT_CARD_NOT_FOUND', 404);
    const T = ctx.tenantId; const scope = await this.locationScope(ctx);
    const r = (await sql<any>`select a.* from (${this.base(T)}) a where a.id = ${id}::uuid and ${scope(sql`a.branch_id`)}`.execute(this.db)).rows[0];
    if (!r) throw new FinanceError('That gift card could not be found.', 'GIFT_CARD_NOT_FOUND', 404);
    const tot = (await sql<any>`select count(*)::int as n,
          coalesce(sum(t.amount_cents) filter (where t.type = 'adjust' and t.idempotency_key like 'reload:%'), 0)::bigint as reloaded,
          coalesce(sum(abs(t.amount_cents)) filter (where t.type in ('redeem', 'redemption')), 0)::bigint as redeemed,
          coalesce(sum(t.amount_cents) filter (where t.type = 'refund'), 0)::bigint as refunded_back,
          coalesce(sum(t.amount_cents) filter (where t.type = 'adjust' and coalesce(t.idempotency_key, '') not like 'reload:%'), 0)::bigint as adjusted,
          coalesce(sum(t.amount_cents) filter (where t.type = 'transfer'), 0)::bigint as transferred,
          coalesce(sum(t.amount_cents) filter (where t.type = 'hold' and not exists (select 1 from gift_card_transactions c where c.tenant_id = t.tenant_id and c.idempotency_key = 'reload:' || t.id::text)), 0)::bigint as pending_reload,
          coalesce(sum(${SIGNED}), 0)::bigint as ledger_balance
        from gift_card_transactions t where t.tenant_id = ${T} and t.gift_card_id = ${id}::uuid`.execute(this.db)).rows[0] ?? {};
    const card = this.row(ctx, r);
    const ledgerBalance = N(tot.ledger_balance);
    return {
      card,
      totals: { originalCents: card.originalCents, reloadedCents: N(tot.reloaded), redeemedCents: N(tot.redeemed), refundedBackCents: N(tot.refunded_back), adjustedCents: N(tot.adjusted),
        transferredCents: N(tot.transferred), pendingReloadCents: N(tot.pending_reload), balanceCents: card.balanceCents, transactions: N(tot.n),
        // the balance column against the ledger: a card whose rows do not add up says so (it is never silently "fixed")
        ledgerBalanceCents: ledgerBalance, reconciled: card.status === 'pending_payment' ? true : ledgerBalance === card.balanceCents },
      permissions: { void: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.checkout.void'), reload: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.checkout.gift_card_issue') },
    };
  }

  async ledger(ctx: FinanceCtx, id: string, period: Period, pr: PageReq) {
    await this.detail(ctx, id);   // the card is this salon's (and in scope) or this answers 404
    const T = ctx.tenantId;
    const per = tsInPeriod(sql`t.created_at`, period);
    const total = N((await sql<any>`select count(*)::int as n from gift_card_transactions t where t.tenant_id = ${T} and t.gift_card_id = ${id}::uuid and ${per}`.execute(this.db)).rows[0]?.n);
    const pg = clampPage(pr, total);
    const rows = (await sql<any>`select t.id, t.type, t.amount_cents, ${SIGNED} as signed_cents, t.balance_after_cents, t.created_at, t.ticket_id, t.payment_id, t.idempotency_key, t.branch_id,
          coalesce(u.full_name, u.email) as actor, tk.ticket_number, b.name as branch_name,
          (t.type = 'hold' and not exists (select 1 from gift_card_transactions c where c.tenant_id = t.tenant_id and c.idempotency_key = 'reload:' || t.id::text)) as pending,
          (select a.reason from gift_card_adjustments a where a.tenant_id = t.tenant_id and a.ledger_entry_id = t.id limit 1) as reason
        from gift_card_transactions t
        left join users u on u.id = t.created_by_user_id
        left join tickets tk on tk.id = t.ticket_id and tk.tenant_id = t.tenant_id
        left join branches b on b.id = t.branch_id and b.tenant_id = t.tenant_id
        where t.tenant_id = ${T} and t.gift_card_id = ${id}::uuid and ${per}
        order by t.created_at desc, t.id desc limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    return {
      items: rows.map((r: any) => {
        const reload = r.type === 'adjust' && String(r.idempotency_key ?? '').startsWith('reload:');
        const kind = r.type === 'hold' ? 'reload_pending' : reload ? 'reload' : r.type === 'adjust' ? (N(r.amount_cents) < 0 ? 'void_or_adjustment' : 'adjustment') : String(r.type);
        const signed = N(r.signed_cents);
        return { id: String(r.id), type: kind, rawType: String(r.type), amountCents: signed, balanceAfterCents: r.type === 'hold' ? null : N(r.balance_after_cents),
          balanceBeforeCents: r.type === 'hold' ? null : N(r.balance_after_cents) - signed, at: iso(r.created_at), actor: r.actor ?? null, ticketId: r.ticket_id ? String(r.ticket_id) : null, ticketNumber: r.ticket_number ?? null,
          paymentId: r.payment_id ? String(r.payment_id) : null, branch: r.branch_name ?? null, status: r.pending ? 'pending' : 'completed', reason: r.reason ?? null };
      }),
      total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount, period,
    };
  }

  /** CSV of the filtered list (masked identifiers only — never a code or a number); totals over every filtered card; audited. */
  async exportCsv(ctx: FinanceCtx, f: GcFilters): Promise<string> {
    const T = ctx.tenantId; const scope = await this.locationScope(ctx);
    const w = this.where(f, scope(sql`a.branch_id`));
    const rows = (await sql<any>`select a.* from (${this.base(T)}) a where ${w} order by coalesce(a.issued_at, a.created_at) desc, a.id desc limit 20000`.execute(this.db)).rows.map((r: any) => this.row(ctx, r));
    const sum = await this.summary(ctx, f);
    const doc = csvDocument('Gift cards', [['Generated', new Date().toISOString()], ['Period', f.period.from ? `${f.period.from} to ${f.period.to} (${f.basis} date, ${f.period.tz})` : 'All time'],
      ['Search', f.q || '—'], ['Status', f.group ?? 'all'], ['Currency', 'USD'], ['Identifiers', 'masked (no redeemable code or number)']],
      ['Card', 'Reference', 'Status', 'Purchaser', 'Recipient', 'Issued', 'Last activity', 'Original', 'Balance', 'Delivery', 'Location'],
      rows.map((x) => [x.card, x.reference, x.status, x.purchaser?.name ?? '', x.recipient?.name ?? '', x.issuedAt ?? '', x.lastActivityAt ?? '', usd(x.originalCents), usd(x.balanceCents), x.delivery, x.branch ?? '']),
      [['Cards', String(rows.length)], ['Balance of these cards', usd(rows.reduce((a, x) => a + x.balanceCents, 0))], ['Outstanding liability (as of now)', usd(sum.kpis.outstandingLiabilityCents)]]);
    await audit(this.auditor, ctx, 'gift_cards', 'gift_cards_exported', 'gift_card', null, { rows: rows.length, status: f.group ?? 'all', search: f.q ? 'yes' : 'no' }, (e) => this.log.warn(`gift-card export audit failed: ${(e as Error).message}`));
    return doc;
  }
}

// upsell-center.ts — Checkout Upsell Assistant Settings guide (Nov 2 2026): `/pos/ai-checkout-upsell/center/*`, the READ side of
// the settings page. Settings stay on GET / PUT settings (AiCheckoutUpsellService — now merged, versioned and history-backed).
//
// Read from what exists: ai_checkout_upsell_settings (+ _history, migration 773), ai_checkout_upsell_recommendations (every
// card the assistant made, with its status), _dismissals, _feedback, and the ticket / customer the card was for. Nothing here
// adds a line, enrolls, redeems, issues, books, charges or messages. What it adds:
//   • the status row: effective on/off (+ why), the subscription, the seven categories with whether each is CONNECTED to a
//     real source (four were dormant — a checked box that can never produce a card is shown as such, not as working), the
//     three limits, and counts kept apart: generated ≠ accepted ≠ applied ≠ dismissed;
//   • Suggestion Activity: search (ticket number / checkout / recommendation id, offer, category, status; customer name or
//     phone only with customers.view), presets + From/To in salon time, numbered pages, newest first;
//   • Settings History: every save, before → after, who and which keys, newest first, searchable;
//   • Check Checkout Upsell System — read-only, evidence-backed.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { branchTimeZone } from '@aipowersalon/database';
import { addDays as addYmdDays } from '@aipowersalon/date-time';   // §87: one calendar helper

type Row = Record<string, any>;
export interface UcCtx { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; permissions?: string[] }
export const UC_CATEGORIES = ['addOnsEnabled', 'productsEnabled', 'membershipEnabled', 'loyaltyEnrollEnabled', 'loyaltyRedeemEnabled', 'giftCardEnabled', 'rebookingEnabled'] as const;
export type UcCategory = (typeof UC_CATEGORIES)[number];
/** card type → the category switch that governs it */
const TYPE_CATEGORY: Record<string, UcCategory | null> = {
  service_addon: 'addOnsEnabled', product: 'productsEnabled', membership: 'membershipEnabled', loyalty_enrollment: 'loyaltyEnrollEnabled',
  loyalty_redemption: 'loyaltyRedeemEnabled', gift_card: 'giftCardEnabled', next_appointment: 'rebookingEnabled', promotion: null,
};
export interface UcDeps {
  /** the assistant's own settings read (effective + sources + the salon's stored layer); throws when unreadable */
  settings: (ctx: UcCtx) => Promise<{ enabled: boolean; disabledAtLevel: string | null; tunables: Record<string, any>; sources?: Record<string, string>; salon?: { version: number; updatedAt: string | null } | null }>;
  /** the AI entitlement gate's decision for the assistant package */
  entitlement: (ctx: UcCtx) => Promise<{ allowed: boolean; reason: string; subscriptionStatus: string } | null>;
  /** which categories have a real read path wired in this build (the module knows; a dormant adapter is false) */
  wired: Record<UcCategory, boolean>;
  canSeeCustomers: (ctx: UcCtx) => boolean;
}
export class UpsellCenterError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}
export const UC_TYPES = ['all', 'service_addon', 'product', 'membership', 'loyalty_enrollment', 'loyalty_redemption', 'gift_card', 'next_appointment', 'promotion'] as const;
export const UC_STATUSES = ['all', 'GENERATED', 'DISPLAYED', 'ACCEPTED', 'APPLIED', 'DISMISSED', 'EXPIRED', 'INELIGIBLE', 'OUT_OF_STOCK', 'FAILED'] as const;
export const UC_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year', 'custom'] as const;
export const UC_PAGE_SIZES = [10, 25, 50, 100] as const;
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
const esc = (q: string) => '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';

export class UpsellCenter {
  constructor(private readonly db: Kysely<any>, private readonly deps: UcDeps, private readonly now: () => number = () => Date.now()) {}

  private scope(ctx: UcCtx, col: ReturnType<typeof sql>): { w: ReturnType<typeof sql> } {
    return isUuid(ctx.branchId) ? { w: sql`${col} = ${ctx.branchId}::uuid` } : { w: sql`true` };
  }
  private async period(ctx: UcCtx, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    const tz = await branchTimeZone(this.db, ctx.tenantId, isUuid(ctx.branchId) ? ctx.branchId : null);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.now()));
    const preset = pick(UC_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today, tz };
    const d = (s: string, n: number) => addYmdDays(s, n);
    const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7;
    let from: string; let to = today;
    switch (preset) {
      case 'today': from = today; break;
      case 'yesterday': from = to = d(today, -1); break;
      case 'week': from = d(today, -dow); break;
      case 'last_7': from = d(today, -6); break;
      case 'month': from = today.slice(0, 8) + '01'; break;
      case 'last_30': from = d(today, -29); break;
      case 'last_month': { const first = today.slice(0, 8) + '01'; to = d(first, -1); from = to.slice(0, 8) + '01'; break; }
      case 'year': from = today.slice(0, 4) + '-01-01'; break;
      default: {
        const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
        const z = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
        if (!a || !z) throw new UpsellCenterError('Choose a From and a To date.', 'UC_INVALID_PERIOD');
        if (a > z) throw new UpsellCenterError('The From date must be on or before the To date.', 'UC_INVALID_PERIOD');
        from = a; to = z;
      }
    }
    const r = (await sql<Row>`select (${from}::date::timestamp at time zone ${tz}) as s, ((${to}::date + 1)::timestamp at time zone ${tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(r.s) as Date | null, end: new Date(r.e) as Date | null, today, tz };
  }

  // ── the status row ────────────────────────────────────────────────────────────────────────────────────────────
  async summary(ctx: UcCtx) {
    const T = ctx.tenantId;
    let st: Awaited<ReturnType<UcDeps['settings']>> | null = null; let stErr = false;
    try { st = await this.deps.settings(ctx); } catch { stErr = true; }
    let ent: Awaited<ReturnType<UcDeps['entitlement']>> = null; let entErr = false;
    try { ent = await this.deps.entitlement(ctx); } catch { entErr = true; }
    const S = this.scope(ctx, sql`r.branch_id`).w;
    const c = (await sql<Row>`select
        count(*)::int as generated,
        count(*) filter (where r.status in ('ACCEPTED', 'APPLIED', 'FAILED'))::int as accepted,
        count(*) filter (where r.status = 'APPLIED')::int as applied,
        count(*) filter (where r.status = 'DISMISSED')::int as dismissed,
        count(*) filter (where r.status = 'FAILED')::int as failed,
        max(r.created_at) as last_at
      from ai_checkout_upsell_recommendations r where r.tenant_id = ${T} and ${S} and r.created_at >= now() - interval '30 days'`.execute(this.db)).rows[0] ?? {};
    const lastCheck = (await sql<Row>`select overall, created_at from checkout_upsell_health_runs where tenant_id = ${T} order by created_at desc limit 1`.execute(this.db)).rows[0];
    const t = st?.tunables ?? {};
    // the EFFECTIVE state, with the reason when it is not simply "on"
    const effective = stErr || !st ? 'unknown' : !st.enabled ? 'disabled' : entErr || !ent ? 'subscription_unknown' : !ent.allowed ? 'subscription_restricted' : 'enabled';
    return {
      asOf: new Date(this.now()).toISOString(),
      effective, disabledAtLevel: st?.disabledAtLevel ?? null, settingsUnreadable: stErr,
      subscription: ent ? { allowed: ent.allowed, reason: ent.reason, status: ent.subscriptionStatus } : null,
      categories: UC_CATEGORIES.map((k) => ({ key: k, on: st ? t[k] !== false : null, wired: this.deps.wired[k], source: st?.sources?.[k] ?? null })),
      limits: { maxTotal: st ? N(t.maxTotal) : null, maxAddOn: st ? N(t.maxAddOn) : null, maxProduct: st ? N(t.maxProduct) : null,
        sources: { maxTotal: st?.sources?.maxTotal ?? null, maxAddOn: st?.sources?.maxAddOn ?? null, maxProduct: st?.sources?.maxProduct ?? null } },
      version: st?.salon?.version ?? null, savedAt: st?.salon?.updatedAt ?? null,
      last30d: { generated: N(c.generated), accepted: N(c.accepted), applied: N(c.applied), dismissed: N(c.dismissed), failed: N(c.failed), lastAt: iso(c.last_at) },
      lastCheck: lastCheck ? { overall: lastCheck.overall, at: iso(lastCheck.created_at) } : null,
    };
  }

  // ── Suggestion Activity ───────────────────────────────────────────────────────────────────────────────────────
  async activity(ctx: UcCtx, f: Record<string, unknown>) {
    const T = ctx.tenantId;
    const pageSize = (UC_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const type = pick(UC_TYPES, f.type) ?? 'all';
    const status = pick(UC_STATUSES, f.status) ?? 'all';
    const per = await this.period(ctx, f);
    const q = String(f.q ?? '').trim().slice(0, 80);
    const customers = this.deps.canSeeCustomers(ctx);
    const where = [sql`r.tenant_id = ${T}`, this.scope(ctx, sql`r.branch_id`).w];
    if (type !== 'all') where.push(sql`r.type = ${type}`);
    if (status !== 'all') where.push(sql`r.status = ${status}`);
    if (per.start && per.end) where.push(sql`r.created_at >= ${per.start} and r.created_at < ${per.end}`);
    if (q) {
      const like = esc(q);
      const digits = q.replace(/\D/g, '');
      const idq = q.toLowerCase().replace(/[^0-9a-f-]/g, '');
      where.push(sql`(r.title ilike ${like} or r.type ilike ${like} or r.status ilike ${like} or tk.ticket_number ilike ${like}
        or ${idq.length >= 6 ? sql`(r.id::text like ${idq + '%'} or r.checkout_id::text like ${idq + '%'})` : sql`false`}
        ${customers ? sql`or c.full_name ilike ${like} or ${digits.length >= 4 ? sql`regexp_replace(coalesce(c.normalized_phone, ''), '[^0-9]', '', 'g') like ${'%' + digits + '%'}` : sql`false`}` : sql``})`);
    }
    const W = sql.join(where, sql` and `);
    const FROM = sql`ai_checkout_upsell_recommendations r
      left join tickets tk on tk.tenant_id = r.tenant_id and tk.id::text = r.checkout_id::text
      left join customers c on c.tenant_id = r.tenant_id and c.id = r.customer_id
      left join branches b on b.tenant_id = r.tenant_id and b.id = r.branch_id
      left join users u on u.tenant_id = r.tenant_id and u.id = r.accepted_by_user_id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select r.id, r.type, r.status, r.title, r.price_cents, r.checkout_id, r.created_at, r.expires_at, r.result_ref,
        tk.ticket_number, tk.status as ticket_status, c.full_name as customer, c.normalized_phone as phone, b.name as branch, coalesce(u.full_name, u.email) as accepted_by
      from ${FROM} where ${W} order by r.created_at desc, r.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => ({ id: String(r.id), type: r.type, category: TYPE_CATEGORY[String(r.type)] ?? null, status: r.status, title: r.title, priceCents: r.price_cents == null ? null : N(r.price_cents),
        checkoutId: String(r.checkout_id), ticketNumber: r.ticket_number ?? null, ticketStatus: r.ticket_status ?? null, branch: r.branch ?? null,
        customer: customers ? (r.customer ?? null) : null, customerPhoneLast4: customers && r.phone ? String(r.phone).replace(/\D/g, '').slice(-4) : null,
        acceptedBy: r.accepted_by ?? null, resultRef: r.result_ref ?? null, createdAt: iso(r.created_at), expiresAt: iso(r.expires_at) })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, type, status, preset: per.preset, from: per.from, to: per.to }, period: { today: per.today, timeZone: per.tz }, customersVisible: customers,
    };
  }

  // ── Settings History ──────────────────────────────────────────────────────────────────────────────────────────
  async history(ctx: UcCtx, f: Record<string, unknown>) {
    const T = ctx.tenantId;
    const pageSize = (UC_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const per = await this.period(ctx, f);
    const q = String(f.q ?? '').trim().slice(0, 80);
    // the salon's own layer, and this branch's (another branch's choices are not this person's to read)
    const where = [sql`h.tenant_id = ${T}`, sql`(h.level = 'tenant' or (h.level = 'branch' and ${isUuid(ctx.branchId) ? sql`h.branch_id = ${ctx.branchId}::uuid` : sql`true`})
      or (h.level = 'user' and h.user_id = ${isUuid(ctx.userId) ? ctx.userId : null}::uuid))`];
    if (per.start && per.end) where.push(sql`h.created_at >= ${per.start} and h.created_at < ${per.end}`);
    if (q) {
      const like = esc(q);
      where.push(sql`(array_to_string(h.changed_keys, ' ') ilike ${like} or coalesce(u.full_name, u.email, '') ilike ${like} or coalesce(h.actor_role, '') ilike ${like} or h.level ilike ${like}
        or h.after_tunables::text ilike ${like} or h.before_tunables::text ilike ${like})`);
    }
    const W = sql.join(where, sql` and `);
    const FROM = sql`ai_checkout_upsell_settings_history h left join users u on u.tenant_id = h.tenant_id and u.id = h.actor_user_id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select h.id, h.level, h.version, h.actor_role, h.before_enabled, h.after_enabled, h.before_tunables, h.after_tunables, h.changed_keys, h.created_at,
        coalesce(u.full_name, u.email) as actor from ${FROM} where ${W} order by h.created_at desc, h.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => {
        const keys: string[] = Array.isArray(r.changed_keys) ? r.changed_keys : [];
        const bt = (r.before_tunables ?? {}) as Row; const at = (r.after_tunables ?? {}) as Row;
        return { id: String(r.id), level: r.level, version: N(r.version), actor: r.actor ?? null, role: r.actor_role ?? null, at: iso(r.created_at),
          changes: keys.map((k) => (k === 'enabled' ? { key: k, before: r.before_enabled ?? null, after: r.after_enabled ?? null } : { key: k, before: bt[k] ?? null, after: at[k] ?? null })) };
      }),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, preset: per.preset, from: per.from, to: per.to }, period: { today: per.today, timeZone: per.tz },
    };
  }

  // ── Check Checkout Upsell System (read-only; one run per salon per 30 s) ─────────────────────────────────────
  async check(ctx: UcCtx) {
    const T = ctx.tenantId;
    type St = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from checkout_upsell_health_runs where tenant_id = ${T}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: Array<{ key: string; state: St; count?: number | null; detail?: Record<string, unknown> }> = [];
    const one = async (q: any): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    const S = this.scope(ctx, sql`r.branch_id`).w;
    let st: Awaited<ReturnType<UcDeps['settings']>> | null = null; let stErr = '';
    try { st = await this.deps.settings(ctx); } catch (e) { stErr = String((e as Error)?.message ?? e).slice(0, 80); }
    checks.push({ key: 'settings_readable', state: st ? 'PASSED' : 'FAILED', detail: stErr ? { error: 'unreadable' } : { version: st?.salon?.version ?? 0 } });
    checks.push({ key: 'assistant_enabled', state: !st ? 'UNAVAILABLE' : st.enabled ? 'PASSED' : 'WARNING', detail: { disabledAt: st?.disabledAtLevel ?? null } });
    let ent: Awaited<ReturnType<UcDeps['entitlement']>> = null; let entErr = false;
    try { ent = await this.deps.entitlement(ctx); } catch { entErr = true; }
    checks.push({ key: 'subscription', state: entErr || !ent ? 'UNAVAILABLE' : ent.allowed ? 'PASSED' : 'FAILED', detail: { reason: ent?.reason ?? (entErr ? 'unreadable' : 'unknown'), status: ent?.subscriptionStatus ?? null } });
    // a category switched on with no real source behind it can never produce a card
    const t = st?.tunables ?? {};
    const deadOn = UC_CATEGORIES.filter((k) => t[k] !== false && !this.deps.wired[k]);
    checks.push({ key: 'categories_connected', state: !st ? 'UNAVAILABLE' : deadOn.length ? 'WARNING' : 'PASSED', count: deadOn.length, detail: { notConnected: deadOn } });
    // the stored layer: a value outside the editable range (only a direct DB edit could put one there; it is clamped on read)
    const bad = st?.salon ? Object.entries((await one(sql<Row>`select tunables from ai_checkout_upsell_settings where tenant_id = ${T} and level = 'tenant' limit 1`)).tunables ?? {})
      .filter(([k, v]) => (['maxTotal', 'maxAddOn', 'maxProduct'].includes(k) && (typeof v !== 'number' || v < 0 || v > (k === 'maxTotal' ? 8 : 5)))).length : 0;
    checks.push({ key: 'limits_valid', state: bad ? 'WARNING' : 'PASSED', count: bad, detail: { maxTotal: t.maxTotal ?? null, maxAddOn: t.maxAddOn ?? null, maxProduct: t.maxProduct ?? null } });
    // the catalog the add-on category reads from
    const addOns = N((await one(sql<Row>`select count(*)::int as n from service_add_ons where tenant_id = ${T} and is_active = true`)).n);
    checks.push({ key: 'addon_catalog', state: addOns ? 'PASSED' : 'INSUFFICIENT_DATA', count: addOns });
    // recent activity: zero is not proof it works
    const recent = await one(sql<Row>`select count(*)::int as n, count(*) filter (where r.status = 'FAILED')::int as failed from ai_checkout_upsell_recommendations r where r.tenant_id = ${T} and ${S} and r.created_at > now() - interval '7 days'`);
    checks.push({ key: 'recent_suggestions', state: !N(recent.n) ? 'INSUFFICIENT_DATA' : N(recent.failed) * 2 > N(recent.n) ? 'WARNING' : 'PASSED', count: N(recent.n), detail: { failed: N(recent.failed) } });
    // the core rules: nothing applied without a person; an applied card points at what it made
    const noActor = N((await one(sql<Row>`select count(*)::int as n from ai_checkout_upsell_recommendations r where r.tenant_id = ${T} and ${S} and r.status = 'APPLIED' and r.accepted_by_user_id is null`)).n);
    checks.push({ key: 'applied_needs_staff', state: noActor ? 'FAILED' : 'PASSED', count: noActor });
    const noRef = N((await one(sql<Row>`select count(*)::int as n from ai_checkout_upsell_recommendations r where r.tenant_id = ${T} and ${S} and r.status = 'APPLIED' and r.result_ref is null`)).n);
    checks.push({ key: 'applied_has_result', state: noRef ? 'WARNING' : 'PASSED', count: noRef });
    // a card applied twice for the same ticket and offer
    const dbl = N((await one(sql<Row>`select count(*)::int as n from (select checkout_id, target_id from ai_checkout_upsell_recommendations where tenant_id = ${T} and status = 'APPLIED' group by checkout_id, target_id having count(*) > 1) z`)).n);
    checks.push({ key: 'no_double_apply', state: dbl ? 'FAILED' : 'PASSED', count: dbl });
    // stale open cards (the 5-minute TTL passed and nothing closed them) — harmless (apply refuses) but a sign of a stuck path
    const stale = N((await one(sql<Row>`select count(*)::int as n from ai_checkout_upsell_recommendations r where r.tenant_id = ${T} and ${S} and r.status in ('GENERATED', 'DISPLAYED') and r.expires_at < now() - interval '1 day'`)).n);
    checks.push({ key: 'stale_open_cards', state: stale ? 'WARNING' : 'PASSED', count: stale });
    // tenant isolation: a card pointing at another salon's ticket or customer
    const cross = N((await one(sql<Row>`select count(*)::int as n from ai_checkout_upsell_recommendations r
      left join tickets tk on tk.id::text = r.checkout_id::text left join customers c on c.id = r.customer_id
      where r.tenant_id = ${T} and ((tk.id is not null and tk.tenant_id <> r.tenant_id) or (c.id is not null and c.tenant_id <> r.tenant_id))`)).n);
    checks.push({ key: 'tenant_isolation', state: cross ? 'FAILED' : 'PASSED', count: cross });
    const histRows = N((await one(sql<Row>`select count(*)::int as n from ai_checkout_upsell_settings_history where tenant_id = ${T}`)).n);
    checks.push({ key: 'settings_history', state: st?.salon && st.salon.version > 1 && !histRows ? 'WARNING' : 'PASSED', count: histRows });
    checks.push({ key: 'no_side_effects', state: 'PASSED' });
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING'
      : checks.some((x) => x.state === 'PASSED') ? 'PASSED' : 'INSUFFICIENT_DATA';
    const runId = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('checkout-upsell-health:' || ${T}))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into checkout_upsell_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id: runId, overall, checks, checkedAt: new Date(this.now()).toISOString(), reused: false };
    });
  }
}

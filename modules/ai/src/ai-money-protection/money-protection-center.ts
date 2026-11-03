// money-protection-center.ts — the six AI Money Protection guides (Nov 2 2026, built Nov 3 2026): `/pos/money-protection-center/*`.
//
// What the module was: 15 rules (a pure, deterministic catalog), alerts stored idempotently, investigations with notes, per-rule
// settings — but
//   • NOTHING ran detection: the scheduler the code mentions did not exist, the only trigger was POST evaluate (no screen called
//     it), and the five reconciliation rules (memberships, gift cards, cash drawers) were not even called by that;
//   • no run was recorded, so "no alerts" could not be told apart from "never checked";
//   • a failed read of payments became "no activity" (no alerts), and the overview answered zeros when its query failed;
//   • an alert could not be acknowledged, dismissed or reopened — it stayed NEW until it was put in an investigation;
//   • a rule change kept only the newest values: no before / after, no reason, no history;
//   • lists were cursor "load more" with no search, no dates, no totals; investigation status changes left no trail.
//
// What it is now (read side + the few human actions; money is never moved — no charge, refund, reversal or write-off):
//   • summary        — the overview cards with one definition each, the last detection run and whether detection is scheduled;
//   • alerts / alert — search (alert id, rule, hóa đơn number, staff name; customer name / phone with customers.view) · status
//                      group · severity · category · rule · which date · presets + From/To in salon time · sort · numbered pages;
//                      the detail shows the evidence, the source records it points at (hóa đơn, payments, staff), its history;
//   • alert actions  — acknowledge · dismiss as expected / false positive (reason) · reopen (reason): optimistic, append-only,
//                      audited; nobody reviews an alert about their own activity;
//   • investigations — search · status · severity · dates · pages; the timeline (notes + every recorded decision);
//   • rules / save   — all 15 rules with the salon's setting, 30-day alert counts and last alert; a change records before → after,
//                      a reason is required to turn a rule off or lower its severity, and a stale edit is refused;
//   • detection      — "Run detection now" (one pass, all three layers, recorded) and the scheduled pass (opt-in env);
//   • check          — "Check AI Money Protection System": read-only.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { branchTimeZone, assertTransition } from '@aipowersalon/database';
import { MONEY_PROTECTION_ALERT } from '../ai-lifecycles';
import { recordAuditStrict } from '@aipowersalon/audit';
import { RULE_CATALOG } from './ai-money-protection-catalog';
import type { MoneyProtectionFlags } from './ai-money-protection-flags';
import type { EntitlementPort } from './ai-money-protection-entitlement';

type Row = Record<string, any>;
export interface McCtx { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; permissions?: string[] }
export class MoneyCenterError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly extra: Record<string, unknown> = {}) { super(message); }
}
export const MC_OPEN = ['NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'WAITING_FOR_INFORMATION', 'ESCALATED'];
export const MC_RESOLVED = ['RESOLVED_EXPECTED_ACTIVITY', 'RESOLVED_SYSTEM_ERROR', 'RESOLVED_POLICY_VIOLATION', 'RESOLVED_CONFIRMED_MISUSE', 'CLOSED'];
export const MC_ALERT_GROUPS = ['open', 'new', 'resolved', 'dismissed', 'all'] as const;
export const MC_SEVERITIES = ['all', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
export const MC_CATEGORIES = ['all', 'duplicate_charge', 'refund', 'void', 'discount', 'tip', 'failed_payment', 'reconciliation', 'employee', 'integrity'] as const;
export const MC_ALERT_DATES = ['detected', 'last_seen', 'updated'] as const;
export const MC_ALERT_SORTS = ['newest', 'oldest', 'severity', 'value'] as const;
export const MC_INV_STATUS = ['active', 'OPEN', 'INVESTIGATING', 'WAITING_FOR_INFORMATION', 'ESCALATED', 'RESOLVED', 'CLOSED', 'all'] as const;
export const MC_INV_DATES = ['opened', 'updated', 'closed'] as const;
export const MC_INV_SORTS = ['updated', 'newest', 'oldest', 'severity', 'value'] as const;
export const MC_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'last_90', 'year', 'custom'] as const;
export const MC_PAGE_SIZES = [10, 25, 50, 100] as const;
export const MC_ALERT_ACTIONS = ['acknowledge', 'dismiss', 'reopen'] as const;
const SEV_RANK: Record<string, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };
const HEALTH_GAP_SECONDS = 30;
const MANUAL_GAP_SECONDS = 120;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LEAK_RE = '[0-9](?:[ -]?[0-9]){12,18}';
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
const has = (ctx: McCtx, p: string) => (ctx.permissions ?? []).includes(p);
const addDays = (d: string, k: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const esc = (s: string) => '%' + s.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const RULE = new Map(RULE_CATALOG.map((r) => [r.id, r]));
const groupOf = (s: string) => (MC_OPEN.includes(s) ? 'open' : s === 'DISMISSED_FALSE_POSITIVE' ? 'dismissed' : 'resolved');

export interface McDeps {
  flags: () => MoneyProtectionFlags;
  entitlement: EntitlementPort | null;
  /** one detection pass for the salon (all three layers); system permissions; returns what it raised */
  detect: (tenantId: string) => Promise<{ evaluated: number; created: number; updated: number; layers: Record<string, unknown> }>;
  /** the existing validated rule save (service.updateSetting) */
  saveRule: (ctx: McCtx, ruleId: string, input: { enabled: boolean; severityOverride: string | null; thresholds: Record<string, unknown> }) => Promise<unknown>;
  scheduled: () => boolean;
}

export class MoneyProtectionCenter {
  constructor(private readonly db: Kysely<any>, private readonly deps: McDeps, private readonly now: () => number = () => Date.now()) {}

  private need(ctx: McCtx, p = 'ai_money_protection.view') {
    if (!has(ctx, p)) throw new MoneyCenterError('Your role cannot do this in Money Protection.', 'PERMISSION_DENIED', 403);
  }
  private scope(col: ReturnType<typeof sql>, ctx: McCtx): { w: ReturnType<typeof sql> } {
    return isUuid(ctx.branchId) ? { w: sql`(${col} = ${ctx.branchId}::uuid or ${col} is null)` } : { w: sql`true` };
  }
  private async period(ctx: McCtx, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    const tz = await branchTimeZone(this.db, ctx.tenantId, isUuid(ctx.branchId) ? ctx.branchId : null);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.now()));
    const preset = pick(MC_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today, tz };
    const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7;
    let from: string; let to = today;
    switch (preset) {
      case 'today': from = today; break;
      case 'yesterday': from = to = addDays(today, -1); break;
      case 'week': from = addDays(today, -dow); break;
      case 'last_7': from = addDays(today, -6); break;
      case 'month': from = today.slice(0, 8) + '01'; break;
      case 'last_30': from = addDays(today, -29); break;
      case 'last_90': from = addDays(today, -89); break;
      case 'last_month': { const first = today.slice(0, 8) + '01'; to = addDays(first, -1); from = to.slice(0, 8) + '01'; break; }
      case 'year': from = today.slice(0, 4) + '-01-01'; break;
      default: {
        const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
        const z = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
        if (!a || !z) throw new MoneyCenterError('Choose a From and a To date.', 'MC_INVALID_PERIOD');
        if (a > z) throw new MoneyCenterError('The From date must be on or before the To date.', 'MC_INVALID_PERIOD');
        from = a; to = z;
      }
    }
    const r = (await sql<Row>`select (${from}::date::timestamp at time zone ${tz}) as s, ((${to}::date + 1)::timestamp at time zone ${tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(r.s) as Date | null, end: new Date(r.e) as Date | null, today, tz };
  }
  private paging(f: Record<string, unknown>) {
    return { pageSize: (MC_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25, page: Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1))) };
  }
  private async event(ex: Kysely<any>, ctx: McCtx, e: { branchId?: string | null; entityType: 'alert' | 'investigation' | 'rule'; entityId: string; action: string; from?: string | null; to?: string | null; reason?: string | null; detail?: Record<string, unknown> }) {
    await sql`insert into money_protection_events (tenant_id, branch_id, entity_type, entity_id, action, from_state, to_state, reason, detail, actor_user_id)
      values (${ctx.tenantId}, ${isUuid(e.branchId) ? e.branchId : null}, ${e.entityType}, ${e.entityId}, ${e.action}, ${e.from ?? null}, ${e.to ?? null}, ${e.reason ?? null},
        ${JSON.stringify(e.detail ?? {})}::jsonb, ${isUuid(ctx.userId) ? ctx.userId : null})`.execute(ex);
  }
  /** who an alert is about: the people the rule named + whoever took the payments it points at (for "staff involved" and for
   *  segregation of duties — nobody reviews an alert about their own activity) */
  private async involved(ex: Kysely<any>, T: string, related: Record<string, unknown> | null): Promise<string[]> {
    const rel = related ?? {};
    const pays = arr(rel.transactionIds).filter(isUuid);
    const fromPay = pays.length ? (await sql<Row>`select distinct created_by_user_id as u from payments where tenant_id = ${T} and id = any(${pays}::uuid[]) and created_by_user_id is not null`.execute(ex)).rows.map((r) => String(r.u)) : [];
    return [...new Set([...arr(rel.userIds).filter(isUuid), ...fromPay])];
  }
  /** for the investigation service: every assign / status / resolution is recorded with who did it */
  async recordInvestigationEvent(ctx: McCtx, e: { investigationId: string; branchId?: string | null; action: string; from?: string | null; to?: string | null; detail?: Record<string, unknown> }) {
    await this.event(this.db, ctx, { entityType: 'investigation', entityId: e.investigationId, branchId: e.branchId, action: e.action, from: e.from, to: e.to, detail: e.detail });
  }

  // ── overview ───────────────────────────────────────────────────────────────────────────────────────────────
  async summary(ctx: McCtx) {
    this.need(ctx);
    const T = ctx.tenantId;
    const S = this.scope(sql`a.branch_id`, ctx).w;
    const a = (await sql<Row>`select count(*) filter (where a.status = 'NEW')::int as new_alerts,
        count(*) filter (where a.status = any(${MC_OPEN}::text[]))::int as open_alerts,
        count(*) filter (where a.status = any(${MC_OPEN}::text[]) and a.severity = 'CRITICAL')::int as critical,
        count(*) filter (where a.status = any(${MC_OPEN}::text[]) and a.severity = 'HIGH')::int as high,
        coalesce(sum(a.amount_cents) filter (where a.status = any(${MC_OPEN}::text[])), 0)::bigint as under_review,
        count(*) filter (where a.status = 'DISMISSED_FALSE_POSITIVE' and a.updated_at > now() - interval '30 days')::int as dismissed30,
        count(*) filter (where a.created_at > now() - interval '30 days')::int as raised30
      from money_protection_alerts a where a.tenant_id = ${T} and ${S}`.execute(this.db)).rows[0] ?? {};
    const inv = (await sql<Row>`select count(*) filter (where i.status not in ('RESOLVED', 'CLOSED'))::int as open,
        count(*) filter (where i.status not in ('RESOLVED', 'CLOSED') and i.assigned_user_id is null)::int as unassigned
      from money_protection_investigations i where i.tenant_id = ${T} and ${this.scope(sql`i.branch_id`, ctx).w}`.execute(this.db)).rows[0] ?? {};
    const run = (await sql<Row>`select id, trigger_kind, status, started_at, finished_at, created_alerts, updated_alerts, error_code from money_protection_detection_runs
      where tenant_id = ${T} order by started_at desc limit 1`.execute(this.db)).rows[0];
    const ok = (await sql<Row>`select max(finished_at) as at from money_protection_detection_runs where tenant_id = ${T} and status = 'succeeded'`.execute(this.db)).rows[0];
    const byCat = (await sql<Row>`select a.rule_id, count(*)::int as n from money_protection_alerts a where a.tenant_id = ${T} and ${S} and a.status = any(${MC_OPEN}::text[]) group by 1`.execute(this.db)).rows;
    const cats: Record<string, number> = {};
    for (const r of byCat) { const c = RULE.get(String(r.rule_id))?.category ?? 'other'; cats[c] = (cats[c] ?? 0) + N(r.n); }
    const f = this.deps.flags();
    const monitoring = !f.enabled ? 'module_off' : !run ? 'never_checked' : run.status === 'failed' ? 'last_run_failed'
      : !ok?.at || new Date(ok.at).getTime() < this.now() - 26 * 3600e3 ? 'stale' : 'current';
    return {
      asOf: new Date(this.now()).toISOString(),
      cards: { newAlerts: N(a.new_alerts), openAlerts: N(a.open_alerts), critical: N(a.critical), high: N(a.high), valueUnderReviewCents: N(a.under_review),
        openInvestigations: N(inv.open), unassignedInvestigations: N(inv.unassigned), dismissed30d: N(a.dismissed30), raised30d: N(a.raised30) },
      byCategory: cats,
      monitoring, scheduled: this.deps.scheduled(),
      lastRun: run ? { id: String(run.id), trigger: run.trigger_kind, status: run.status, startedAt: iso(run.started_at), finishedAt: iso(run.finished_at),
        created: N(run.created_alerts), updated: N(run.updated_alerts), errorCode: run.error_code ?? null } : null,
      lastSuccessAt: iso(ok?.at),
      canRunDetection: has(ctx, 'ai_money_protection.manage_rules'), canAct: has(ctx, 'ai_money_protection.investigate'),
      definitions: { valueUnderReview: 'sum of open alerts\' amounts under review — never a confirmed loss', open: MC_OPEN, dismissed: 'DISMISSED_FALSE_POSITIVE' },
    };
  }

  // ── alerts ─────────────────────────────────────────────────────────────────────────────────────────────────
  async alerts(ctx: McCtx, f: Record<string, unknown>) {
    this.need(ctx, 'ai_money_protection.view_alerts');
    const T = ctx.tenantId;
    const { page, pageSize } = this.paging(f);
    const group = pick(MC_ALERT_GROUPS, f.status) ?? 'open';
    const severity = pick(MC_SEVERITIES, f.severity) ?? 'all';
    const category = pick(MC_CATEGORIES, f.category) ?? 'all';
    const rule = typeof f.rule === 'string' && RULE.has(f.rule) ? f.rule : null;
    const dateField = pick(MC_ALERT_DATES, f.dateField) ?? 'detected';
    const sort = pick(MC_ALERT_SORTS, f.sort) ?? 'newest';
    const per = await this.period(ctx, f);
    const q = String(f.q ?? '').trim().slice(0, 80);
    const customers = has(ctx, 'customers.view');
    const where = [sql`a.tenant_id = ${T}`, this.scope(sql`a.branch_id`, ctx).w];
    if (group === 'open') where.push(sql`a.status = any(${MC_OPEN}::text[])`);
    else if (group === 'new') where.push(sql`a.status = 'NEW'`);
    else if (group === 'resolved') where.push(sql`a.status = any(${MC_RESOLVED}::text[])`);
    else if (group === 'dismissed') where.push(sql`a.status = 'DISMISSED_FALSE_POSITIVE'`);
    if (severity !== 'all') where.push(sql`a.severity = ${severity}`);
    if (category !== 'all') where.push(sql`a.rule_id = any(${RULE_CATALOG.filter((r) => r.category === category).map((r) => r.id)}::text[])`);
    if (rule) where.push(sql`a.rule_id = ${rule}`);
    if (per.start && per.end) {
      const col = dateField === 'last_seen' ? sql`a.last_seen_at` : dateField === 'updated' ? sql`a.updated_at` : sql`a.first_seen_at`;
      where.push(sql`${col} >= ${per.start} and ${col} < ${per.end}`);
    }
    if (q) {
      const like = esc(q);
      const idq = q.toLowerCase().replace(/[^0-9a-f-]/g, '');
      const ruleIds = RULE_CATALOG.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()) || r.alertType.includes(q.toLowerCase().replace(/ /g, '_'))).map((r) => r.id);
      const digits = q.replace(/[^0-9]/g, '');
      const TK = sql`(select tk.id from tickets tk where tk.tenant_id = ${T} and tk.id::text in (select jsonb_array_elements_text(coalesce(a.related->'ticketIds', '[]'::jsonb))))`;
      where.push(sql`(a.rule_id = any(${ruleIds}::text[])
        or ${idq.length >= 6 && idq.length === q.length ? sql`a.id::text like ${idq + '%'} or a.related::text ilike ${'%' + idq + '%'}` : sql`false`}
        or exists (select 1 from tickets tk where tk.tenant_id = ${T} and tk.id in ${TK} and tk.ticket_number ilike ${like})
        or exists (select 1 from users u where u.tenant_id = ${T} and u.full_name ilike ${like} and (u.id::text in (select jsonb_array_elements_text(coalesce(a.related->'userIds', '[]'::jsonb)))
          or u.id in (select p.created_by_user_id from payments p where p.tenant_id = ${T} and p.id::text in (select jsonb_array_elements_text(coalesce(a.related->'transactionIds', '[]'::jsonb))))))
        ${customers ? sql`or exists (select 1 from tickets tk join customers c on c.id = tk.customer_id and c.tenant_id = tk.tenant_id where tk.tenant_id = ${T} and tk.id in ${TK}
          and (c.full_name ilike ${like} or ${digits.length >= 4 ? sql`regexp_replace(coalesce(c.normalized_phone, ''), '[^0-9]', '', 'g') like ${'%' + digits + '%'}` : sql`false`}))` : sql``})`);
    }
    const W = sql.join(where, sql` and `);
    const order = sort === 'oldest' ? sql`a.first_seen_at asc, a.id asc`
      : sort === 'severity' ? sql`case a.severity when 'CRITICAL' then 5 when 'HIGH' then 4 when 'MEDIUM' then 3 when 'LOW' then 2 else 1 end desc, a.last_seen_at desc, a.id desc`
      : sort === 'value' ? sql`a.amount_cents desc, a.last_seen_at desc, a.id desc` : sql`a.last_seen_at desc, a.id desc`;
    const total = N((await sql<Row>`select count(*)::int as n from money_protection_alerts a where a.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select a.id, a.rule_id, a.alert_type, a.severity, a.status, a.risk_score, a.confidence, a.amount_cents, a.event_count, a.first_seen_at, a.last_seen_at, a.updated_at, a.investigation_id, b.name as branch from money_protection_alerts a left join branches b on b.id = a.branch_id and b.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and ${W} order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => this.alertOut(r)),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, status: group, severity, category, rule, dateField, sort, preset: per.preset, from: per.from, to: per.to },
      period: { today: per.today, timeZone: per.tz }, customersVisible: customers,
    };
  }
  private alertOut(r: Row) {
    const d = RULE.get(String(r.rule_id));
    return { id: String(r.id), ruleId: r.rule_id, rule: d?.name ?? r.rule_id, category: d?.category ?? null, alertType: r.alert_type, severity: r.severity, status: r.status, group: groupOf(r.status),
      riskScore: N(r.risk_score), confidence: r.confidence, amountCents: N(r.amount_cents), eventCount: N(r.event_count), branch: r.branch ?? null,
      firstSeenAt: iso(r.first_seen_at), lastSeenAt: iso(r.last_seen_at), updatedAt: iso(r.updated_at), investigationId: r.investigation_id ? String(r.investigation_id) : null };
  }

  async alert(ctx: McCtx, id: string) {
    this.need(ctx, 'ai_money_protection.view_alerts');
    const T = ctx.tenantId;
    if (!isUuid(id)) throw new MoneyCenterError('That alert was not found.', 'MC_NOT_FOUND', 404);
    const r = (await sql<Row>`select a.id, a.rule_id, a.alert_type, a.severity, a.status, a.risk_score, a.confidence, a.amount_cents, a.event_count, a.first_seen_at, a.last_seen_at, a.updated_at, a.investigation_id, a.branch_id, a.evidence, a.related, b.name as branch from money_protection_alerts a left join branches b on b.id = a.branch_id and b.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.id = ${id}::uuid and ${this.scope(sql`a.branch_id`, ctx).w}`.execute(this.db)).rows[0];
    if (!r) throw new MoneyCenterError('That alert was not found.', 'MC_NOT_FOUND', 404);
    const rel = (typeof r.related === 'object' && r.related) || {};
    const ticketIds = arr(rel.ticketIds).filter(isUuid), payIds = arr(rel.transactionIds).filter(isUuid), userIds = await this.involved(this.db, T, rel);
    const customers = has(ctx, 'customers.view');
    // the source records the alert points at — read from their own tables, this salon only
    const tickets = ticketIds.length ? (await sql<Row>`select tk.id, tk.ticket_number, tk.status, tk.total_cents, tk.created_at, c.full_name as customer from tickets tk
      left join customers c on c.id = tk.customer_id and c.tenant_id = tk.tenant_id where tk.tenant_id = ${T} and tk.id = any(${ticketIds}::uuid[]) order by tk.created_at`.execute(this.db)).rows : [];
    const payments = payIds.length ? (await sql<Row>`select id, ticket_id, method, amount_cents, status, processor, created_at from payments
      where tenant_id = ${T} and id = any(${payIds}::uuid[]) order by created_at`.execute(this.db)).rows : [];
    const staff = userIds.length ? (await sql<Row>`select id, full_name, role from users where tenant_id = ${T} and id = any(${userIds}::uuid[])`.execute(this.db)).rows : [];
    const events = (await sql<Row>`select e.action, e.from_state, e.to_state, e.reason, e.created_at, coalesce(u.full_name, u.email) as actor from money_protection_events e
      left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id where e.tenant_id = ${T} and e.entity_type = 'alert' and e.entity_id = ${id} order by e.created_at desc, e.id desc limit 100`.execute(this.db)).rows;
    const d = RULE.get(String(r.rule_id));
    const self = isUuid(ctx.userId) && userIds.includes(String(ctx.userId));
    return {
      alert: this.alertOut(r),
      rule: d ? { id: d.id, name: d.name, category: d.category, layer: d.layer, description: d.description, humanReview: d.humanReview } : null,
      evidence: r.evidence ?? {},
      sources: {
        tickets: tickets.map((x) => ({ id: String(x.id), number: x.ticket_number ?? null, status: x.status, totalCents: x.total_cents == null ? null : N(x.total_cents), at: iso(x.created_at), customer: customers ? (x.customer ?? null) : null })),
        payments: payments.map((x) => ({ id: String(x.id), ticketId: x.ticket_id ? String(x.ticket_id) : null, method: x.method, amountCents: N(x.amount_cents), status: x.status, processor: x.processor ?? null, at: iso(x.created_at) })),
        staff: staff.map((x) => ({ id: String(x.id), name: x.full_name ?? null, role: x.role ?? null })),
        missing: { tickets: ticketIds.length - tickets.length, payments: payIds.length - payments.length },
      },
      history: events.map((e) => ({ action: e.action, from: e.from_state, to: e.to_state, reason: e.reason ?? null, actor: e.actor ?? null, at: iso(e.created_at) })),
      canAct: has(ctx, 'ai_money_protection.investigate') && !self, selfInvolved: self,
      actions: MC_OPEN.includes(r.status) ? (r.status === 'NEW' ? ['acknowledge', 'dismiss'] : ['dismiss']) : r.status === 'DISMISSED_FALSE_POSITIVE' || MC_RESOLVED.includes(r.status) ? ['reopen'] : [],
      note: 'An alert is a possible discrepancy for a person to review — not a finding about anyone.',
    };
  }

  async alertAction(ctx: McCtx, id: string, b: { action?: unknown; reason?: unknown; expectedStatus?: unknown }) {
    this.need(ctx, 'ai_money_protection.investigate');
    const action = pick(MC_ALERT_ACTIONS, b.action);
    if (!action) throw new MoneyCenterError('Choose acknowledge, dismiss or reopen.', 'VALIDATION_FAILED');
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 1000) : '';
    if ((action === 'dismiss' || action === 'reopen') && reason.length < 5) throw new MoneyCenterError('Write a reason (at least 5 characters).', 'MC_REASON_REQUIRED');
    if (!isUuid(id)) throw new MoneyCenterError('That alert was not found.', 'MC_NOT_FOUND', 404);
    const T = ctx.tenantId;
    return this.db.transaction().execute(async (trx) => {
      const r = (await sql<Row>`select id, status, branch_id, related, rule_id from money_protection_alerts where tenant_id = ${T} and id = ${id}::uuid and ${this.scope(sql`branch_id`, ctx).w} for update`.execute(trx)).rows[0];
      if (!r) throw new MoneyCenterError('That alert was not found.', 'MC_NOT_FOUND', 404);
      if (typeof b.expectedStatus === 'string' && b.expectedStatus !== r.status) throw new MoneyCenterError('This alert was changed by someone else. Reload it.', 'MC_STALE', 409, { status: r.status });
      if (isUuid(ctx.userId) && (await this.involved(trx, T, r.related)).includes(String(ctx.userId))) throw new MoneyCenterError('You cannot review an alert about your own activity.', 'SEGREGATION_OF_DUTIES', 403);
      const to = action === 'acknowledge' ? 'ACKNOWLEDGED' : action === 'dismiss' ? 'DISMISSED_FALSE_POSITIVE' : 'ACKNOWLEDGED';
      const allowed = action === 'acknowledge' ? r.status === 'NEW' : action === 'dismiss' ? MC_OPEN.includes(r.status) : !MC_OPEN.includes(r.status);
      if (!allowed) throw new MoneyCenterError('This alert cannot do that in its current state.', 'MC_STATE_INVALID', 409, { status: r.status });
      assertTransition(MONEY_PROTECTION_ALERT, r.status, to);
      await sql`update money_protection_alerts set status = ${to}, updated_at = now() where tenant_id = ${T} and id = ${id}::uuid and status = ${r.status}`.execute(trx);
      await this.event(trx, ctx, { entityType: 'alert', entityId: id, branchId: r.branch_id, action, from: r.status, to, reason: reason || null });
      await recordAuditStrict(trx, { tenantId: T, branchId: isUuid(r.branch_id) ? r.branch_id : null, userId: isUuid(ctx.userId) ? ctx.userId! : null, role: ctx.role ?? null },
        { module: 'ai_money_protection', action: `money_protection_alert.${action}`, resourceType: 'money_protection_alert', resourceId: id,
          summary: `Money Protection alert ${action} (${r.rule_id})`, reason: reason || undefined, before: { status: r.status }, after: { status: to } });
      return { id, status: to, from: r.status };
    });
  }

  // ── investigations ─────────────────────────────────────────────────────────────────────────────────────────
  async investigations(ctx: McCtx, f: Record<string, unknown>) {
    this.need(ctx);
    const T = ctx.tenantId;
    const { page, pageSize } = this.paging(f);
    const status = pick(MC_INV_STATUS, f.status) ?? 'active';
    const severity = pick(MC_SEVERITIES, f.severity) ?? 'all';
    const dateField = pick(MC_INV_DATES, f.dateField) ?? 'opened';
    const sort = pick(MC_INV_SORTS, f.sort) ?? 'updated';
    const per = await this.period(ctx, f);
    const q = String(f.q ?? '').trim().slice(0, 80);
    const where = [sql`i.tenant_id = ${T}`, this.scope(sql`i.branch_id`, ctx).w];
    if (status === 'active') where.push(sql`i.status not in ('RESOLVED', 'CLOSED')`);
    else if (status !== 'all') where.push(sql`i.status = ${status}`);
    if (severity !== 'all') where.push(sql`i.severity = ${severity}`);
    if (per.start && per.end) {
      const col = dateField === 'updated' ? sql`i.updated_at` : dateField === 'closed' ? sql`i.closed_at` : sql`i.created_at`;
      where.push(sql`${col} >= ${per.start} and ${col} < ${per.end}`);
    }
    if (q) {
      const idq = q.toLowerCase().replace(/[^0-9a-f-]/g, '');
      where.push(sql`(i.title ilike ${esc(q)} or i.category ilike ${esc(q)} or coalesce(au.full_name, '') ilike ${esc(q)}
        or ${idq.length >= 6 && idq.length === q.length ? sql`(i.id::text like ${idq + '%'} or i.related::text ilike ${'%' + idq + '%'})` : sql`false`})`);
    }
    const W = sql.join(where, sql` and `);
    const FROM = sql`money_protection_investigations i left join users au on au.id = i.assigned_user_id and au.tenant_id = i.tenant_id left join branches b on b.id = i.branch_id and b.tenant_id = i.tenant_id`;
    const order = sort === 'newest' ? sql`i.created_at desc, i.id desc` : sort === 'oldest' ? sql`i.created_at asc, i.id asc`
      : sort === 'severity' ? sql`case i.severity when 'CRITICAL' then 5 when 'HIGH' then 4 when 'MEDIUM' then 3 when 'LOW' then 2 else 1 end desc, i.updated_at desc, i.id desc`
      : sort === 'value' ? sql`i.value_under_review_cents desc, i.updated_at desc, i.id desc` : sql`i.updated_at desc, i.id desc`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select i.id, i.title, i.category, i.severity, i.status, i.value_under_review_cents, i.recovery_amount_cents, i.resolution, i.related, i.created_at, i.updated_at, i.closed_at,
        au.full_name as assignee, b.name as branch,
        (select count(*) from money_protection_investigation_notes n where n.tenant_id = i.tenant_id and n.investigation_id = i.id)::int as notes
      from ${FROM} where ${W} order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => ({ id: String(r.id), title: r.title, category: r.category, severity: r.severity, status: r.status, assignee: r.assignee ?? null, branch: r.branch ?? null,
        valueUnderReviewCents: N(r.value_under_review_cents), recoveryCents: N(r.recovery_amount_cents), resolution: r.resolution ?? null, alerts: arr((r.related ?? {}).alertIds).length,
        notes: N(r.notes), openedAt: iso(r.created_at), updatedAt: iso(r.updated_at), closedAt: iso(r.closed_at) })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, status, severity, dateField, sort, preset: per.preset, from: per.from, to: per.to }, period: { today: per.today, timeZone: per.tz },
    };
  }

  async investigationTimeline(ctx: McCtx, id: string) {
    this.need(ctx);
    const T = ctx.tenantId;
    if (!isUuid(id)) throw new MoneyCenterError('That investigation was not found.', 'MC_NOT_FOUND', 404);
    const inv = (await sql<Row>`select i.id, i.related, i.branch_id from money_protection_investigations i where i.tenant_id = ${T} and i.id = ${id}::uuid and ${this.scope(sql`i.branch_id`, ctx).w}`.execute(this.db)).rows[0];
    if (!inv) throw new MoneyCenterError('That investigation was not found.', 'MC_NOT_FOUND', 404);
    const notes = (await sql<Row>`select n.body, n.created_at, coalesce(u.full_name, u.email) as actor from money_protection_investigation_notes n left join users u on u.id = n.author_user_id and u.tenant_id = n.tenant_id
      where n.tenant_id = ${T} and n.investigation_id = ${id}::uuid`.execute(this.db)).rows;
    const events = (await sql<Row>`select e.action, e.from_state, e.to_state, e.detail, e.created_at, coalesce(u.full_name, u.email) as actor from money_protection_events e left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id
      where e.tenant_id = ${T} and e.entity_type = 'investigation' and e.entity_id = ${id}`.execute(this.db)).rows;
    const alertIds = arr((inv.related ?? {}).alertIds).filter(isUuid);
    const alerts = alertIds.length ? (await sql<Row>`select a.id, a.rule_id, a.alert_type, a.severity, a.status, a.risk_score, a.confidence, a.amount_cents, a.event_count, a.first_seen_at, a.last_seen_at, a.updated_at, a.investigation_id, null as branch from money_protection_alerts a where a.tenant_id = ${T} and a.id = any(${alertIds}::uuid[])`.execute(this.db)).rows : [];
    const items = [...notes.map((n) => ({ kind: 'note', text: n.body, actor: n.actor ?? null, at: iso(n.created_at) })),
      ...events.map((e) => ({ kind: 'event', action: e.action, from: e.from_state, to: e.to_state, detail: e.detail ?? {}, actor: e.actor ?? null, at: iso(e.created_at) }))]
      .sort((a, z) => String(z.at).localeCompare(String(a.at)));
    return { items, alerts: alerts.map((r) => this.alertOut(r)), appendOnly: true };
  }

  // ── rules and their settings ───────────────────────────────────────────────────────────────────────────────
  async rules(ctx: McCtx) {
    this.need(ctx);
    const T = ctx.tenantId;
    const settings = (await sql<Row>`select rule_id, enabled, severity_override, thresholds, updated_at, updated_by_user_id from money_protection_rule_settings where tenant_id = ${T}`.execute(this.db)).rows;
    const counts = (await sql<Row>`select a.rule_id, count(*) filter (where a.created_at > now() - interval '30 days')::int as n30,
        count(*) filter (where a.status = any(${MC_OPEN}::text[]))::int as open, count(*) filter (where a.status = 'DISMISSED_FALSE_POSITIVE' and a.updated_at > now() - interval '90 days')::int as fp90,
        max(a.last_seen_at) as last from money_protection_alerts a where a.tenant_id = ${T} and ${this.scope(sql`a.branch_id`, ctx).w} group by 1`.execute(this.db)).rows;
    const f = this.deps.flags();
    const layerOn = (l: string) => f.enabled && (l === 'deterministic' ? f.deterministicRules : l === 'baseline' ? f.baselines : f.reconciliation);
    return {
      rules: RULE_CATALOG.map((d) => {
        const s = settings.find((x) => x.rule_id === d.id); const c = counts.find((x) => x.rule_id === d.id);
        const enabled = s ? !!s.enabled : true;
        return { id: d.id, name: d.name, category: d.category, layer: d.layer, mode: d.evaluationMode, description: d.description, humanReview: d.humanReview,
          defaultSeverity: d.severity, severity: s?.severity_override ?? d.severity, severityOverridden: !!s?.severity_override,
          defaultThresholds: d.defaultThresholds, thresholds: { ...d.defaultThresholds, ...((s?.thresholds as Record<string, unknown>) ?? {}) },
          enabled, layerOn: layerOn(d.layer), effective: enabled && layerOn(d.layer), updatedAt: iso(s?.updated_at),
          alerts30d: N(c?.n30), open: N(c?.open), dismissed90d: N(c?.fp90), lastAlertAt: iso(c?.last) };
      }),
      canEdit: has(ctx, 'ai_money_protection.manage_settings'),
    };
  }

  async saveRule(ctx: McCtx, ruleId: string, b: { enabled?: unknown; severityOverride?: unknown; thresholds?: unknown; reason?: unknown; expectedUpdatedAt?: unknown }) {
    this.need(ctx, 'ai_money_protection.manage_settings');
    const d = RULE.get(ruleId);
    if (!d) throw new MoneyCenterError('That rule does not exist.', 'MC_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const before = (await sql<Row>`select enabled, severity_override, thresholds, updated_at from money_protection_rule_settings where tenant_id = ${T} and rule_id = ${ruleId}`.execute(this.db)).rows[0];
    const exp = typeof b.expectedUpdatedAt === 'string' ? b.expectedUpdatedAt : null;
    if ((before && exp !== iso(before.updated_at)) || (!before && exp)) throw new MoneyCenterError('This rule was changed by someone else. Reload it.', 'MC_STALE', 409);
    const prev = { enabled: before ? !!before.enabled : true, severity: before?.severity_override ?? d.severity, thresholds: { ...d.defaultThresholds, ...((before?.thresholds as Record<string, unknown>) ?? {}) } };
    const enabled = typeof b.enabled === 'boolean' ? b.enabled : prev.enabled;
    const sevOverride = b.severityOverride === null ? null : typeof b.severityOverride === 'string' ? b.severityOverride : (before?.severity_override ?? null);
    const thresholds = b.thresholds && typeof b.thresholds === 'object' && !Array.isArray(b.thresholds) ? b.thresholds as Record<string, unknown> : ((before?.thresholds as Record<string, unknown>) ?? {});
    const nextSeverity = sevOverride ?? d.severity;
    const weaker = (prev.enabled && !enabled) || (SEV_RANK[nextSeverity] ?? 0) < (SEV_RANK[prev.severity] ?? 0);
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 1000) : '';
    if (weaker && reason.length < 5) throw new MoneyCenterError('Turning a rule off or lowering its severity needs a reason (at least 5 characters).', 'MC_REASON_REQUIRED');
    await this.deps.saveRule(ctx, ruleId, { enabled, severityOverride: sevOverride, thresholds });
    const after = (await sql<Row>`select enabled, severity_override, thresholds, updated_at from money_protection_rule_settings where tenant_id = ${T} and rule_id = ${ruleId}`.execute(this.db)).rows[0];
    const next = { enabled: !!after?.enabled, severity: after?.severity_override ?? d.severity, thresholds: { ...d.defaultThresholds, ...((after?.thresholds as Record<string, unknown>) ?? {}) } };
    await this.event(this.db, ctx, { entityType: 'rule', entityId: ruleId, action: 'setting_changed', from: prev.enabled ? 'on' : 'off', to: next.enabled ? 'on' : 'off', reason: reason || null,
      detail: { before: prev, after: next, weaker } });
    await recordAuditStrict(this.db, { tenantId: T, branchId: null, userId: isUuid(ctx.userId) ? ctx.userId! : null, role: ctx.role ?? null },
      { module: 'ai_money_protection', action: 'money_protection_rule.setting_changed', resourceType: 'money_protection_rule', resourceId: ruleId,
        summary: `Money Protection rule ${d.name} changed`, reason: reason || undefined, before: prev, after: next });
    return { ruleId, before: prev, after: next, updatedAt: iso(after?.updated_at) };
  }

  async settingsHistory(ctx: McCtx, f: Record<string, unknown>) {
    this.need(ctx);
    const T = ctx.tenantId;
    const { page, pageSize } = this.paging(f);
    const per = await this.period(ctx, f);
    const q = String(f.q ?? '').trim().slice(0, 80);
    const where = [sql`e.tenant_id = ${T}`, sql`e.entity_type = 'rule'`];
    if (per.start && per.end) where.push(sql`e.created_at >= ${per.start} and e.created_at < ${per.end}`);
    if (q) {
      const ids = RULE_CATALOG.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()) || r.id.toLowerCase().includes(q.toLowerCase())).map((r) => r.id);
      where.push(sql`(e.entity_id = any(${ids}::text[]) or coalesce(e.reason, '') ilike ${esc(q)} or coalesce(u.full_name, '') ilike ${esc(q)})`);
    }
    const W = sql.join(where, sql` and `);
    const FROM = sql`money_protection_events e left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select e.id, e.entity_id, e.reason, e.detail, e.created_at, coalesce(u.full_name, u.email) as actor from ${FROM} where ${W} order by e.created_at desc, e.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((r) => ({ id: String(r.id), ruleId: r.entity_id, rule: RULE.get(String(r.entity_id))?.name ?? r.entity_id, reason: r.reason ?? null, actor: r.actor ?? null, at: iso(r.created_at),
        before: (r.detail ?? {}).before ?? null, after: (r.detail ?? {}).after ?? null, weaker: !!(r.detail ?? {}).weaker })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), period: { today: per.today, timeZone: per.tz } };
  }

  // ── detection ──────────────────────────────────────────────────────────────────────────────────────────────
  /** one recorded detection pass. Manual: needs manage_rules and is limited to one per 2 minutes per salon. */
  async runDetection(ctx: McCtx, trigger: 'manual' | 'scheduled') {
    if (trigger === 'manual') this.need(ctx, 'ai_money_protection.manage_rules');
    const T = ctx.tenantId;
    const runId = randomUUID();
    const started = await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('mp-detection:' || ${T}))`.execute(trx);
      const recent = (await sql<Row>`select id, status, started_at from money_protection_detection_runs where tenant_id = ${T}
        and (status = 'running' and started_at > now() - interval '1 hour' or ${trigger === 'manual'} and started_at > now() - ${MANUAL_GAP_SECONDS + ' seconds'}::interval)
        order by started_at desc limit 1`.execute(trx)).rows[0];
      if (recent) return { reused: String(recent.id), status: recent.status };
      await sql`insert into money_protection_detection_runs (id, tenant_id, trigger_kind, actor_user_id) values (${runId}, ${T}, ${trigger}, ${trigger === 'manual' && isUuid(ctx.userId) ? ctx.userId : null})`.execute(trx);
      return null;
    });
    if (started) return { id: started.reused, status: started.status, reused: true };
    try {
      const r = await this.deps.detect(T);
      await sql`update money_protection_detection_runs set status = 'succeeded', finished_at = clock_timestamp(), evaluated = ${r.evaluated}, created_alerts = ${r.created},
        updated_alerts = ${r.updated}, layers = ${JSON.stringify(r.layers)}::jsonb where id = ${runId}`.execute(this.db);
      return { id: runId, status: 'succeeded', reused: false, evaluated: r.evaluated, created: r.created, updated: r.updated };
    } catch (e) {
      const code = e instanceof Error && /DISABLED/.test(e.message) ? 'module_disabled' : 'detection_failed';
      await sql`update money_protection_detection_runs set status = 'failed', finished_at = clock_timestamp(), error_code = ${code} where id = ${runId}`.execute(this.db);
      if (trigger === 'manual') throw new MoneyCenterError(code === 'module_disabled' ? 'Money Protection is not active for this salon.' : 'Detection could not finish. Run the system check.', 'MC_DETECTION_FAILED', 503, { runId });
      return { id: runId, status: 'failed', reused: false, errorCode: code };
    }
  }

  async detectionRuns(ctx: McCtx, f: Record<string, unknown>) {
    this.need(ctx);
    const T = ctx.tenantId;
    const { page, pageSize } = this.paging(f);
    const per = await this.period(ctx, f);
    const where = [sql`r.tenant_id = ${T}`];
    if (per.start && per.end) where.push(sql`r.started_at >= ${per.start} and r.started_at < ${per.end}`);
    const W = sql.join(where, sql` and `);
    const total = N((await sql<Row>`select count(*)::int as n from money_protection_detection_runs r where r.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select r.id, r.trigger_kind, r.status, r.started_at, r.finished_at, r.evaluated, r.created_alerts, r.updated_alerts, r.error_code, coalesce(u.full_name, u.email) as actor
      from money_protection_detection_runs r left join users u on u.id = r.actor_user_id and u.tenant_id = r.tenant_id
      where r.tenant_id = ${T} and ${W} order by r.started_at desc, r.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((r) => ({ id: String(r.id), trigger: r.trigger_kind, status: r.status, startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), evaluated: N(r.evaluated),
        created: N(r.created_alerts), updated: N(r.updated_alerts), errorCode: r.error_code ?? null, actor: r.actor ?? null })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), period: { today: per.today, timeZone: per.tz } };
  }

  // ── Check AI Money Protection System — read-only ───────────────────────────────────────────────────────────
  async check(ctx: McCtx) {
    this.need(ctx);
    const T = ctx.tenantId;
    type St = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from money_protection_health_runs where tenant_id = ${T} and branch_id is not distinct from ${isUuid(ctx.branchId) ? ctx.branchId : null}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: Array<{ key: string; component: string; state: St; count?: number | null; detail?: Record<string, unknown>; lastPassedAt?: string | null }> = [];
    const one = async (q: { execute: (db: Kysely<any>) => Promise<{ rows: Row[] }> }): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    const f = this.deps.flags();
    let entitled: boolean | null = null;
    try { entitled = this.deps.entitlement ? await this.deps.entitlement.hasMoneyProtection(T) : true; } catch { entitled = null; }
    checks.push({ key: 'subscription', component: 'subscription', state: entitled == null ? 'UNAVAILABLE' : entitled ? 'PASSED' : 'FAILED' });
    checks.push({ key: 'module_enabled', component: 'detection', state: !f.enabled ? 'FAILED' : f.deterministicRules && f.reconciliation && f.baselines ? 'PASSED' : 'WARNING',
      detail: { deterministic: f.deterministicRules, baselines: f.baselines, reconciliation: f.reconciliation } });
    checks.push({ key: 'detection_scheduled', component: 'detection', state: this.deps.scheduled() ? 'PASSED' : 'WARNING' });
    const runs = await one(sql<Row>`select max(finished_at) filter (where status = 'succeeded') as ok_at, count(*)::int as n,
        count(*) filter (where status = 'failed' and started_at > now() - interval '7 days')::int as failed7,
        count(*) filter (where status = 'running' and started_at < now() - interval '1 hour')::int as stuck,
        (array_agg(status order by started_at desc))[1] as last_status
      from money_protection_detection_runs where tenant_id = ${T}`);
    const okAt = runs.ok_at ? new Date(runs.ok_at).getTime() : null;
    checks.push({ key: 'detection_recent', component: 'detection', state: !N(runs.n) ? 'FAILED' : !okAt ? 'FAILED' : okAt < this.now() - 26 * 3600e3 ? 'WARNING' : 'PASSED', detail: { lastSuccessAt: iso(runs.ok_at) } });
    checks.push({ key: 'detection_failures', component: 'detection', state: runs.last_status === 'failed' ? 'FAILED' : N(runs.failed7) || N(runs.stuck) ? 'WARNING' : N(runs.n) ? 'PASSED' : 'INSUFFICIENT_DATA',
      count: N(runs.failed7) + N(runs.stuck), detail: { failed7d: N(runs.failed7), stuck: N(runs.stuck) } });
    const pay = await one(sql<Row>`select count(*)::int as n7, max(created_at) as last from payments where tenant_id = ${T} and ${this.scope(sql`branch_id`, ctx).w} and created_at > now() - interval '7 days'`);
    checks.push({ key: 'payments_feed', component: 'sources', state: N(pay.n7) ? 'PASSED' : 'INSUFFICIENT_DATA', count: N(pay.n7) });
    const disabled = (await sql<Row>`select rule_id from money_protection_rule_settings where tenant_id = ${T} and enabled = false`.execute(this.db)).rows.map((r) => String(r.rule_id));
    const critOff = disabled.filter((id) => RULE.get(id)?.severity === 'CRITICAL');
    checks.push({ key: 'rules_enabled', component: 'rules', state: critOff.length ? 'WARNING' : 'PASSED', count: disabled.length, detail: { off: disabled, criticalOff: critOff, total: RULE_CATALOG.length } });
    const S = this.scope(sql`a.branch_id`, ctx).w;
    const al = await one(sql<Row>`select count(*) filter (where a.status = 'NEW' and a.severity in ('CRITICAL', 'HIGH') and a.first_seen_at < now() - interval '24 hours')::int as stale,
        count(*) filter (where a.status = 'DISMISSED_FALSE_POSITIVE' and not exists (select 1 from money_protection_events e where e.tenant_id = a.tenant_id and e.entity_type = 'alert'
          and e.entity_id = a.id::text and e.action = 'dismiss'))::int as unexplained,
        count(*) filter (where a.evidence::text ~ ${LEAK_RE})::int as leak
      from money_protection_alerts a where a.tenant_id = ${T} and ${S}`);
    checks.push({ key: 'urgent_reviewed', component: 'alerts', state: N(al.stale) ? 'FAILED' : 'PASSED', count: N(al.stale) });
    checks.push({ key: 'dismissals_explained', component: 'alerts', state: N(al.unexplained) ? 'WARNING' : 'PASSED', count: N(al.unexplained) });
    checks.push({ key: 'no_card_data', component: 'privacy', state: N(al.leak) ? 'FAILED' : 'PASSED', count: N(al.leak) });
    const broken = N((await one(sql<Row>`select count(*)::int as n from money_protection_alerts a left join money_protection_investigations i on i.id = a.investigation_id
      where a.tenant_id = ${T} and a.investigation_id is not null and (i.id is null or i.tenant_id <> a.tenant_id)`)).n);
    checks.push({ key: 'case_links', component: 'investigations', state: broken ? 'FAILED' : 'PASSED', count: broken });
    const unassigned = N((await one(sql<Row>`select count(*)::int as n from money_protection_investigations i where i.tenant_id = ${T} and ${this.scope(sql`i.branch_id`, ctx).w}
      and i.status not in ('RESOLVED', 'CLOSED') and i.assigned_user_id is null and i.created_at < now() - interval '24 hours'`)).n);
    checks.push({ key: 'cases_assigned', component: 'investigations', state: unassigned ? 'WARNING' : 'PASSED', count: unassigned });
    const noHist = N((await one(sql<Row>`select count(*)::int as n from money_protection_rule_settings s where s.tenant_id = ${T}
      and not exists (select 1 from money_protection_events e where e.tenant_id = s.tenant_id and e.entity_type = 'rule' and e.entity_id = s.rule_id)`)).n);
    checks.push({ key: 'settings_history', component: 'rules', state: noHist ? 'WARNING' : 'PASSED', count: noHist });
    const cross = N((await one(sql<Row>`select count(*)::int as n from money_protection_alerts a join branches b on b.id = a.branch_id where a.tenant_id = ${T} and b.tenant_id <> a.tenant_id`)).n);
    checks.push({ key: 'tenant_isolation', component: 'security', state: cross ? 'FAILED' : 'PASSED', count: cross });
    checks.push({ key: 'no_money_moved', component: 'security', state: f.autoExactDuplicatePrevention ? 'WARNING' : 'PASSED', detail: { autoDuplicatePrevention: f.autoExactDuplicatePrevention } });

    const prev = (await sql<Row>`select c->>'key' as key, max(h.created_at) as at from money_protection_health_runs h cross join lateral jsonb_array_elements(h.checks) c
      where h.tenant_id = ${T} and h.branch_id is not distinct from ${isUuid(ctx.branchId) ? ctx.branchId : null} and c->>'state' = 'PASSED' group by 1`.execute(this.db)).rows;
    const checkedAt = new Date(this.now()).toISOString();
    for (const c of checks) c.lastPassedAt = c.state === 'PASSED' ? checkedAt : iso(prev.find((p) => p.key === c.key)?.at);
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING' : 'PASSED';
    const id = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('mp-health:' || ${T} || ':' || coalesce(${isUuid(ctx.branchId) ? ctx.branchId : null}::text, '')))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into money_protection_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${id}, ${T}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id, overall, checks, checkedAt, reused: false };
    });
  }
}

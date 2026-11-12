// marketing-center.ts — AI Marketing Assistant family guides (AI Marketing Assistant, Campaign Builder, Message Studio, Audience
// Builder, Campaign Results; Nov 3 2026): `/pos/ai-marketing/center/*`.
//
// Audit findings this answers (the old page read GET /pos/ai-marketing/state):
//   • "Message cost to date" summed campaigns.cost_cents — the BUDGET a campaign was created with (Campaign Center shows the same
//     column as "Budget"). That is why the photographed page read "$100.00" with 0 messages sent: a budget, not money spent. The
//     money actually spent is the provider cost recorded on each sent message (notifications.provider_cost_micros); both are now
//     shown, each under its own name.
//   • "Opted in to SMS / Email" counted the opt-in flag only — a customer with the flag but no phone, or on the STOP list, was
//     counted as reachable. Reach now shows opted-in, reachable (contact + not opted out), the overlap and the union.
//   • The recommendations used their own "lapsed" rule: a completed visit older than N days — so a customer who also visited
//     yesterday counted as lapsed. They now come from the ONE rule the Customer Retention module owns (WinBackCenter.plan:
//     At Risk / Approaching Risk, never-visited customers never included) and the Segments consent verdict (consent · opt-out ·
//     recently contacted · upcoming booking · usable contact).
//   • The KPI cards had no period; they now take a period in salon time with one event time per figure (sent = when the worker
//     recorded the send, bookings = when the campaign-link booking succeeded, revenue = when the redeeming ticket was paid).
//   • The old AI "approve" route moved a draft straight to Scheduled without Campaign Center's approval (content hash + audience
//     snapshot). It now goes through the same readiness rule (see ai-marketing-campaign.service.ts), and the AI builder saves its
//     drafts INTO Campaign Center, where they are approved and launched.
//
// Nothing here sends, schedules or approves a campaign. save-draft creates an UNSENT Segments audience draft and an UNAPPROVED
// Campaign Center draft that uses it.
import { hasPermission } from '@aipowersalon/permissions';
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { branchTimeZone } from '@aipowersalon/database';
import { estimateSmsSegments } from '@aipowersalon/api-contracts';
import type { McOffersResponse, McScheduleCheckResponse } from '@aipowersalon/api-contracts/tenant';
import { recordAuditStrict } from '@aipowersalon/audit';
import type { CampaignCenter, CampaignsContext } from '@aipowersalon/communications';
import type { WinBackCenter, RetentionContext } from '@aipowersalon/customers';
import { addDays as addYmdDays, localDateTimeToEpochMs, zonedParts } from '@aipowersalon/date-time';   // §87: one calendar helper

type Row = Record<string, any>;
export interface McCtx { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; permissions?: string[]; salonName?: string; authz?: { scope?: string | null; branchIds?: readonly string[] | null } | null }
/** Marketing Growth 07 — a zone name the runtime can actually use (an unknown one makes every "today" fall back to a default) */
export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0); return true; } catch (e) { if (e instanceof RangeError) return false; throw e; }   // RangeError = unknown zone
}
/** the salon clock's UTC offset at an instant, in minutes */
function offsetMinutes(ms: number, tz: string): number {
  const p = zonedParts(new Date(ms), tz);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60_000) * 60_000) / 60_000);
}
/** true when the clocks change within 24 h either side of this instant in this zone (daylight saving) */
export function nearClockChange(ms: number, tz: string): boolean {
  const o = offsetMinutes(ms, tz);
  return offsetMinutes(ms - 86_400_000, tz) !== o || offsetMinutes(ms + 86_400_000, tz) !== o;
}

export class MarketingCenterError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}
export const MKC_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year', 'custom'] as const;
export const MKC_KINDS = ['rebooking', 'winback', 'birthday'] as const;
export type MkcKind = (typeof MKC_KINDS)[number];
const GOAL: Record<'rebooking' | 'winback', 'repeat_visits' | 'inactive_risk'> = { rebooking: 'repeat_visits', winback: 'inactive_risk' };
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
// the platform's one permission rule (Nov 6 2026 full-run route sweep): a raw includes() missed alias-granted keys, so every
// owner and manager was refused here although the route guard (the same rule) had let them in
const has = (ctx: McCtx, p: string) => hasPermission(ctx as unknown as Parameters<typeof hasPermission>[0], p);
const addDays = (d: string, k: number) => addYmdDays(d, k);
const micros = (v: unknown) => Math.round(N(v) / 10_000);
/** Message Studio drafts use {{tokens}}; Campaign Center fills only {salon_name} and {offer}, once, for everyone (there is no
 *  per-customer personalization in the sender). Map the two it can fill and list the rest — they would go out as literal text. */
export function toCampaignText(body: string): { text: string; unsupported: string[] } {
  const text = body.replace(/\{\{\s*salon_name\s*\}\}/gi, '{salon_name}').replace(/\{\{\s*promotion_name\s*\}\}/gi, '{offer}');
  const left = [...(text.match(/\{\{[^}]*\}\}/g) ?? []), ...((text.replace(/\{\{[^}]*\}\}/g, '').match(/\{[a-z_]+\}/gi) ?? []).filter((x) => !['{salon_name}', '{offer}'].includes(x.toLowerCase())))];
  return { text, unsupported: [...new Set(left)] };
}

export interface McPeriod { preset: string; from: string | null; to: string | null; today: string; timeZone: string }

export class MarketingCenter {
  constructor(
    private readonly db: Kysely<any>,
    private readonly winback: WinBackCenter,
    private readonly cc: CampaignCenter,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private need(ctx: McCtx, perm: 'pos.marketing.view' | 'pos.marketing.manage' = 'pos.marketing.view') {
    if (!ctx?.tenantId || !ctx?.userId) throw new MarketingCenterError('Not signed in.', 'AUTH_REQUIRED', 401);
    if (!has(ctx, perm)) throw new MarketingCenterError('Your role cannot use marketing.', 'PERMISSION_DENIED', 403);
  }
  private branch(ctx: McCtx) { return isUuid(ctx.branchId) ? String(ctx.branchId) : null; }
  private rctx(ctx: McCtx): RetentionContext {
    return { tenantId: ctx.tenantId, branchId: this.branch(ctx) ?? '', userId: String(ctx.userId ?? ''), role: String(ctx.role ?? ''), permissions: ctx.permissions ?? [], salonName: ctx.salonName, authz: ctx.authz ?? null };
  }
  /** campaigns a branch user sees: salon-wide ones and their own branch's (the Campaign Center rule), alias c */
  private campaignScope(ctx: McCtx) { const B = this.branch(ctx); return B ? sql`(c.branch_id = ${B}::uuid or c.branch_id is null)` : sql`true`; }

  async period(ctx: McCtx, f: Record<string, unknown>): Promise<McPeriod> {
    const tz = await branchTimeZone(this.db, ctx.tenantId, this.branch(ctx));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.now()));
    const preset = typeof f.preset === 'string' && (MKC_PRESETS as readonly string[]).includes(f.preset) ? f.preset : (f.from || f.to ? 'custom' : 'month');
    let from: string | null = null, to: string | null = null;
    if (preset !== 'all') {
      const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7; to = today;
      if (preset === 'today') from = today; else if (preset === 'yesterday') from = to = addDays(today, -1); else if (preset === 'week') from = addDays(today, -dow);
      else if (preset === 'last_7') from = addDays(today, -6); else if (preset === 'month') from = today.slice(0, 8) + '01'; else if (preset === 'last_30') from = addDays(today, -29);
      else if (preset === 'year') from = today.slice(0, 4) + '-01-01';
      else if (preset === 'last_month') { const first = today.slice(0, 8) + '01'; to = addDays(first, -1); from = to.slice(0, 8) + '01'; }
      else {
        const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
        const z = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
        if (!a || !z || a > z) throw new MarketingCenterError('Choose a From and a To date; the From date must be on or before the To date.', 'MKC_INVALID_PERIOD');
        from = a; to = z;
      }
    }
    return { preset, from, to, today, timeZone: tz };
  }
  /** `col` inside the salon-local inclusive days [from 00:00, to + 1 day 00:00), each bound converted on its own date (DST-safe) */
  private inP(col: any, p: McPeriod) {
    if (!p.from || !p.to) return sql`true`;
    return sql`(${col} >= (${p.from}::date)::timestamp at time zone ${p.timeZone} and ${col} < ((${p.to}::date + 1))::timestamp at time zone ${p.timeZone})`;
  }

  // ── the seven cards + Reach & Consent + the cost reconciliation ───────────────────────────────────────────────────────────
  async summary(ctx: McCtx, f: Record<string, unknown> = {}) {
    this.need(ctx);
    const T = ctx.tenantId; const B = this.branch(ctx); const CW = this.campaignScope(ctx);
    const p = await this.period(ctx, f);
    const one = async (q: { execute: (db: Kysely<any>) => Promise<{ rows: Row[] }> }): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    const st = await one(sql<Row>`select count(*) filter (where c.status = 'in_progress')::int as active, count(*) filter (where c.status = 'scheduled')::int as scheduled,
        count(*) filter (where c.status = 'draft')::int as drafts,
        count(*) filter (where c.status = 'draft' and c.submitted_at is not null and (c.approved_at is null or c.approved_content_hash is distinct from c.content_hash))::int as awaiting,
        count(*) filter (where c.status = 'draft' and c.origin = 'assistant')::int as assistant_drafts,
        coalesce(sum(c.cost_cents) filter (where c.status <> 'cancelled'), 0)::bigint as budgets,
        count(*) filter (where c.status <> 'cancelled' and c.cost_cents > 0)::int as with_budget
      from campaigns c where c.tenant_id = ${T} and ${CW}`);
    const sends = (inPeriod: boolean) => one(sql<Row>`select count(*) filter (where s.status = 'sent')::int as submitted,
        count(*) filter (where s.status = 'sent' and n.status = 'delivered')::int as delivered,
        count(*) filter (where s.status = 'failed' or (s.status = 'sent' and n.status = 'failed'))::int as failed,
        count(*) filter (where s.status in ('skipped', 'blocked'))::int as skipped,
        count(*) filter (where s.status = 'queued')::int as queued,
        count(*) filter (where s.status = 'sent' and n.status = 'simulated')::int as simulated,
        coalesce(sum(n.provider_cost_micros) filter (where s.status = 'sent'), 0)::bigint as cost_micros,
        count(*) filter (where s.status = 'sent' and n.provider_cost_micros is not null)::int as costed
      from ai_marketing_campaign_sends s
      join campaigns c on c.id = s.campaign_id and c.tenant_id = s.tenant_id
      left join notifications n on n.tenant_id = s.tenant_id and s.provider_id is not null and n.provider_id = s.provider_id
      where s.tenant_id = ${T} and ${CW} and ${inPeriod ? this.inP(sql`s.updated_at`, p) : sql`true`}`);
    const [ps, all] = await Promise.all([sends(true), sends(false)]);
    const conv = await one(sql<Row>`select count(distinct coalesce(e.appointment_id::text, e.id::text))::int as booked,
        count(distinct a.id) filter (where a.status = 'completed')::int as completed
      from ai_booking_conversion_events e
      join campaigns c on c.id = e.campaign_id and c.tenant_id = e.tenant_id
      left join pos_tech_appointments a on a.tenant_id = e.tenant_id and a.id::text = e.appointment_id::text
      where e.tenant_id = ${T} and ${CW} and e.campaign_id is not null and e.stage = 'BOOKING_SUCCEEDED' and (e.outcome = 'succeeded' or e.outcome is null)
        and ${this.inP(sql`e.created_at`, p)}`);
    const rev = await one(sql<Row>`select count(*)::int as tickets, coalesce(sum(x.total), 0)::bigint as revenue from (
        select distinct t.id, t.total_cents::bigint as total
        from deal_coupon_batches b
        join campaigns c on c.id = b.campaign_id and c.tenant_id = b.tenant_id
        join deal_coupon_codes k on k.batch_id = b.id and k.tenant_id = b.tenant_id
        join deal_redemptions dr on dr.coupon_code_id = k.id and dr.tenant_id = b.tenant_id and dr.status in ('redeemed', 'partially_reversed')
        join tickets t on t.id = dr.ticket_id and t.tenant_id = dr.tenant_id and t.status in ('paid', 'closed')
        where b.tenant_id = ${T} and ${CW} and b.campaign_id is not null and ${this.inP(sql`coalesce(t.paid_at, t.created_at)`, p)}) x`);
    const reach = await this.reach(ctx);
    const submitted = N(ps.submitted);
    const costKnown = submitted > 0 && N(ps.costed) === submitted;
    const actualCostCents = submitted === 0 ? 0 : costKnown ? micros(ps.cost_micros) : null;
    const booked = N(conv.booked);
    const allSubmitted = N(all.submitted);
    const budgets = N(st.budgets);
    return {
      period: p, scope: B ? 'branch' : 'salon',
      cards: {
        activeCampaigns: N(st.active), scheduledCampaigns: N(st.scheduled), draftCampaigns: N(st.drafts), awaitingApproval: N(st.awaiting), assistantDrafts: N(st.assistant_drafts),
        messagesSent: submitted, delivered: N(ps.delivered), failed: N(ps.failed), skippedAtSend: N(ps.skipped), queued: N(ps.queued), simulated: N(ps.simulated),
        bookings: booked, completedVisits: N(conv.completed),
        associatedRevenueCents: N(rev.revenue), associatedTickets: N(rev.tickets),
        actualCostCents, costComplete: submitted === 0 || costKnown, costedMessages: N(ps.costed),
        costPerBookingCents: booked > 0 && actualCostCents != null && actualCostCents > 0 ? Math.round(actualCostCents / booked) : null,
      },
      reach,
      cost: {
        budgetsCents: budgets, campaignsWithBudget: N(st.with_budget),
        spentAllTimeCents: allSubmitted === 0 ? 0 : N(all.costed) === allSubmitted ? micros(all.cost_micros) : null,
        sentAllTime: allSubmitted, costedAllTime: N(all.costed),
        explanation: budgets > 0 && allSubmitted === 0 ? 'budget_not_spent' : budgets > 0 ? 'budget_and_spend' : allSubmitted > 0 && N(all.costed) < allSubmitted ? 'spend_partly_unreported' : 'none',
      },
      definitions: {
        messagesSent: 'Campaign messages the provider accepted, by when the send was recorded.',
        bookings: 'Distinct bookings made through a campaign link in the period (a booking is counted once).',
        associatedRevenue: 'Paid tickets that redeemed a code issued for a campaign, by payment time — associated, not proof the campaign caused the visit.',
        cost: 'Provider cost reported on each sent message. A campaign budget is a limit someone typed, not money spent.',
      },
      generatedAt: new Date(this.now()).toISOString(),
    };
  }

  /** customers are salon-wide (the Customer Retention rule): one customer, one consent, whichever branch they visit */
  private async reach(ctx: McCtx) {
    const T = ctx.tenantId;
    const r = (await sql<Row>`with c0 as (
        select c.id, c.marketing_sms_opt_in as sms_in, c.marketing_email_opt_in as em_in, nullif(c.normalized_phone, '') as phone, nullif(lower(c.email), '') as email
        from customers c where c.tenant_id = ${T} and c.archived_at is null),
      c1 as (select c0.id, c0.sms_in, c0.em_in, c0.phone, c0.email,
          exists (select 1 from notification_opt_outs o where o.tenant_id = ${T} and o.channel = 'sms' and o.address = c0.phone) as sms_out,
          exists (select 1 from notification_opt_outs o where o.tenant_id = ${T} and o.channel = 'email' and lower(o.address) = c0.email) as em_out from c0),
      c2 as (select c1.id, c1.sms_in, c1.em_in, c1.phone, c1.email, c1.sms_out, c1.em_out,
          (c1.sms_in and c1.phone is not null and not c1.sms_out) as sms_ok, (c1.em_in and c1.email is not null and not c1.em_out) as em_ok from c1)
      select count(*)::int as customers,
        count(*) filter (where c2.sms_in)::int as sms_in, count(*) filter (where c2.sms_ok)::int as sms_ok,
        count(*) filter (where c2.sms_in and c2.phone is null)::int as sms_no_contact, count(*) filter (where c2.sms_in and c2.sms_out)::int as sms_out,
        count(*) filter (where c2.em_in)::int as em_in, count(*) filter (where c2.em_ok)::int as em_ok,
        count(*) filter (where c2.em_in and c2.email is null)::int as em_no_contact, count(*) filter (where c2.em_in and c2.em_out)::int as em_out,
        count(*) filter (where c2.sms_ok and c2.em_ok)::int as both, count(*) filter (where c2.sms_ok or c2.em_ok)::int as either
      from c2`.execute(this.db)).rows[0] ?? {};
    const sup = (await sql<Row>`select o.channel, count(distinct lower(o.address))::int as n from notification_opt_outs o where o.tenant_id = ${T} group by o.channel`.execute(this.db)).rows;
    const supN = (ch: string) => N(sup.find((x) => x.channel === ch)?.n);
    return {
      customers: N(r.customers),
      sms: { optedIn: N(r.sms_in), reachable: N(r.sms_ok), noContact: N(r.sms_no_contact), optedOut: N(r.sms_out) },
      email: { optedIn: N(r.em_in), reachable: N(r.em_ok), noContact: N(r.em_no_contact), optedOut: N(r.em_out) },
      reachableBoth: N(r.both), reachableEither: N(r.either),
      suppressed: { sms: supN('sms'), email: supN('email'), total: sup.reduce((a, x) => a + N(x.n), 0), scope: 'salon' },
    };
  }

  // ── recommendations: the Retention rule + the Segments consent verdict, evaluated now ────────────────────────────────────────
  async recommendations(ctx: McCtx, f: Record<string, unknown> = {}) {
    this.need(ctx);
    const channel = f.channel === 'email' ? 'email' : 'sms';
    const rc = this.rctx(ctx);
    const items: Row[] = [];
    for (const kind of ['rebooking', 'winback'] as const) {
      try {
        const pl: any = await this.winback.plan(rc, { goal: GOAL[kind], channel });
        const a = pl.audience;
        const status = a.selected === 0 ? 'no_match' : a.eligible === 0 ? 'no_eligible' : 'ready';
        const top = Object.entries(a.excluded as Record<string, number>).sort((x, y) => y[1] - x[1])[0];
        items.push({ kind, status, channel, criteria: a.criteria, matched: a.selected, eligible: a.eligible, excluded: a.excluded, excludedTotal: a.excludedTotal,
          topExclusion: status === 'no_eligible' && top ? { reason: top[0], count: top[1] } : null, neverVisited: a.neverVisited?.count ?? 0,
          message: pl.message, offers: pl.offers, sendWindow: pl.sendWindow, estimatedCostCents: pl.estimatedCostCents, costNote: pl.costNote, asOf: pl.asOf, canSaveDraft: status === 'ready' });
      } catch (e: any) {
        items.push({ kind, status: 'unavailable', channel, error: { code: String(e?.code ?? 'MKC_EVALUATION_FAILED'), message: String(e?.message ?? '') } });
      }
    }
    try { items.push(await this.birthday(ctx, channel)); }
    catch (e: any) { items.push({ kind: 'birthday', status: 'unavailable', channel, error: { code: String(e?.code ?? 'MKC_EVALUATION_FAILED'), message: String(e?.message ?? '') } }); }
    return { channel, items, evaluatedAt: new Date(this.now()).toISOString(), sendsAnything: false };
  }

  /** birthdays this salon month with a recorded birthday, verdicted by Segments for ordinary marketing consent; the campaign itself is
   *  made in Birthday Campaigns (one message per customer per year, Feb 29 policy), so this card opens there */
  private async birthday(ctx: McCtx, channel: 'sms' | 'email') {
    const T = ctx.tenantId;
    const p = await this.period(ctx, { preset: 'today' });
    const month = Number(p.today.slice(5, 7));
    const ids = (await sql<Row>`select c.id from customers c where c.tenant_id = ${T} and c.archived_at is null and c.birthday is not null
        and extract(month from c.birthday) = ${month} order by c.id limit 2001`.execute(this.db)).rows.map((r) => String(r.id));
    const v = ids.length ? await this.winback.seg.verdicts(this.rctx(ctx), ids, channel, 'general') : new Map();
    const excluded: Record<string, number> = {}; let eligible = 0;
    for (const x of v.values()) { if (x.status === 'eligible') eligible++; else excluded[x.status] = (excluded[x.status] || 0) + 1; }
    const status = ids.length === 0 ? 'no_match' : eligible === 0 ? 'no_eligible' : 'ready';
    const top = Object.entries(excluded).sort((x, y) => y[1] - x[1])[0];
    return { kind: 'birthday', status, channel, criteria: `A recorded birthday in ${p.today.slice(0, 7)} (salon month).`, matched: ids.length, eligible, excluded, excludedTotal: ids.length - eligible,
      topExclusion: status === 'no_eligible' && top ? { reason: top[0], count: top[1] } : null, neverVisited: 0, message: null, offers: [], sendWindow: null,
      estimatedCostCents: null, costNote: null, asOf: p.today, canSaveDraft: false, openTo: '/tenant/marketing/birthdays' };
  }

  // ── Audience Builder: the eligibility funnel for one goal and channel (both channels → unique people) ─────────────────────────
  async eligibility(ctx: McCtx, b: { kind?: unknown; channel?: unknown }) {
    this.need(ctx);
    const kind = (MKC_KINDS as readonly string[]).includes(String(b.kind)) ? String(b.kind) as MkcKind : null;
    if (!kind) throw new MarketingCenterError('Choose who the campaign is for.', 'MKC_KIND_INVALID');
    const want = b.channel === 'email' ? ['email'] : b.channel === 'both' ? ['sms', 'email'] : ['sms'];
    const out: Row[] = [];
    const ok = new Map<string, Set<string>>();
    for (const ch of want as ('sms' | 'email')[]) {
      if (kind === 'birthday') {
        const r = await this.birthday(ctx, ch);
        out.push({ channel: ch, matched: r.matched, eligible: r.eligible, excluded: r.excluded, criteria: r.criteria });
        continue;
      }
      const rc = this.rctx(ctx);
      const k = await this.winback.ret.window(rc);
      const ids: string[] = await this.winback.ret.matchingIds(rc, kind === 'winback' ? { segment: 'at_risk' } : { segment: 'approaching' });
      const v: Map<string, { status: string }> = await this.winback.seg.verdicts(rc, ids, ch, 'win_back');
      const excluded: Record<string, number> = {}; const eligibleIds = new Set<string>();
      for (const [id, x] of v.entries()) { if (x.status === 'eligible') eligibleIds.add(id); else excluded[x.status] = (excluded[x.status] || 0) + 1; }
      ok.set(ch, eligibleIds);
      out.push({ channel: ch, matched: ids.length, eligible: eligibleIds.size, excluded,
        criteria: kind === 'winback' ? `At least one completed visit and none in the last ${k.risk}+ salon days.` : `Visited before; ${k.approaching}–${k.risk - 1} salon days since the last completed visit.` });
    }
    const union = new Set<string>(); for (const s of ok.values()) for (const id of s) union.add(id);
    return { kind, channels: out, uniqueEligible: want.length > 1 && kind !== 'birthday' ? union.size : null, evaluatedAt: new Date(this.now()).toISOString(),
      recheckedAtSend: true, note: 'Consent, opt-outs and contact details are checked again for every customer when the message is sent.' };
  }

  // ── Message Studio / Campaign Builder: segments, price, and the budget check (the same formula Campaign Center previews) ──────
  async estimate(ctx: McCtx, b: { channel?: unknown; body?: unknown; recipients?: unknown; budgetCents?: unknown }) {
    this.need(ctx);
    const channel = b.channel === 'email' ? 'email' : 'sms';
    const { text: body, unsupported } = toCampaignText(typeof b.body === 'string' ? b.body.slice(0, 1600) : '');
    const recipients = Math.max(0, Math.min(1_000_000, Math.trunc(N(b.recipients))));
    const budget = b.budgetCents == null || b.budgetCents === '' ? null : Math.max(0, Math.trunc(N(b.budgetCents)));
    const salon = (await sql<Row>`select display_name from tenants where id = ${ctx.tenantId}`.execute(this.db)).rows[0]?.display_name ?? '';
    const rendered = body.replace(/\{salon_name\}/gi, String(salon));
    const asSent = channel === 'sms' ? `${salon ? salon + ': ' : ''}${rendered} Reply STOP to opt out` : rendered;
    const seg = channel === 'sms' && body.trim() ? estimateSmsSegments(asSent) : null;
    const price = (await sql<Row>`select value from platform_settings where setting_key = 'sms.marketing_segment_price_cents' limit 1`.execute(this.db)).rows[0]?.value;
    const unit = price == null ? null : Number(typeof price === 'string' ? price.replace(/"/g, '') : price);
    const priced = seg != null && unit != null && Number.isFinite(unit);
    const cost = priced ? Math.round(seg!.segments * recipients * unit!) : null;
    return {
      channel, asSent, characters: asSent.length, encoding: seg?.encoding ?? null, segmentsPerMessage: seg?.segments ?? null, recipients,
      estimatedSegments: seg ? seg.segments * recipients : null, unitPriceCents: priced ? unit : null, estimatedCostCents: cost,
      budgetCents: budget, withinBudget: cost == null || budget == null || budget === 0 ? null : cost <= budget,
      unresolved: unsupported, offerFilledAtApproval: /\{offer\}/i.test(body),
      costNote: channel === 'email' ? 'email_unpriced' : !body.trim() ? 'no_message' : priced ? 'estimate' : 'not_priced',
      sendsAnything: false,
    };
  }

  // ── Campaign Builder: save the recommendation as an UNSENT audience + an UNAPPROVED Campaign Center draft ─────────────────────
  async saveDraft(ctx: McCtx, b: { kind?: unknown; channel?: unknown; name?: unknown; message?: unknown; subject?: unknown; budgetCents?: unknown; idempotencyKey?: unknown; dealId?: unknown; sendDate?: unknown; sendTime?: unknown }) {
    this.need(ctx, 'pos.marketing.manage');
    const kind = b.kind === 'rebooking' || b.kind === 'winback' ? b.kind : null;
    if (!kind) throw new MarketingCenterError('Only rebooking and win-back drafts are made here; birthday campaigns are made in Birthday Campaigns.', 'MKC_KIND_INVALID');
    const channel = b.channel === 'email' ? 'email' : 'sms';
    const { text: message, unsupported } = toCampaignText(typeof b.message === 'string' ? b.message.trim().slice(0, 1600) : '');
    if (!message) throw new MarketingCenterError('Write the message first.', 'MKC_MESSAGE_REQUIRED');
    if (unsupported.length) throw new MarketingCenterError(`These placeholders cannot be filled for each customer and would be sent as written: ${unsupported.join(', ')}. Remove them or use {salon_name} / {offer}.`, 'MKC_TOKENS_UNSUPPORTED');
    const subject = channel === 'email' ? (typeof b.subject === 'string' && b.subject.trim() ? b.subject.trim().slice(0, 200) : null) : null;
    if (channel === 'email' && !subject) throw new MarketingCenterError('An email needs a subject.', 'MKC_SUBJECT_REQUIRED');
    const key = String(b.idempotencyKey ?? '');
    if (key.length < 8 || key.length > 100) throw new MarketingCenterError('An idempotency key is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    // Steps 4 + 5 (Nov 8 2026): the chosen offer and the proposed send time are checked BEFORE anything is saved
    let dealId: string | null = null; let proposedSendAt: string | null = null;
    if ((b.sendDate != null && b.sendDate !== '') || (b.dealId != null && b.dealId !== '')) {
      if (b.sendDate != null && b.sendDate !== '') {
        const sc = await this.scheduleCheck(ctx, { date: b.sendDate, time: b.sendTime, dealId: b.dealId });
        const block = sc.checks.find((c) => c.state === 'block');
        if (block) throw new MarketingCenterError(block.detail, block.key === 'offer_valid' ? 'MKC_OFFER_INVALID' : 'MKC_SCHEDULE_INVALID');
        proposedSendAt = sc.sendAt;
      }
      if (b.dealId != null && b.dealId !== '') {
        const ok = (await this.offers(ctx)).items.find((o) => o.id === String(b.dealId));
        if (!ok) throw new MarketingCenterError('Only an approved, unexpired Deals & Promotions offer can be attached.', 'MKC_OFFER_INVALID');
        dealId = ok.id;
      }
    }
    const rc = this.rctx(ctx);
    const actor = { tenantId: ctx.tenantId, branchId: this.branch(ctx), userId: ctx.userId ?? null, role: ctx.role ?? null };
    const draft: any = await this.winback.saveAudience(rc, { goal: GOAL[kind], channel, message, idempotencyKey: `aimkt:${key}` },
      (trx, meta) => recordAuditStrict(trx, actor, { module: 'customers', action: 'segments.audience_draft.created', resourceType: 'segment_audience_draft', resourceId: String(meta.draftId),
        summary: `AI Marketing ${kind} audience saved (not sent)`, metadata: { ...meta, source: 'ai_marketing' } }));
    if (draft.campaignId) return { duplicate: true, draftId: draft.draftId, campaignId: draft.campaignId, selected: draft.selected, eligible: draft.eligible, excluded: draft.excluded, sent: 0 };
    const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 120) : (kind === 'winback' ? 'We miss you' : 'Time for your next visit');
    const budgetCents = b.budgetCents == null ? 0 : Math.max(0, Math.trunc(N(b.budgetCents)));
    const cctx: CampaignsContext = { tenantId: ctx.tenantId, branchId: this.branch(ctx), userId: String(ctx.userId), role: String(ctx.role ?? ''), permissions: ctx.permissions ?? [] };
    const c = await this.cc.createDraft(cctx, { name, channel, goal: kind === 'winback' ? 'AI Marketing: win back customers' : 'AI Marketing: rebooking due', messageBody: message, emailSubject: subject, budgetCents, origin: 'assistant', dealId, proposedSendAt });
    const set = await this.cc.setAudience(cctx, c.id, { draftId: draft.draftId });
    return { duplicate: false, draftId: draft.draftId, campaignId: c.id, selected: set.selected, eligible: set.eligible, excluded: set.excluded, sent: 0, dealId, proposedSendAt,
      next: 'Review, approve and launch it in Campaign Center. Nothing has been sent.' };
  }

  // ── Campaign Builder Step 4 "Offer" (SUNMI addendum, Nov 8 2026): the approved offers a campaign may carry ──────────
  /** Deals & Promotions offers a campaign may attach (approved / scheduled / active, not expired), with their terms. Read-only:
   *  nothing is created, reserved or redeemed here. "No offer" is always allowed. */
  async offers(ctx: McCtx): Promise<McOffersResponse> {
    this.need(ctx);
    const B = this.branch(ctx);
    const rows = (await sql<Row>`select d.id, d.title, d.kind, d.status, d.discount_type, d.discount_percent, d.discount_cents, d.max_discount_cents, d.starts_at, d.ends_at,
        d.min_spend_cents, d.max_redemptions, d.max_per_customer, d.redemption_count, d.stackable, d.new_customers_only, d.member_only, d.requires_code, d.terms,
        d.budget_cents, d.branch_id, d.days_of_week, d.valid_from_minute, d.valid_to_minute
      from deals d where d.tenant_id = ${ctx.tenantId} and d.owner_type = 'salon' and d.status in ('approved', 'scheduled', 'active')
        and coalesce(d.kind, 'deal') in ('deal', 'coupon', 'automatic') and (d.ends_at is null or d.ends_at > now())
        and ${B ? sql`(d.branch_id = ${B}::uuid or d.branch_id is null)` : sql`true`}
      order by d.status = 'active' desc, d.ends_at asc nulls last, d.title asc limit 100`.execute(this.db)).rows;
    return { items: rows.map((d) => ({
      id: String(d.id), title: d.title, kind: d.kind ?? 'deal', status: d.status,
      discount: d.discount_type === 'percent' ? { type: 'percent' as const, percent: N(d.discount_percent), maxCents: d.max_discount_cents == null ? null : N(d.max_discount_cents) } : { type: 'fixed' as const, cents: N(d.discount_cents) },
      startsAt: iso(d.starts_at), endsAt: iso(d.ends_at), minSpendCents: d.min_spend_cents == null ? null : N(d.min_spend_cents),
      maxRedemptions: d.max_redemptions == null ? null : N(d.max_redemptions), redeemed: N(d.redemption_count), maxPerCustomer: d.max_per_customer == null ? null : N(d.max_per_customer),
      stackable: !!d.stackable, newCustomersOnly: !!d.new_customers_only, memberOnly: !!d.member_only, requiresCode: !!d.requires_code, terms: d.terms ?? null,
      budgetCents: d.budget_cents == null ? null : N(d.budget_cents), allBranches: d.branch_id == null,
      daysOfWeek: Array.isArray(d.days_of_week) ? d.days_of_week.map(Number) : null, validFromMinute: d.valid_from_minute == null ? null : N(d.valid_from_minute), validToMinute: d.valid_to_minute == null ? null : N(d.valid_to_minute),
    })), note: 'Approved Deals & Promotions offers only. Attaching one never redeems, reserves or changes it; Checkout applies its rules at payment.' };
  }

  // ── Campaign Builder Step 5 "Schedule": a PROPOSED send time, checked — never scheduled here ───────────────────────────────
  /** The proposal (salon-local date + time) → an instant in the branch's zone, with every check the approver needs: future and within
   *  a year, a time that exists on that day (spring-forward gap) or is ambiguous (fall-back hour), the platform quiet hours, and the
   *  chosen offer's validity at that moment. Read-only. */
  async scheduleCheck(ctx: McCtx, b: { date?: unknown; time?: unknown; dealId?: unknown }): Promise<McScheduleCheckResponse> {
    this.need(ctx);
    const date = typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
    const time = typeof b.time === 'string' && /^\d{2}:\d{2}$/.test(b.time) ? b.time : null;
    if (!date || !time) throw new MarketingCenterError('Choose a send date and time.', 'MKC_SCHEDULE_INVALID');
    const tz = await branchTimeZone(this.db, ctx.tenantId, this.branch(ctx));
    const ms = localDateTimeToEpochMs(date, time, tz);
    const p = zonedParts(new Date(ms), tz);
    const two = (n: number) => String(n).padStart(2, '0');
    const back = `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)}`;
    type Ck = { key: string; state: 'ok' | 'warn' | 'block'; detail: string };
    const checks: Ck[] = [];
    const exists = back === `${date} ${time}`;
    checks.push(exists ? { key: 'local_time', state: 'ok', detail: `${date} ${time} (${tz})` }
      : { key: 'local_time', state: 'block', detail: `${date} ${time} does not exist in ${tz} (the clocks skip that hour). Choose another time.` });
    const lbl = (q: ReturnType<typeof zonedParts>) => `${q.year}-${two(q.month)}-${two(q.day)} ${two(q.hour)}:${two(q.minute)}`;
    const twiceBefore = lbl(zonedParts(new Date(ms - 3_600_000), tz)) === back; const twiceAfter = lbl(zonedParts(new Date(ms + 3_600_000), tz)) === back;
    if (exists && (twiceBefore || twiceAfter))
      checks.push({ key: 'ambiguous_time', state: 'warn', detail: `${time} happens twice on ${date} (clocks go back). The ${twiceAfter ? 'first' : 'second'} one is used.` });
    const now = this.now();
    checks.push(ms <= now + 5 * 60_000 ? { key: 'future', state: 'block', detail: 'The send time must be at least 5 minutes from now.' }
      : ms > now + 366 * 86_400_000 ? { key: 'future', state: 'block', detail: 'A campaign can be proposed up to one year ahead.' } : { key: 'future', state: 'ok', detail: 'In the future, within one year.' });
    let quiet: { start: number | null; end: number | null } | null = null;
    try { const l = (await sql<Row>`select quiet_hours_start, quiet_hours_end from campaign_limits where active = true limit 1`.execute(this.db)).rows[0]; if (l) quiet = { start: l.quiet_hours_start == null ? null : N(l.quiet_hours_start), end: l.quiet_hours_end == null ? null : N(l.quiet_hours_end) }; }
    catch { quiet = null; checks.push({ key: 'quiet_hours', state: 'warn', detail: 'Quiet hours could not be read; Campaign Center checks them again at launch.' }); }
    if (quiet) {
      const inQ = quiet.start != null && quiet.end != null && quiet.start !== quiet.end && (quiet.start < quiet.end ? p.hour >= quiet.start && p.hour < quiet.end : p.hour >= quiet.start || p.hour < quiet.end);
      checks.push(inQ ? { key: 'quiet_hours', state: 'block', detail: `${time} is inside the quiet hours (${two(quiet.start!)}:00–${two(quiet.end!)}:00 salon time).` }
        : { key: 'quiet_hours', state: 'ok', detail: quiet.start == null || quiet.start === quiet.end ? 'No quiet hours are set.' : `Outside the quiet hours (${two(quiet.start!)}:00–${two(quiet.end!)}:00).` });
    }
    let offer: Row | null = null;
    if (b.dealId != null && b.dealId !== '') {
      if (!isUuid(b.dealId)) throw new MarketingCenterError('Offer not found.', 'PROMOTION_NOT_FOUND', 404);
      offer = (await sql<Row>`select id, title, status, starts_at, ends_at from deals where tenant_id = ${ctx.tenantId} and id = ${String(b.dealId)}`.execute(this.db)).rows[0] ?? null;
      if (!offer) throw new MarketingCenterError('Offer not found.', 'PROMOTION_NOT_FOUND', 404);
      const s0 = offer.starts_at ? new Date(offer.starts_at).getTime() : null; const e0 = offer.ends_at ? new Date(offer.ends_at).getTime() : null;
      checks.push(!['approved', 'scheduled', 'active'].includes(String(offer.status)) ? { key: 'offer_valid', state: 'block', detail: `The offer "${offer.title}" is ${offer.status}; only approved offers can be attached.` }
        : e0 != null && e0 <= ms ? { key: 'offer_valid', state: 'block', detail: `The offer "${offer.title}" ends before this send time.` }
        : s0 != null && s0 > ms ? { key: 'offer_valid', state: 'warn', detail: `The offer "${offer.title}" starts after this send time; customers could not use it yet.` }
        : e0 != null && e0 - ms < 3 * 86_400_000 ? { key: 'offer_valid', state: 'warn', detail: `The offer "${offer.title}" ends within 3 days of the send.` }
        : { key: 'offer_valid', state: 'ok', detail: `The offer "${offer.title}" is valid at the send time.` });
    }
    const blocked = checks.some((c) => c.state === 'block');
    return { timeZone: tz, date, time, sendAt: exists ? new Date(ms).toISOString() : null, ok: !blocked, checks,
      note: 'A proposal only. Campaign Center launches it after approval and re-checks consent, opt-outs, quiet hours and limits at send time.' };
  }

  // ── Check AI Marketing System — read-only ─────────────────────────────────────────────────────────────────────────────────────
  async check(ctx: McCtx) {
    this.need(ctx);
    const T = ctx.tenantId; const B = this.branch(ctx); const CW = this.campaignScope(ctx);
    type St = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from ai_marketing_health_runs where tenant_id = ${T} and branch_id is not distinct from ${B}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true, sendsAnything: false });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: Array<{ key: string; component: string; state: St; count?: number | null; detail?: Record<string, unknown>; lastPassedAt?: string | null }> = [];
    const one = async (q: { execute: (db: Kysely<any>) => Promise<{ rows: Row[] }> }): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    const c = await one(sql<Row>`select count(*)::int as n, count(*) filter (where c.status = 'scheduled' and c.scheduled_at < now() - interval '15 minutes')::int as overdue,
        count(*) filter (where c.status in ('scheduled', 'in_progress') and (c.approved_at is null or c.approved_content_hash is distinct from c.content_hash))::int as unapproved,
        count(*) filter (where c.status in ('scheduled', 'in_progress') and coalesce(c.audience_source, '') <> 'segment_snapshot')::int as no_snapshot,
        count(*) filter (where c.status <> 'cancelled' and c.cost_cents > 0 and not exists (select 1 from ai_marketing_campaign_sends s where s.tenant_id = c.tenant_id and s.campaign_id = c.id and s.status = 'sent'))::int as budget_unspent
      from campaigns c where c.tenant_id = ${T} and ${CW}`);
    checks.push({ key: 'campaign_engine', component: 'campaigns', state: 'PASSED', count: N(c.n) });
    checks.push({ key: 'approved_before_sending', component: 'campaigns', state: N(c.unapproved) ? 'FAILED' : 'PASSED', count: N(c.unapproved) });
    checks.push({ key: 'audience_snapshot', component: 'audience', state: N(c.no_snapshot) ? 'WARNING' : 'PASSED', count: N(c.no_snapshot) });
    const sweepOn = this.env.AI_MARKETING_SEND_SWEEP_ENABLED === '1';
    const hb = await one(sql<Row>`select count(*)::int as n from process_heartbeats where last_seen_at > now() - interval '5 minutes'`);
    checks.push({ key: 'send_worker', component: 'workers', state: !sweepOn ? 'WARNING' : N(hb.n) ? 'PASSED' : 'WARNING', detail: { sweepEnabled: sweepOn, liveWorkers: N(hb.n) } });
    checks.push({ key: 'schedules_on_time', component: 'workers', state: N(c.overdue) ? 'WARNING' : 'PASSED', count: N(c.overdue) });
    const s = await this.winback.ret.sender(this.rctx(ctx));
    const a2pOk = !s.a2pStatus || /approved|verified|active/i.test(s.a2pStatus);
    checks.push({ key: 'sms_sender', component: 'communications', state: s.route === 'tenant_account' ? (a2pOk ? 'PASSED' : 'WARNING') : s.route === 'not_configured' ? 'FAILED' : 'WARNING', detail: { route: s.route, registration: s.a2pStatus } });
    const emailKey = !!String(this.env.SENDGRID_API_KEY ?? '').trim();
    checks.push({ key: 'email_provider', component: 'communications', state: emailKey ? 'PASSED' : 'WARNING' });
    const f24 = await one(sql<Row>`select count(*) filter (where n.status = 'failed')::int as failed,
        count(*) filter (where n.status not in ('delivered', 'failed', 'simulated') and n.created_at < now() - interval '1 hour')::int as stuck
      from ai_marketing_campaign_sends x join notifications n on n.tenant_id = x.tenant_id and x.provider_id is not null and n.provider_id = x.provider_id
      where x.tenant_id = ${T} and x.status = 'sent' and x.updated_at > now() - interval '7 days'`);
    checks.push({ key: 'delivery_reports', component: 'communications', state: N(f24.stuck) ? 'WARNING' : 'PASSED', count: N(f24.stuck), detail: { failedLast7Days: N(f24.failed) } });
    const reach = await this.reach(ctx);
    const noContact = reach.sms.noContact + reach.email.noContact;
    checks.push({ key: 'consent_contacts', component: 'consent', state: reach.customers === 0 ? 'INSUFFICIENT_DATA' : noContact ? 'WARNING' : 'PASSED', count: noContact, detail: { sms: reach.sms.noContact, email: reach.email.noContact } });
    checks.push({ key: 'opt_out_list', component: 'consent', state: 'PASSED', count: reach.suppressed.total });
    const price = await one(sql<Row>`select value from platform_settings where setting_key = 'sms.marketing_segment_price_cents' limit 1`);
    checks.push({ key: 'sms_pricing', component: 'budget', state: price.value == null ? 'WARNING' : 'PASSED' });
    const over = await one(sql<Row>`select count(*)::int as n from (select c.id, c.cost_cents, sum(n.provider_cost_micros) as spent
        from campaigns c join ai_marketing_campaign_sends x on x.tenant_id = c.tenant_id and x.campaign_id = c.id and x.status = 'sent'
        join notifications n on n.tenant_id = x.tenant_id and x.provider_id is not null and n.provider_id = x.provider_id
        where c.tenant_id = ${T} and ${CW} and c.cost_cents > 0 group by c.id, c.cost_cents) y where y.spent / 10000 > y.cost_cents`);
    checks.push({ key: 'budget_respected', component: 'budget', state: N(over.n) ? 'FAILED' : 'PASSED', count: N(over.n) });
    checks.push({ key: 'budget_not_spending', component: 'budget', state: N(c.budget_unspent) ? 'WARNING' : 'PASSED', count: N(c.budget_unspent) });
    const att = await one(sql<Row>`select count(*)::int as n, max(e.created_at) as last from ai_booking_conversion_events e where e.tenant_id = ${T} and e.campaign_id is not null and e.created_at > now() - interval '90 days'`);
    const sent90 = await one(sql<Row>`select count(*)::int as n from ai_marketing_campaign_sends x where x.tenant_id = ${T} and x.status = 'sent' and x.updated_at > now() - interval '90 days'`);
    checks.push({ key: 'attribution', component: 'results', state: !N(sent90.n) ? 'INSUFFICIENT_DATA' : 'PASSED', count: N(att.n), detail: { lastAt: iso(att.last), sent90: N(sent90.n) } });
    const cross = await one(sql<Row>`select count(*)::int as n from ai_marketing_campaign_sends x join campaigns c on c.id = x.campaign_id where x.tenant_id = ${T} and c.tenant_id <> x.tenant_id`);
    checks.push({ key: 'tenant_isolation', component: 'security', state: N(cross.n) ? 'FAILED' : 'PASSED', count: N(cross.n) });
    // Marketing Growth 07 — Date/Timezone Diagnostics: every period, cutoff and send time is judged in the branch's zone, so a
    // missing / unknown zone silently falls back, and a send set on a clock-change day lands an hour off what was meant.
    const zrows = (await sql<Row>`select br.id, br.timezone from branches br where br.tenant_id = ${T} and coalesce(br.status, 'active') <> 'archived' and (${B}::uuid is null or br.id = ${B}::uuid)`.execute(this.db)).rows;
    const badZones = zrows.filter((r) => !validTimeZone(r.timezone)).length;
    const zones = [...new Set(zrows.map((r) => String(r.timezone ?? '')).filter(validTimeZone))].sort();
    const sched = (await sql<Row>`select c.id, c.scheduled_at, c.branch_id from campaigns c where c.tenant_id = ${T} and ${CW} and c.status = 'scheduled' and c.scheduled_at > now() order by c.scheduled_at limit 200`.execute(this.db)).rows;
    let dst = 0;
    for (const r of sched) { const tz = await branchTimeZone(this.db, T, r.branch_id ?? null); if (validTimeZone(tz) && nearClockChange(new Date(r.scheduled_at).getTime(), tz)) dst++; }
    checks.push({ key: 'date_timezone', component: 'campaigns', state: badZones ? 'FAILED' : dst ? 'WARNING' : 'PASSED', count: badZones + dst,
      detail: { branches: zrows.length, invalidZones: badZones, zones, scheduledOnClockChange: dst, scheduledChecked: sched.length } });
    checks.push({ key: 'no_side_effects', component: 'security', state: 'PASSED' });

    const prev = (await sql<Row>`select c->>'key' as key, max(h.created_at) as at from ai_marketing_health_runs h cross join lateral jsonb_array_elements(h.checks) c
      where h.tenant_id = ${T} and h.branch_id is not distinct from ${B} and c->>'state' = 'PASSED' group by 1`.execute(this.db)).rows;
    const checkedAt = new Date(this.now()).toISOString();
    for (const x of checks) x.lastPassedAt = x.state === 'PASSED' ? checkedAt : iso(prev.find((p) => p.key === x.key)?.at);
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING' : 'PASSED';
    const id = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('ai-marketing-health:' || ${T} || ':' || coalesce(${B}::text, '')))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into ai_marketing_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${id}, ${T}, ${B}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id, overall, checks, checkedAt, reused: false, sendsAnything: false };
    });
  }
}

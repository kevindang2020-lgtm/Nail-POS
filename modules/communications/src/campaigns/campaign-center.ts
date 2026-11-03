// campaign-center.ts — Marketing → Campaign Center (/tenant/marketing/campaigns, also /marketing/sms and /marketing/email),
// "Campaign Center Complete Build Guide" (30 Oct 2026). It adds what the guide asks for ON TOP OF the existing engine — no
// second campaign, audience, message or delivery system:
//   campaigns (the row + its CAMPAIGN machine)          → existing; this file adds goal / message / approval / snapshot facts (739)
//   campaign_recipients (audience snapshot, 739)        → copied from a Customer Segments audience draft (segment_audience_members)
//   ai_marketing_campaign_plans (321)                   → written on APPROVAL: the send sweep only sends a campaign that has a plan
//   ai_marketing_campaign_sends (320)                   → the per-recipient send ledger the executor writes (read-only here)
//   notifications (provider_id, status, cost)           → provider acceptance / delivery / failure / simulated (read-only here)
//   ai_booking_conversion_events (campaign_id)          → bookings attributed to a campaign link (read-only here)
//   deal_coupon_batches.campaign_id → deal_redemptions  → discounts actually redeemed with a campaign's codes (read-only here)
//
// Root cause of "spring into glow — audience 50 / sent 0 / Completed" (guide §03): the old New Campaign form took a HAND-TYPED
// audience size; Activate / Complete were bare status moves; the send sweep only sends campaigns that have a plan, and the
// POS never wrote one; nothing ever wrote campaigns.sent_count; and the Growth Funnel summed audience_size as "Audience
// Reached". The row is left exactly as it is. This read model reports every count from its own source: Selected (snapshot
// rows, or the legacy estimate flagged as an estimate), Eligible, Queued, Attempted, Submitted, Delivered, Failed, Unknown,
// Booked — and an explicit outcome ("Completed — no messages were sent: no send record exists") instead of "50 reached".
//
// Sending rules kept here: nothing in this file sends. Preview never sends. Approve stores the exact content hash and the plan.
// Launch only moves an APPROVED, unchanged campaign with ≥ 1 eligible snapshot recipient to 'scheduled' (through the machine,
// after the platform limits pre-check); the existing sweep + executor then send through the existing notifications path,
// re-checking consent / opt-out / limits / quiet hours per recipient at send time, idempotent per (campaign, customer,
// channel, message version). An edit after approval voids the approval (hash mismatch).
import { createHash, randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { HttpException, HttpStatus } from '@nestjs/common';
import { estimateSmsSegments, withCode, LARGE_CAMPAIGN_RECIPIENTS, type ApiErrorCode } from '@aipowersalon/api-contracts';
import { tenantTimeZone, canMoveToSql } from '@aipowersalon/database';
import { hasPermission } from '@aipowersalon/permissions';
import { recordAuditStrict } from '@aipowersalon/audit';
import { CAMPAIGN } from '../communications-lifecycles';
import type { CampaignsContext } from './campaigns.repository';

type PermCtx = Parameters<typeof hasPermission>[0];
/** the session context as the permission check reads it (role + permissions come from the guard-built req.ctx) */
const can = (ctx: CampaignsContext, perm: string) => hasPermission(ctx as unknown as PermCtx, perm);

const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const like = (raw: string) => '%' + raw.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
export const maskPhone = (p: string | null | undefined) => { if (!p) return null; const d = String(p).replace(/\D/g, ''); return d.length >= 4 ? `••• ${d.slice(-4)}` : '•••'; };
export const maskEmail = (e: string | null | undefined) => { if (!e) return null; const [u, d] = String(e).split('@'); return d ? `${(u || '').slice(0, 1)}•••@${d}` : '•••'; };
function paging(page: unknown, pageSize: unknown, def = 10) { const ps = Math.trunc(Number(pageSize)) || def; return { page: Math.max(1, Math.trunc(Number(page)) || 1), pageSize: [10, 20, 50].includes(ps) ? ps : Math.max(1, Math.min(50, ps)) }; }
function served(page: number, pageSize: number, total: number) { const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages); return { page: p, totalPages, offset: (p - 1) * pageSize }; }

export const CC_STATUSES = ['draft', 'awaiting_approval', 'approved', 'scheduled', 'sending', 'completed', 'cancelled'] as const;
export const CC_CHANNELS = ['sms', 'email', 'push'] as const;
export const CC_DATE_BASES = ['created', 'scheduled', 'started', 'completed'] as const;
export const CC_SORTS = ['newest', 'oldest', 'name', 'scheduled'] as const;
export const CC_RECIPIENT_STATUSES = ['all', 'eligible', 'excluded', 'queued', 'submitted', 'delivered', 'failed', 'skipped', 'unknown'] as const;
export const CC_ASSISTANT_GOALS = ['inactive', 'slow_weekdays', 'new_service', 'repeat_visits'] as const;
export const CC_SEARCH_SCOPES = ['campaigns', 'recipients'] as const;
/** the variables a message may carry; resolved ONCE at compose time (no per-recipient personalization exists in the sender) */
export const CC_VARIABLES = ['{salon_name}', '{offer}'] as const;   // no booking-link generator exists, so no {booking_link}

export interface CcPeriod { preset: string; from: string | null; to: string | null; tz: string; today: string }
export class CampaignCenterError extends Error {
  code: string; status: number; extra: Record<string, unknown>;
  constructor(msg: string, code: string, status = 400, extra: Record<string, unknown> = {}) { super(msg); this.name = 'CampaignCenterError'; this.code = code; this.status = status; this.extra = extra; }
}
const err = (msg: string, code: string, status = 400, extra: Record<string, unknown> = {}) => withCode(new CampaignCenterError(msg, code, status, extra), code as ApiErrorCode);

/** what an approval is bound to — any change voids it (guide §14) */
export function campaignContentHash(c: { channel: string; message_body: string | null; email_subject: string | null; deal_id: string | null; snapshot_version: number; branch_id: string | null }): string {
  return createHash('sha256').update(JSON.stringify([c.channel, c.message_body ?? '', c.email_subject ?? '', c.deal_id ?? '', N(c.snapshot_version), c.branch_id ?? ''])).digest('hex');
}

/** One verdict for "may this campaign move toward sending?" — used by Launch here AND by the existing schedule / activate
 *  routes (CampaignsService through the repository), so no path can send an unapproved or audience-less campaign. */
export async function campaignSendReadiness(db: Kysely<any>, tenantId: string, id: string): Promise<{ ok: true; eligible: number } | { ok: false; code: string; message: string }> {
  const c = (await sql<any>`select id, status, channel, message_body, email_subject, deal_id, snapshot_version, branch_id, audience_source, approved_at, approved_content_hash
      from campaigns where tenant_id = ${tenantId} and id = ${id}`.execute(db)).rows[0];
  if (!c) return { ok: false, code: 'CAMPAIGN_NOT_FOUND', message: 'Campaign not found.' };
  if (c.channel === 'push') return { ok: false, code: 'CAMPAIGN_CHANNEL_UNSUPPORTED', message: 'Push campaigns cannot be sent from Campaign Center yet.' };
  if (c.audience_source !== 'segment_snapshot' || N(c.snapshot_version) < 1) return { ok: false, code: 'CAMPAIGN_AUDIENCE_NOT_SELECTED', message: 'Choose an audience first. The old "audience size" number is only an estimate — nobody can be messaged from it.' };
  if (!c.message_body || !String(c.message_body).trim()) return { ok: false, code: 'CAMPAIGN_MESSAGE_REQUIRED', message: 'Write the message first.' };
  if (!c.approved_at || !c.approved_content_hash) return { ok: false, code: 'CAMPAIGN_APPROVAL_REQUIRED', message: 'An owner or manager must approve this campaign before it can be sent.' };
  if (c.approved_content_hash !== campaignContentHash(c)) return { ok: false, code: 'CAMPAIGN_APPROVAL_STALE', message: 'The campaign changed after it was approved. It needs to be approved again.' };
  const e = (await sql<any>`select count(*)::int as n from campaign_recipients where tenant_id = ${tenantId} and campaign_id = ${id} and snapshot_version = ${N(c.snapshot_version)} and eligibility = 'eligible'`.execute(db)).rows[0];
  if (N(e?.n) === 0) return { ok: false, code: 'CAMPAIGN_NO_ELIGIBLE_RECIPIENTS', message: 'Nobody in this audience can receive the message (consent, opt-outs or missing contact details). Nothing would be sent.' };
  return { ok: true, eligible: N(e.n) };
}

/** the per-campaign counts, each from its own source (guide §03 "do not reuse one count under different labels") */
function countsCte(T: string) {
  return sql`
    snap as (select cr0.campaign_id, count(*)::int as selected, count(*) filter (where cr0.eligibility = 'eligible')::int as eligible
             from campaign_recipients cr0 join campaigns c0 on c0.id = cr0.campaign_id and c0.tenant_id = cr0.tenant_id and cr0.snapshot_version = c0.snapshot_version
             where cr0.tenant_id = ${T} group by cr0.campaign_id),
    led as (select s.campaign_id, count(*)::int as ledger_rows,
             count(*) filter (where s.status = 'queued')::int as queued,
             count(*) filter (where s.status in ('sent', 'failed'))::int as attempted,
             count(*) filter (where s.status = 'sent')::int as submitted,
             count(*) filter (where s.status in ('skipped', 'blocked'))::int as skipped_at_send,
             count(*) filter (where s.status = 'failed')::int as failed_send,
             count(*) filter (where s.status = 'sent' and n.status = 'delivered')::int as delivered,
             count(*) filter (where s.status = 'sent' and n.status = 'failed')::int as failed_delivery,
             count(*) filter (where s.status = 'sent' and n.status = 'simulated')::int as simulated,
             coalesce(sum(n.provider_cost_micros) filter (where s.status = 'sent'), 0)::bigint as cost_micros,
             count(*) filter (where s.status = 'sent' and n.provider_cost_micros is not null)::int as costed
            from ai_marketing_campaign_sends s
            left join notifications n on n.tenant_id = s.tenant_id and s.provider_id is not null and n.provider_id = s.provider_id
            where s.tenant_id = ${T} group by s.campaign_id),
    conv as (select campaign_id, count(*)::int as booked from ai_booking_conversion_events
             where tenant_id = ${T} and campaign_id is not null and stage = 'BOOKING_SUCCEEDED' and (outcome = 'succeeded' or outcome is null) group by campaign_id),
    red as (select b.campaign_id, count(distinct dr.id)::int as redemptions, coalesce(sum(dr.amount_discounted_cents - coalesce(dr.reversed_cents, 0)), 0)::bigint as discount_cents,
              coalesce(sum(paid_t.total), 0)::bigint as revenue_cents
            from deal_coupon_batches b
            join deal_coupon_codes k on k.batch_id = b.id and k.tenant_id = b.tenant_id
            join deal_redemptions dr on dr.coupon_code_id = k.id and dr.tenant_id = b.tenant_id and dr.status in ('redeemed', 'partially_reversed')
            left join lateral (select t.total_cents::bigint as total from tickets t where t.id = dr.ticket_id and t.tenant_id = dr.tenant_id and t.status in ('paid', 'closed')) paid_t on true
            where b.tenant_id = ${T} and b.campaign_id is not null group by b.campaign_id)`;
}

export interface CampaignCounts {
  selected: number | null; selectedIsEstimate: boolean; eligible: number | null; excluded: number | null;
  queued: number; attempted: number; submitted: number; skippedAtSend: number; failed: number; delivered: number; unknown: number; simulated: number;
  booked: number; redemptions: number; discountCents: number; associatedRevenueCents: number; legacyRevenueCents: number; legacySentCount: number;
  actualCostCents: number | null; roi: number | null; roiNote: string;
}
export function countsOf(r: any): CampaignCounts {
  const snapshot = r.audience_source === 'segment_snapshot' && N(r.snapshot_version) > 0;
  const selected = snapshot ? N(r.selected) : (N(r.audience_size) > 0 ? N(r.audience_size) : null);
  const eligible = snapshot ? N(r.eligible) : null;
  const submitted = N(r.submitted), delivered = N(r.delivered), failedDelivery = N(r.failed_delivery), simulated = N(r.simulated);
  const costed = N(r.costed);
  const actualCostCents = submitted > 0 && costed === submitted ? Math.round(N(r.cost_micros) / 10_000) : null;
  const revenue = N(r.revenue_cents);
  const roi = actualCostCents && actualCostCents > 0 ? Math.round(((revenue - actualCostCents) / actualCostCents) * 10) / 10 : null;
  return {
    selected, selectedIsEstimate: !snapshot && selected != null, eligible, excluded: snapshot ? N(r.selected) - N(r.eligible) : null,
    queued: N(r.queued), attempted: N(r.attempted), submitted, skippedAtSend: N(r.skipped_at_send), failed: N(r.failed_send) + failedDelivery,
    delivered, unknown: Math.max(0, submitted - delivered - failedDelivery - simulated), simulated,
    booked: N(r.booked), redemptions: N(r.redemptions), discountCents: N(r.discount_cents), associatedRevenueCents: revenue,
    legacyRevenueCents: N(r.legacy_revenue), legacySentCount: N(r.sent_count), actualCostCents, roi,
    roiNote: roi != null ? 'ROI = (revenue on tickets that redeemed this campaign\'s codes − provider cost) / provider cost.'
      : submitted === 0 ? 'Not available: nothing was sent, so there is no cost.' : 'Not available: the provider has not reported the cost of every message.',
  };
}

/** what the screen shows as the campaign's state — the machine status plus the approval facts and the honest outcome */
export function displayStatus(r: any, c: CampaignCounts): { key: string; outcome: string | null } {
  const st = String(r.status);
  if (st === 'draft') {
    const approvedNow = !!r.approved_at && r.approved_content_hash && r.approved_content_hash === r.content_hash;
    return { key: approvedNow ? 'approved' : r.submitted_at && !r.approved_at ? 'awaiting_approval' : 'draft', outcome: r.approved_at && !approvedNow ? 'approval_voided_by_edit' : null };
  }
  if (st === 'in_progress') return { key: 'sending', outcome: N(r.ledger_rows) === 0 ? 'started_no_send_record' : null };
  if (st === 'completed') {
    if (N(r.ledger_rows) === 0) return { key: 'completed', outcome: N(r.sent_count) > 0 ? 'completed_legacy_counts_only' : 'completed_no_send_record' };
    if (c.submitted === 0) return { key: 'completed', outcome: 'completed_zero_sent' };
    return { key: 'completed', outcome: c.unknown > 0 ? 'completed_delivery_pending' : null };
  }
  return { key: st, outcome: null };
}

export class CampaignCenter {
  private readonly db: Kysely<any>;
  private readonly limitsPreflight?: (ctx: CampaignsContext, id: string) => Promise<void>;
  constructor(db: Kysely<any>, limitsPreflight?: (ctx: CampaignsContext, id: string) => Promise<void>) { this.db = db; this.limitsPreflight = limitsPreflight; }

  private need(ctx: CampaignsContext, perm: 'pos.marketing.view' | 'pos.marketing.manage') {
    if (!ctx?.tenantId || !ctx?.userId) throw err('Not signed in.', 'PERMISSION_DENIED', 403);
    if (!can(ctx, perm)) throw err('You do not have permission to do this.', 'PERMISSION_DENIED', 403);
  }
  /** a branch user sees salon-wide campaigns and their own branch's (alias c) */
  private branchW(ctx: CampaignsContext) { return ctx.branchId && UUID.test(ctx.branchId) ? sql`(c.branch_id = ${ctx.branchId} or c.branch_id is null)` : sql`true`; }
  private actorId(ctx: CampaignsContext) { return ctx.userId && UUID.test(ctx.userId) ? ctx.userId : null; }

  async period(ctx: CampaignsContext, q: { preset?: unknown; from?: unknown; to?: unknown }, def = 'all'): Promise<CcPeriod> {
    const tz = await tenantTimeZone(this.db, ctx.tenantId);
    const r = (await sql<any>`select to_char((now() at time zone ${tz})::date, 'YYYY-MM-DD') as today, to_char(date_trunc('week', now() at time zone ${tz})::date, 'YYYY-MM-DD') as wk,
        to_char(date_trunc('month', now() at time zone ${tz})::date, 'YYYY-MM-DD') as mo, to_char(date_trunc('year', now() at time zone ${tz})::date, 'YYYY-MM-DD') as yr`.execute(this.db)).rows[0];
    const preset = ['today', 'week', 'month', 'year', 'custom', 'all'].includes(String(q.preset ?? '')) ? String(q.preset) : def;
    if (preset === 'all') return { preset, from: null, to: null, tz, today: r.today };
    if (preset === 'custom') {
      const from = YMD.test(String(q.from)) ? String(q.from) : null; const to = YMD.test(String(q.to)) ? String(q.to) : from;
      if (!from || !to || to < from) throw err('The start date must be on or before the end date.', 'DATE_RANGE_INVALID');
      return { preset, from, to, tz, today: r.today };
    }
    return { preset, from: preset === 'today' ? r.today : preset === 'week' ? r.wk : preset === 'month' ? r.mo : r.yr, to: r.today, tz, today: r.today };
  }
  /** `col` within the salon-local inclusive days [from 00:00, to + 1 day 00:00), each bound on its own date (DST-safe) */
  private inP(col: any, p: CcPeriod) {
    if (!p.from || !p.to) return sql`true`;
    return sql`(${col} >= (${p.from}::date)::timestamp at time zone ${p.tz} and ${col} < ((${p.to}::date + 1))::timestamp at time zone ${p.tz})`;
  }
  private basisCol(b: string) { return b === 'scheduled' ? sql`c.scheduled_at` : b === 'started' ? sql`c.started_at` : b === 'completed' ? sql`c.completed_at` : sql`c.created_at`; }

  private async rows(ctx: CampaignsContext, where: any, order: any, limit: number, offset: number) {
    const T = ctx.tenantId;
    return (await sql<any>`with ${countsCte(T)}
      select c.id, c.tenant_id, c.branch_id, c.name, c.offer, c.channel, c.audience_label, c.audience_size, c.status, c.scheduled_at, c.sent_count, c.revenue_cents, c.cost_cents, c.created_by, c.created_at, c.updated_at, c.started_at, c.goal, c.description, c.deal_id, c.message_body, c.email_subject, c.message_version, c.audience_source, c.audience_draft_id, c.snapshot_version, c.content_hash, c.origin, c.submitted_by_user_id, c.submitted_at, c.approved_by_user_id, c.approved_at, c.approved_content_hash, c.completed_at, c.revenue_cents as legacy_revenue, coalesce(snap.selected, 0) as selected, coalesce(snap.eligible, 0) as eligible,
        coalesce(led.ledger_rows, 0) as ledger_rows, coalesce(led.queued, 0) as queued, coalesce(led.attempted, 0) as attempted, coalesce(led.submitted, 0) as submitted,
        coalesce(led.skipped_at_send, 0) as skipped_at_send, coalesce(led.failed_send, 0) as failed_send, coalesce(led.delivered, 0) as delivered,
        coalesce(led.failed_delivery, 0) as failed_delivery, coalesce(led.simulated, 0) as simulated, coalesce(led.cost_micros, 0) as cost_micros, coalesce(led.costed, 0) as costed,
        coalesce(conv.booked, 0) as booked, coalesce(red.redemptions, 0) as redemptions, coalesce(red.discount_cents, 0) as discount_cents, coalesce(red.revenue_cents, 0) as revenue_cents,
        d.title as deal_name, u.full_name as creator_name, a.full_name as approver_name
      from campaigns c
      left join snap on snap.campaign_id = c.id left join led on led.campaign_id = c.id left join conv on conv.campaign_id = c.id left join red on red.campaign_id = c.id
      left join deals d on d.id = c.deal_id and d.tenant_id = c.tenant_id
      left join users u on u.id = c.created_by and u.tenant_id = c.tenant_id
      left join users a on a.id = c.approved_by_user_id and a.tenant_id = c.tenant_id
      where c.tenant_id = ${T} and ${this.branchW(ctx)} and ${where}
      order by ${order} limit ${limit} offset ${offset}`.execute(this.db)).rows;
  }
  private view(r: any) {
    const counts = countsOf(r); const ds = displayStatus(r, counts);
    return {
      id: String(r.id), name: r.name, goal: r.goal ?? null, description: r.description ?? null, offer: r.offer ?? null, channel: r.channel, branchId: r.branch_id ?? null,
      status: r.status, displayStatus: ds.key, outcome: ds.outcome, origin: r.origin ?? 'manual',
      audienceLabel: r.audience_label ?? null, audienceSource: r.audience_source ?? 'manual_estimate', snapshotVersion: N(r.snapshot_version),
      dealId: r.deal_id ?? null, dealName: r.deal_name ?? null, messageBody: r.message_body ?? null, emailSubject: r.email_subject ?? null, messageVersion: N(r.message_version) || 1,
      budgetCents: N(r.cost_cents), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), scheduledAt: iso(r.scheduled_at), startedAt: iso(r.started_at), completedAt: iso(r.completed_at),
      createdBy: r.creator_name ?? null, submittedAt: iso(r.submitted_at), approvedAt: iso(r.approved_at), approvedBy: r.approver_name ?? null,
      approvalCurrent: !!r.approved_at && !!r.approved_content_hash && r.approved_content_hash === r.content_hash,
      counts,
    };
  }

  // ── §05 / §06 / §07 campaign library ────────────────────────────────────────────────────────────────────────────
  async list(ctx: CampaignsContext, q: Record<string, any>) {
    this.need(ctx, 'pos.marketing.view');
    const per = await this.period(ctx, q);
    const basis = (CC_DATE_BASES as readonly string[]).includes(q.basis) ? q.basis : 'created';
    const { page, pageSize } = paging(q.page, q.pageSize, 10);
    const conds: any[] = [this.inP(this.basisCol(basis), per)];
    if ((CC_CHANNELS as readonly string[]).includes(q.channel)) conds.push(sql`c.channel = ${q.channel}`);
    if (q.branchId && UUID.test(q.branchId)) conds.push(sql`c.branch_id = ${q.branchId}`);
    const st = String(q.status ?? '');
    if (st === 'draft') conds.push(sql`c.status = 'draft' and c.submitted_at is null and c.approved_at is null`);
    else if (st === 'awaiting_approval') conds.push(sql`c.status = 'draft' and c.submitted_at is not null and c.approved_at is null`);
    else if (st === 'approved') conds.push(sql`c.status = 'draft' and c.approved_at is not null`);
    else if (st === 'sending') conds.push(sql`c.status = 'in_progress'`);
    else if (['scheduled', 'completed', 'cancelled'].includes(st)) conds.push(sql`c.status = ${st}`);
    const text = String(q.q ?? '').trim().slice(0, 100);
    if (text) {
      const p = like(text);
      conds.push(UUID.test(text) ? sql`(c.id = ${text}::uuid or c.deal_id = ${text}::uuid)`
        : sql`(c.name ilike ${p} or c.offer ilike ${p} or c.goal ilike ${p} or c.audience_label ilike ${p} or c.id::text ilike ${p}
              or exists (select 1 from deals d2 where d2.id = c.deal_id and d2.tenant_id = c.tenant_id and d2.title ilike ${p})
              or exists (select 1 from users u2 where u2.id = c.created_by and u2.tenant_id = c.tenant_id and u2.full_name ilike ${p}))`);
    }
    const where = conds.reduce((a, x) => sql`${a} and ${x}`, sql`true`);
    const total = N((await sql<any>`select count(*)::int as n from campaigns c where c.tenant_id = ${ctx.tenantId} and ${this.branchW(ctx)} and ${where}`.execute(this.db)).rows[0]?.n);
    const sv = served(page, pageSize, total);
    const sort = String(q.sort ?? 'newest');
    const order = sort === 'oldest' ? sql`c.created_at asc, c.id asc` : sort === 'name' ? sql`lower(c.name) asc, c.id desc` : sort === 'scheduled' ? sql`c.scheduled_at desc nulls last, c.id desc` : sql`c.created_at desc, c.id desc`;
    const rows = await this.rows(ctx, where, order, pageSize, sv.offset);
    return { items: rows.map((r) => this.view(r)), pagination: { page: sv.page, pageSize, totalItems: total, totalPages: sv.totalPages }, period: per, basis, sort };
  }

  // ── §02 KPI cards + §11 funnel / channel mix / revenue by campaign (each stage from its own source) ─────────────────
  async overview(ctx: CampaignsContext, q: Record<string, any>) {
    this.need(ctx, 'pos.marketing.view');
    const per = await this.period(ctx, q);
    const basis = (CC_DATE_BASES as readonly string[]).includes(q.basis) ? q.basis : 'created';
    const chan = (CC_CHANNELS as readonly string[]).includes(q.channel) ? sql`c.channel = ${q.channel}` : sql`true`;
    const rows = (await this.rows(ctx, sql`${this.inP(this.basisCol(basis), per)} and ${chan}`, sql`c.created_at desc, c.id desc`, 5000, 0)).map((r) => this.view(r));
    const sum = (f: (c: CampaignCounts) => number | null) => rows.reduce((a, r) => a + (f(r.counts) ?? 0), 0);
    const snapshotRows = rows.filter((r) => !r.counts.selectedIsEstimate && r.counts.selected != null);
    const costKnown = rows.filter((r) => r.counts.submitted > 0).every((r) => r.counts.actualCostCents != null) && rows.some((r) => r.counts.submitted > 0);
    const totalCost = costKnown ? sum((c) => c.actualCostCents) : null;
    const revenue = sum((c) => c.associatedRevenueCents);
    const engagementTracked = false;   // SMS has no open event; email open / click webhooks are not ingested per campaign
    const byChannel = new Map<string, { revenueCents: number; submitted: number; campaigns: number }>();
    for (const r of rows) { const e = byChannel.get(r.channel) ?? { revenueCents: 0, submitted: 0, campaigns: 0 }; e.revenueCents += r.counts.associatedRevenueCents; e.submitted += r.counts.submitted; e.campaigns += 1; byChannel.set(r.channel, e); }
    return {
      period: per, basis,
      kpis: {
        campaignRevenueCents: revenue,
        activeCampaigns: rows.filter((r) => r.status === 'scheduled' || r.status === 'in_progress').length,
        totalSent: sum((c) => c.submitted),
        avgRoi: totalCost && totalCost > 0 ? Math.round(((revenue - totalCost) / totalCost) * 10) / 10 : null,
        avgRoiNote: totalCost && totalCost > 0 ? 'Revenue on tickets that redeemed campaign codes, against provider cost.' : 'Not available: no provider cost has been recorded for the messages in this view.',
        avgOpenRate: null as number | null,
        avgOpenRateNote: 'Not tracked: text messages have no "open" event, and email opens are not recorded per campaign.',
        totalBookings: sum((c) => c.booked),
        totalCampaigns: rows.length,
        legacyEstimateCampaigns: rows.filter((r) => r.counts.selectedIsEstimate).length,
      },
      funnel: [
        { key: 'selected', value: snapshotRows.reduce((a, r) => a + (r.counts.selected ?? 0), 0), note: 'Customers chosen from a saved audience. Hand-typed estimates are not included.' },
        { key: 'eligible', value: snapshotRows.reduce((a, r) => a + (r.counts.eligible ?? 0), 0), note: 'Chosen customers with consent and a usable contact when the audience was saved.' },
        { key: 'attempted', value: sum((c) => c.attempted + c.queued), note: 'Send records the worker created (queued or tried).' },
        { key: 'submitted', value: sum((c) => c.submitted), note: 'Accepted by the provider (or the test sender).' },
        { key: 'delivered', value: sum((c) => c.delivered), note: 'Delivery confirmed by the provider.' },
        { key: 'engaged', value: null, note: 'Not tracked yet for campaigns.' },
        { key: 'booked', value: sum((c) => c.booked), note: 'Bookings made through a campaign link.' },
        { key: 'completed_paid', value: sum((c) => c.redemptions), note: 'Paid tickets that redeemed one of the campaign\'s codes.' },
      ],
      legacyEstimateTotal: rows.filter((r) => r.counts.selectedIsEstimate).reduce((a, r) => a + (r.counts.selected ?? 0), 0),
      engagementTracked,
      channelMix: [...byChannel.entries()].map(([channel, v]) => ({ channel, ...v })),
      revenueByCampaign: rows.filter((r) => r.counts.associatedRevenueCents > 0).sort((a, b) => b.counts.associatedRevenueCents - a.counts.associatedRevenueCents).slice(0, 6)
        .map((r) => ({ id: r.id, name: r.name, revenueCents: r.counts.associatedRevenueCents })),
      attributionNote: 'Revenue counts only paid tickets that redeemed a code issued for the campaign (refunded / voided tickets excluded). It is associated, not proven incremental.',
      generatedAt: new Date().toISOString(),
    };
  }

  // ── §05 recipient / delivery-history search (only real campaign-recipient records) ──────────────────────────────────
  async searchRecipients(ctx: CampaignsContext, q: Record<string, any>) {
    this.need(ctx, 'pos.marketing.view');
    const { page, pageSize } = paging(q.page, q.pageSize, 10);
    const text = String(q.q ?? '').trim().slice(0, 100);
    const per = await this.period(ctx, q);
    const conds: any[] = [this.inP(sql`x.at`, per)];
    if (q.campaignId && UUID.test(q.campaignId)) conds.push(sql`x.campaign_id = ${q.campaignId}`);
    if (text) {
      const digits = text.replace(/\D/g, '');
      const p = like(text);
      conds.push(UUID.test(text) ? sql`(x.customer_id = ${text}::uuid or x.send_id = ${text}::uuid or x.campaign_id = ${text}::uuid)`
        : sql`(cu.full_name ilike ${p} or cu.first_name ilike ${p} or cu.last_name ilike ${p} or cu.email ilike ${p} or x.provider_id = ${text}
              ${digits.length >= 4 ? sql`or cu.normalized_phone like ${'%' + digits.slice(-10)}` : sql``})`);
    }
    const where = conds.reduce((a, x) => sql`${a} and ${x}`, sql`true`);
    const base = sql`(select s.id as send_id, s.campaign_id, s.customer_id, s.status as send_status, s.skip_reason, s.provider_id, s.created_at as at, s.channel
                      from ai_marketing_campaign_sends s where s.tenant_id = ${ctx.tenantId}
                      union all
                      select null::uuid, r.campaign_id, r.customer_id, null, r.eligibility, null, r.created_at, r.channel from campaign_recipients r
                      where r.tenant_id = ${ctx.tenantId} and not exists (select 1 from ai_marketing_campaign_sends s2 where s2.tenant_id = r.tenant_id and s2.campaign_id = r.campaign_id and s2.customer_id = r.customer_id)) x`;
    const from = sql`${base} join campaigns c on c.id = x.campaign_id and c.tenant_id = ${ctx.tenantId}
                     left join customers cu on cu.id = x.customer_id and cu.tenant_id = ${ctx.tenantId}
                     left join notifications n on n.tenant_id = ${ctx.tenantId} and x.provider_id is not null and n.provider_id = x.provider_id`;
    const total = N((await sql<any>`select count(*)::int as n from ${from} where ${this.branchW(ctx)} and ${where}`.execute(this.db)).rows[0]?.n);
    const sv = served(page, pageSize, total);
    const rows = (await sql<any>`select x.*, c.name as campaign_name, cu.full_name, cu.normalized_phone, cu.email, n.status as delivery_status, n.provider_error_code
        from ${from} where ${this.branchW(ctx)} and ${where} order by x.at desc, x.customer_id desc limit ${pageSize} offset ${sv.offset}`.execute(this.db)).rows;
    const canSee = can(ctx, 'pos.customers.view');
    return {
      items: rows.map((r) => ({ sendId: r.send_id ?? null, campaignId: String(r.campaign_id), campaignName: r.campaign_name, customerId: String(r.customer_id),
        customerName: canSee ? (r.full_name ?? null) : null, contact: r.channel === 'email' ? maskEmail(r.email) : maskPhone(r.normalized_phone),
        channel: r.channel, stage: r.send_status ? (r.send_status === 'sent' ? (r.delivery_status === 'delivered' ? 'delivered' : r.delivery_status === 'failed' ? 'failed' : r.delivery_status === 'simulated' ? 'simulated' : 'submitted') : r.send_status) : (r.skip_reason === 'eligible' ? 'selected' : 'excluded'),
        reason: r.skip_reason ?? null, providerErrorCode: r.provider_error_code ?? null, providerId: r.provider_id ? `${String(r.provider_id).slice(0, 6)}…` : null, at: iso(r.at) })),
      pagination: { page: sv.page, pageSize, totalItems: total, totalPages: sv.totalPages }, period: per,
    };
  }

  // ── §09 / §13 details overlay ────────────────────────────────────────────────────────────────────────────────────
  private async one(ctx: CampaignsContext, id: string) {
    if (!UUID.test(id)) throw err('Campaign not found.', 'CAMPAIGN_NOT_FOUND', 404);
    const r = (await this.rows(ctx, sql`c.id = ${id}`, sql`c.id`, 1, 0))[0];
    if (!r) throw err('Campaign not found.', 'CAMPAIGN_NOT_FOUND', 404);
    return r;
  }
  async detail(ctx: CampaignsContext, id: string) {
    this.need(ctx, 'pos.marketing.view');
    const r = await this.one(ctx, id); const v = this.view(r);
    const reasons = (await sql<any>`select eligibility as reason, count(*)::int as n from campaign_recipients where tenant_id = ${ctx.tenantId} and campaign_id = ${id} and snapshot_version = ${N(r.snapshot_version)} and eligibility <> 'eligible' group by eligibility order by n desc`.execute(this.db)).rows;
    const sendReasons = (await sql<any>`select coalesce(skip_reason, status) as reason, count(*)::int as n from ai_marketing_campaign_sends where tenant_id = ${ctx.tenantId} and campaign_id = ${id} and status in ('skipped', 'blocked', 'failed') group by 1 order by n desc`.execute(this.db)).rows;
    const providerErrors = (await sql<any>`select coalesce(n.provider_error_code, n.failure_reason, 'unknown') as code, count(*)::int as n from ai_marketing_campaign_sends s
        join notifications n on n.tenant_id = s.tenant_id and n.provider_id = s.provider_id where s.tenant_id = ${ctx.tenantId} and s.campaign_id = ${id} and n.status = 'failed' group by 1 order by n desc`.execute(this.db)).rows;
    const readiness = r.status === 'draft' ? await campaignSendReadiness(this.db, ctx.tenantId, id) : null;
    return {
      ...v, exclusionReasons: reasons.map((x) => ({ reason: x.reason, count: N(x.n) })), sendTimeReasons: sendReasons.map((x) => ({ reason: x.reason, count: N(x.n) })),
      providerErrors: providerErrors.map((x) => ({ code: x.code, count: N(x.n) })),
      readiness: readiness ? (readiness.ok ? { ok: true, eligible: readiness.eligible } : { ok: false, code: readiness.code, message: readiness.message }) : null,
      definitions: {
        selected: 'Customers in the saved audience snapshot. For older campaigns this is the hand-typed estimate and is marked as such.',
        eligible: 'Selected customers who had consent and a usable contact when the audience was saved.',
        queued: 'Send records waiting for the worker.', attempted: 'Send records the worker handed to the provider (accepted or failed).',
        submitted: 'Accepted by the provider, or by the test sender in a test environment (shown separately as simulated).',
        delivered: 'Delivery confirmed by the provider callback.', failed: 'Refused by the provider at send time or reported failed later.',
        unknown: 'Accepted but no delivery callback yet.', booked: 'Bookings made through a link carrying this campaign.',
      },
    };
  }
  async recipients(ctx: CampaignsContext, id: string, q: Record<string, any>) {
    this.need(ctx, 'pos.marketing.view');
    const r = await this.one(ctx, id);
    const { page, pageSize } = paging(q.page, q.pageSize, 10);
    const st = (CC_RECIPIENT_STATUSES as readonly string[]).includes(q.status) ? String(q.status) : 'all';
    const text = String(q.q ?? '').trim().slice(0, 100);
    const conds: any[] = [];
    if (st === 'eligible') conds.push(sql`cr.eligibility = 'eligible'`);
    else if (st === 'excluded') conds.push(sql`cr.eligibility <> 'eligible'`);
    else if (st === 'queued') conds.push(sql`s.status = 'queued'`);
    else if (st === 'submitted') conds.push(sql`s.status = 'sent'`);
    else if (st === 'delivered') conds.push(sql`s.status = 'sent' and n.status = 'delivered'`);
    else if (st === 'failed') conds.push(sql`(s.status = 'failed' or (s.status = 'sent' and n.status = 'failed'))`);
    else if (st === 'skipped') conds.push(sql`s.status in ('skipped', 'blocked')`);
    else if (st === 'unknown') conds.push(sql`s.status = 'sent' and coalesce(n.status, 'sent') = 'sent'`);
    if (text) {
      const p = like(text); const digits = text.replace(/\D/g, '');
      conds.push(UUID.test(text) ? sql`(cr.customer_id = ${text}::uuid or s.id = ${text}::uuid)`
        : sql`(cu.full_name ilike ${p} or cu.email ilike ${p} ${digits.length >= 4 ? sql`or cu.normalized_phone like ${'%' + digits.slice(-10)}` : sql``}
              or exists (select 1 from pos_tech_appointments ap where ap.tenant_id = ${ctx.tenantId} and ap.customer_id = cr.customer_id and ap.id::text = ${text}))`);
    }
    const where = conds.reduce((a, x) => sql`${a} and ${x}`, sql`true`);
    const from = sql`campaign_recipients cr
      left join ai_marketing_campaign_sends s on s.tenant_id = cr.tenant_id and s.campaign_id = cr.campaign_id and s.customer_id = cr.customer_id and s.message_version = ${N(r.message_version) || 1}
      left join notifications n on n.tenant_id = cr.tenant_id and s.provider_id is not null and n.provider_id = s.provider_id
      left join customers cu on cu.id = cr.customer_id and cu.tenant_id = cr.tenant_id
      where cr.tenant_id = ${ctx.tenantId} and cr.campaign_id = ${id} and cr.snapshot_version = ${N(r.snapshot_version)}`;
    const total = N((await sql<any>`select count(*)::int as n from ${from} and ${where}`.execute(this.db)).rows[0]?.n);
    const sv = served(page, pageSize, total);
    const rows = (await sql<any>`select cr.customer_id, cr.eligibility, cr.destination_masked, s.id as send_id, s.status as send_status, s.skip_reason, s.created_at as send_at, s.updated_at as send_updated,
        n.status as delivery_status, n.provider_error_code, n.delivered_at, cu.full_name, cu.marketing_sms_opt_in, cu.marketing_email_opt_in,
        (select count(*)::int from ai_booking_conversion_events e where e.tenant_id = cr.tenant_id and e.campaign_id = cr.campaign_id and e.stage = 'BOOKING_SUCCEEDED'
           and exists (select 1 from pos_tech_appointments ap where ap.id::text = e.appointment_id::text and ap.tenant_id = e.tenant_id and ap.customer_id = cr.customer_id)) as booked,
        (select count(*)::int from deal_redemptions dr join deal_coupon_codes k on k.id = dr.coupon_code_id join deal_coupon_batches b on b.id = k.batch_id
           where dr.tenant_id = cr.tenant_id and b.campaign_id = cr.campaign_id and dr.customer_id = cr.customer_id and dr.status in ('redeemed', 'partially_reversed')) as redeemed
      from ${from} and ${where} order by cu.full_name asc nulls last, cr.customer_id limit ${pageSize} offset ${sv.offset}`.execute(this.db)).rows;
    const canSee = can(ctx, 'pos.customers.view');
    return {
      items: rows.map((x) => ({
        customerId: String(x.customer_id), name: canSee ? (x.full_name ?? null) : null, contact: x.destination_masked ?? null,
        selection: x.eligibility === 'eligible' ? 'eligible' : 'excluded', exclusionReason: x.eligibility === 'eligible' ? null : x.eligibility,
        consentNow: r.channel === 'email' ? !!x.marketing_email_opt_in : !!x.marketing_sms_opt_in,
        sendStatus: x.send_status ?? null, sendReason: x.skip_reason ?? null, deliveryStatus: x.send_status === 'sent' ? (x.delivery_status ?? 'unknown') : null,
        providerErrorCode: x.provider_error_code ?? null, sentAt: iso(x.send_at), deliveredAt: iso(x.delivered_at), booked: N(x.booked), redeemed: N(x.redeemed),
      })),
      pagination: { page: sv.page, pageSize, totalItems: total, totalPages: sv.totalPages }, status: st,
      maskedBecause: canSee ? null : 'Names are hidden: your role cannot view customer profiles.',
    };
  }
  async events(ctx: CampaignsContext, id: string, q: Record<string, any>) {
    this.need(ctx, 'pos.marketing.view');
    await this.one(ctx, id);
    const { page, pageSize } = paging(q.page, q.pageSize, 10);
    const total = N((await sql<any>`select count(*)::int as n from ai_marketing_campaign_sends where tenant_id = ${ctx.tenantId} and campaign_id = ${id}`.execute(this.db)).rows[0]?.n);
    const sv = served(page, pageSize, total);
    const rows = (await sql<any>`select s.id, s.customer_id, s.status, s.skip_reason, s.created_at, s.updated_at, s.message_version, n.status as delivery_status, n.provider_status, n.provider_error_code, n.delivered_at
        from ai_marketing_campaign_sends s left join notifications n on n.tenant_id = s.tenant_id and s.provider_id is not null and n.provider_id = s.provider_id
        where s.tenant_id = ${ctx.tenantId} and s.campaign_id = ${id} order by s.updated_at desc, s.id desc limit ${pageSize} offset ${sv.offset}`.execute(this.db)).rows;
    return { items: rows.map((x) => ({ id: String(x.id), customerId: String(x.customer_id), status: x.status, reason: x.skip_reason ?? null, messageVersion: N(x.message_version),
      deliveryStatus: x.delivery_status ?? null, providerStatus: x.provider_status ?? null, providerErrorCode: x.provider_error_code ?? null,
      createdAt: iso(x.created_at), updatedAt: iso(x.updated_at), deliveredAt: iso(x.delivered_at) })), pagination: { page: sv.page, pageSize, totalItems: total, totalPages: sv.totalPages } };
  }
  async audit(ctx: CampaignsContext, id: string) {
    this.need(ctx, 'pos.marketing.view');
    await this.one(ctx, id);
    const rows = (await sql<any>`select e.occurred_at, e.action, e.summary, e.actor_role, u.full_name as actor_name, e.metadata from audit_events e left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id
        where e.tenant_id = ${ctx.tenantId} and e.resource_type = 'campaign' and e.resource_id = ${id} order by e.occurred_at desc, e.id desc limit 100`.execute(this.db)).rows;
    return { items: rows.map((x) => ({ at: iso(x.occurred_at), action: x.action, summary: x.summary ?? null, actor: x.actor_name ?? x.actor_role ?? 'system' })) };
  }

  // ── §08 wizard: create / edit / audience / preview / submit / approve / launch / unschedule ──────────────────────────
  private async loadRow(db: Kysely<any>, ctx: CampaignsContext, id: string, lock = false) {
    if (!UUID.test(id)) throw err('Campaign not found.', 'CAMPAIGN_NOT_FOUND', 404);
    const r = (await sql<any>`select c.id, c.tenant_id, c.branch_id, c.name, c.offer, c.channel, c.audience_label, c.audience_size, c.status, c.scheduled_at, c.sent_count, c.revenue_cents, c.cost_cents, c.created_by, c.created_at, c.updated_at, c.started_at, c.goal, c.description, c.deal_id, c.message_body, c.email_subject, c.message_version, c.audience_source, c.audience_draft_id, c.snapshot_version, c.content_hash, c.origin, c.submitted_by_user_id, c.submitted_at, c.approved_by_user_id, c.approved_at, c.approved_content_hash, c.completed_at from campaigns c where c.tenant_id = ${ctx.tenantId} and c.id = ${id} and ${this.branchW(ctx)} ${lock ? sql`for update` : sql``}`.execute(db)).rows[0];
    if (!r) throw err('Campaign not found.', 'CAMPAIGN_NOT_FOUND', 404);
    return r;
  }
  private async audit1(db: Kysely<any>, ctx: CampaignsContext, id: string, action: string, summary: string, metadata: Record<string, unknown> = {}) {
    await recordAuditStrict(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role }, { module: 'campaigns', action, resourceType: 'campaign', resourceId: id, summary, metadata });
  }
  private cleanText(v: unknown, max: number) { const s = typeof v === 'string' ? v.replace(/\u0000/g, '').trim() : ''; return s ? s.slice(0, max) : null; }
  private async checkDeal(db: Kysely<any>, T: string, dealId: unknown) {
    if (dealId == null || dealId === '') return null;
    if (!UUID.test(String(dealId))) throw err('Promotion not found.', 'PROMOTION_NOT_FOUND', 404);
    const d = (await sql<any>`select id from deals where tenant_id = ${T} and id = ${String(dealId)}`.execute(db)).rows[0];
    if (!d) throw err('Promotion not found.', 'PROMOTION_NOT_FOUND', 404);
    return String(d.id);
  }
  private async rehash(db: Kysely<any>, T: string, id: string) {
    const r = (await sql<any>`select channel, message_body, email_subject, deal_id, snapshot_version, branch_id from campaigns where tenant_id = ${T} and id = ${id}`.execute(db)).rows[0];
    await sql`update campaigns set content_hash = ${campaignContentHash(r)} where tenant_id = ${T} and id = ${id}`.execute(db);
  }

  async createDraft(ctx: CampaignsContext, b: Record<string, any>) {
    this.need(ctx, 'pos.marketing.manage');
    const name = this.cleanText(b.name, 120);
    if (!name) throw err('Campaign name is required.', 'CAMPAIGN_NAME_REQUIRED');
    const channel = (['sms', 'email'] as string[]).includes(b.channel) ? b.channel : 'sms';
    const branchId = b.branchId && UUID.test(b.branchId) ? b.branchId : (ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null);
    if (branchId) { const ok = (await sql<any>`select 1 from branches where tenant_id = ${ctx.tenantId} and id = ${branchId}`.execute(this.db)).rows[0]; if (!ok) throw err('Branch not found.', 'BRANCH_NOT_FOUND', 404); }
    return this.db.transaction().execute(async (trx) => {
      const dealId = await this.checkDeal(trx, ctx.tenantId, b.dealId);
      const origin = b.origin === 'assistant' ? 'assistant' : 'manual';
      const r = (await sql<any>`insert into campaigns (tenant_id, branch_id, name, offer, channel, audience_label, audience_size, status, cost_cents, created_by, updated_by, goal, description, deal_id, message_body, email_subject, origin)
          values (${ctx.tenantId}, ${branchId}, ${name}, ${this.cleanText(b.offer, 200)}, ${channel}, null, 0, 'draft', ${Math.max(0, Math.trunc(N(b.budgetCents)))}, ${this.actorId(ctx)}, ${this.actorId(ctx)},
            ${this.cleanText(b.goal, 200)}, ${this.cleanText(b.description, 1000)}, ${dealId}, ${this.cleanText(b.messageBody, 1600)}, ${channel === 'email' ? this.cleanText(b.emailSubject, 200) : null}, ${origin})
          returning id`.execute(trx)).rows[0];
      await this.rehash(trx, ctx.tenantId, String(r.id));
      await this.audit1(trx, ctx, String(r.id), 'campaign.created', `Campaign "${name}" created as a draft`, { channel, origin });
      return { id: String(r.id) };
    });
  }

  async updateDraft(ctx: CampaignsContext, id: string, b: Record<string, any>) {
    this.need(ctx, 'pos.marketing.manage');
    return this.db.transaction().execute(async (trx) => {
      const c = await this.loadRow(trx, ctx, id, true);
      if (c.status !== 'draft') throw err('Only a draft can be edited. Move a scheduled campaign back to draft first.', 'CAMPAIGN_NOT_EDITABLE', 409);
      const set: any[] = [];
      if (b.name !== undefined) { const n = this.cleanText(b.name, 120); if (!n) throw err('Campaign name is required.', 'CAMPAIGN_NAME_REQUIRED'); set.push(sql`name = ${n}`); }
      if (b.goal !== undefined) set.push(sql`goal = ${this.cleanText(b.goal, 200)}`);
      if (b.description !== undefined) set.push(sql`description = ${this.cleanText(b.description, 1000)}`);
      if (b.offer !== undefined) set.push(sql`offer = ${this.cleanText(b.offer, 200)}`);
      if (b.budgetCents !== undefined) set.push(sql`cost_cents = ${Math.max(0, Math.trunc(N(b.budgetCents)))}`);
      if (b.dealId !== undefined) set.push(sql`deal_id = ${await this.checkDeal(trx, ctx.tenantId, b.dealId)}`);
      if (b.messageBody !== undefined) set.push(sql`message_body = ${this.cleanText(b.messageBody, 1600)}`);
      if (b.emailSubject !== undefined) set.push(sql`email_subject = ${c.channel === 'email' ? this.cleanText(b.emailSubject, 200) : null}`);
      if (b.channel !== undefined && b.channel !== c.channel) {
        if (!(['sms', 'email'] as string[]).includes(b.channel)) throw err('Choose SMS or email.', 'CAMPAIGN_CHANNEL_UNSUPPORTED');
        // a different channel needs a different consent check — the old audience snapshot no longer applies
        set.push(sql`channel = ${b.channel}`, sql`audience_source = null`);
      }
      if (!set.length) return this.detail(ctx, id);
      await sql`update campaigns set ${sql.join(set, sql`, `)}, updated_by = ${this.actorId(ctx)}, updated_at = now() where tenant_id = ${ctx.tenantId} and id = ${id}`.execute(trx);
      await this.rehash(trx, ctx.tenantId, id);
      const after = (await sql<any>`select content_hash, approved_content_hash from campaigns where tenant_id = ${ctx.tenantId} and id = ${id}`.execute(trx)).rows[0];
      const voided = !!c.approved_content_hash && after.content_hash !== c.approved_content_hash;
      await this.audit1(trx, ctx, id, 'campaign.updated', voided ? 'Campaign edited after approval — the approval no longer applies' : 'Campaign draft edited', { fields: Object.keys(b), approvalVoided: voided });
      return { id, approvalVoided: voided };
    });
  }

  /** the audience drafts Customer Segments saved for this channel and not yet expired / discarded (the wizard's Audience step) */
  async audienceSources(ctx: CampaignsContext, channel: string) {
    this.need(ctx, 'pos.marketing.view');
    const rows = (await sql<any>`select id, segment, channel, selected_count, eligible_count, excluded_count, created_at, expires_at, campaign_id from segment_audience_drafts
        where tenant_id = ${ctx.tenantId} and status = 'draft' and expires_at > now() and channel = ${channel === 'email' ? 'email' : 'sms'} order by created_at desc, id desc limit 20`.execute(this.db)).rows;
    return { items: rows.map((r) => ({ draftId: String(r.id), segment: r.segment, channel: r.channel, selected: N(r.selected_count), eligible: N(r.eligible_count), excluded: N(r.excluded_count), createdAt: iso(r.created_at), expiresAt: iso(r.expires_at), linkedCampaignId: r.campaign_id ? String(r.campaign_id) : null })) };
  }

  /** copy a Customer Segments audience draft into this campaign's snapshot (a new snapshot version; old versions are kept) */
  async setAudience(ctx: CampaignsContext, id: string, b: Record<string, any>) {
    this.need(ctx, 'pos.marketing.manage');
    const draftId = String(b.draftId ?? '');
    if (!UUID.test(draftId)) throw err('Audience not found.', 'AUDIENCE_DRAFT_NOT_FOUND', 404);
    return this.db.transaction().execute(async (trx) => {
      const c = await this.loadRow(trx, ctx, id, true);
      if (c.status !== 'draft') throw err('Only a draft can change its audience.', 'CAMPAIGN_NOT_EDITABLE', 409);
      if (c.channel === 'push') throw err('Push campaigns cannot be sent from Campaign Center yet.', 'CAMPAIGN_CHANNEL_UNSUPPORTED');
      const d = (await sql<any>`select id, channel, status, expires_at, segment, filters_json->>'purpose' as purpose from segment_audience_drafts where tenant_id = ${ctx.tenantId} and id = ${draftId} for update`.execute(trx)).rows[0];
      if (!d) throw err('Audience not found.', 'AUDIENCE_DRAFT_NOT_FOUND', 404);
      if (d.status !== 'draft' || new Date(d.expires_at).getTime() <= Date.now()) throw err('That saved audience has expired or was discarded. Build it again in Customer Segments.', 'AUDIENCE_DRAFT_CLOSED', 409);
      if (d.channel !== c.channel) throw err(`That audience was checked for ${String(d.channel).toUpperCase()}, but this campaign is ${String(c.channel).toUpperCase()}.`, 'AUDIENCE_CHANNEL_MISMATCH', 409);
      const v = N(c.snapshot_version) + 1;
      await sql`insert into campaign_recipients (tenant_id, campaign_id, snapshot_version, customer_id, channel, eligibility, destination_masked, source_draft_id, created_by)
          select m.tenant_id, ${id}, ${v}, m.customer_id, ${c.channel}, m.eligibility, m.destination_masked, m.draft_id, ${this.actorId(ctx)}
          from segment_audience_members m where m.tenant_id = ${ctx.tenantId} and m.draft_id = ${draftId}`.execute(trx);
      const k = (await sql<any>`select count(*)::int as selected, count(*) filter (where eligibility = 'eligible')::int as eligible from campaign_recipients where tenant_id = ${ctx.tenantId} and campaign_id = ${id} and snapshot_version = ${v}`.execute(trx)).rows[0];
      // Birthday Campaigns (750): an audience built by the Birthday Campaign Assistant makes this a birthday campaign — the send
      // worker then allows one birthday message per customer per occasion year. Any other audience clears it.
      await sql`update campaigns set occasion = ${d.purpose === 'birthday' ? 'birthday' : null}, audience_source = 'segment_snapshot', snapshot_version = ${v}, audience_draft_id = ${draftId}, audience_label = ${d.purpose === 'birthday' ? 'Birthday Campaign Assistant' : 'Customer Segments: ' + String(d.segment)},
          audience_size = ${N(k.selected)}, updated_by = ${this.actorId(ctx)}, updated_at = now() where tenant_id = ${ctx.tenantId} and id = ${id}`.execute(trx);
      await sql`update segment_audience_drafts set campaign_id = ${id}, updated_by = ${this.actorId(ctx)}, updated_at = now() where tenant_id = ${ctx.tenantId} and id = ${draftId}`.execute(trx);
      await this.rehash(trx, ctx.tenantId, id);
      await this.audit1(trx, ctx, id, 'campaign.audience_set', `Audience snapshot ${v} saved: ${N(k.selected)} selected, ${N(k.eligible)} eligible`, { snapshotVersion: v, draftId, selected: N(k.selected), eligible: N(k.eligible) });
      return { snapshotVersion: v, selected: N(k.selected), eligible: N(k.eligible), excluded: N(k.selected) - N(k.eligible) };
    });
  }

  /** §08 step 3 + 5: the message as it would go out (variables resolved), SMS segments, cost estimate when priced. NEVER sends. */
  async preview(ctx: CampaignsContext, id: string) {
    this.need(ctx, 'pos.marketing.view');
    const c = await this.loadRow(this.db, ctx, id);
    const salon = (await sql<any>`select display_name from tenants where id = ${ctx.tenantId}`.execute(this.db)).rows[0]?.display_name ?? '';
    const deal = c.deal_id ? (await sql<any>`select title as name from deals where tenant_id = ${ctx.tenantId} and id = ${c.deal_id}`.execute(this.db)).rows[0] : null;
    const rendered = renderMessage(String(c.message_body ?? ''), { salonName: String(salon), offer: deal?.name ?? c.offer ?? '' });
    const unknownVars = (String(c.message_body ?? '').match(/\{[a-z_]+\}/gi) ?? []).filter((v) => !(CC_VARIABLES as readonly string[]).includes(v.toLowerCase()));
    const k = (await sql<any>`select count(*) filter (where eligibility = 'eligible')::int as eligible, count(*)::int as selected from campaign_recipients where tenant_id = ${ctx.tenantId} and campaign_id = ${id} and snapshot_version = ${N(c.snapshot_version)}`.execute(this.db)).rows[0];
    const price = (await sql<any>`select value from platform_settings where setting_key = 'sms.marketing_segment_price_cents' limit 1`.execute(this.db).catch(() => ({ rows: [] }))).rows[0]?.value;
    const unit = price == null ? null : Number(typeof price === 'string' ? price.replace(/"/g, '') : price);
    const smsText = c.channel === 'sms' ? `${salon ? salon + ': ' : ''}${rendered} Reply STOP to opt out` : null;
    const seg = smsText ? estimateSmsSegments(smsText) : null;
    const eligible = N(k?.eligible);
    return {
      channel: c.channel, subject: c.channel === 'email' ? (c.email_subject ?? null) : null, body: rendered, asSent: smsText ?? rendered, unknownVariables: unknownVars,
      segmentsPerMessage: seg?.segments ?? null, encoding: seg?.encoding ?? null, selected: N(k?.selected), eligible,
      estimatedSegments: seg ? seg.segments * eligible : null,
      estimatedCostCents: seg && unit != null && Number.isFinite(unit) ? Math.round(seg.segments * eligible * unit) : null,   // round the total, not the unit price
      costNote: seg ? (unit != null ? 'Estimate from the platform price per segment.' : 'Not priced: the platform has no marketing price per segment set.') : 'Email has no per-message price here.',
      largeCampaign: eligible >= LARGE_CAMPAIGN_RECIPIENTS, sends: false,
    };
  }

  async submit(ctx: CampaignsContext, id: string) {
    this.need(ctx, 'pos.marketing.manage');
    return this.db.transaction().execute(async (trx) => {
      const c = await this.loadRow(trx, ctx, id, true);
      if (c.status !== 'draft') throw err('Only a draft can be sent for approval.', 'CAMPAIGN_NOT_EDITABLE', 409);
      await sql`update campaigns set submitted_by_user_id = ${this.actorId(ctx)}, submitted_at = now(), updated_by = ${this.actorId(ctx)}, updated_at = now() where tenant_id = ${ctx.tenantId} and id = ${id}`.execute(trx);
      await this.audit1(trx, ctx, id, 'campaign.approval_requested', 'Approval requested', {});
      return { id, submitted: true };
    });
  }

  /** §08 step 6 / §14: an owner or manager approves THIS content + THIS audience snapshot; the send plan is written in the same
   *  transaction (the sweep sends only campaigns with a plan). Approving never sends; Launch does, and only through the sweep. */
  async approve(ctx: CampaignsContext, id: string) {
    this.need(ctx, 'pos.marketing.manage');
    // who may approve = who holds marketing.manage (owner / manager by default; Front Desk has no marketing access) — decided by
    // permission, never by role name
    return this.db.transaction().execute(async (trx) => {
      const c = await this.loadRow(trx, ctx, id, true);
      if (c.status !== 'draft') throw err('Only a draft can be approved.', 'CAMPAIGN_NOT_EDITABLE', 409);
      await this.rehash(trx, ctx.tenantId, id);
      const fresh = await this.loadRow(trx, ctx, id);
      if (fresh.audience_source !== 'segment_snapshot' || N(fresh.snapshot_version) < 1) throw err('Choose an audience first.', 'CAMPAIGN_AUDIENCE_NOT_SELECTED', 409);
      if (!fresh.message_body || !String(fresh.message_body).trim()) throw err('Write the message first.', 'CAMPAIGN_MESSAGE_REQUIRED', 409);
      if (fresh.channel === 'email' && !fresh.email_subject) throw err('An email needs a subject.', 'CAMPAIGN_SUBJECT_REQUIRED', 409);
      const salon = (await sql<any>`select display_name from tenants where id = ${ctx.tenantId}`.execute(trx)).rows[0]?.display_name ?? '';
      const deal = fresh.deal_id ? (await sql<any>`select title as name from deals where tenant_id = ${ctx.tenantId} and id = ${fresh.deal_id}`.execute(trx)).rows[0] : null;
      const body = renderMessage(String(fresh.message_body), { salonName: String(salon), offer: deal?.name ?? fresh.offer ?? '' });
      // a re-approval after an edit is a NEW message version → the idempotency key changes only when the content did
      const version = fresh.approved_content_hash && fresh.approved_content_hash !== fresh.content_hash ? N(fresh.message_version) + 1 : (N(fresh.message_version) || 1);
      await sql`update campaigns set approved_by_user_id = ${this.actorId(ctx)}, approved_at = now(), approved_content_hash = content_hash, message_version = ${version},
          submitted_at = coalesce(submitted_at, now()), submitted_by_user_id = coalesce(submitted_by_user_id, ${this.actorId(ctx)}), updated_by = ${this.actorId(ctx)}, updated_at = now()
          where tenant_id = ${ctx.tenantId} and id = ${id}`.execute(trx);
      const def = JSON.stringify({ campaignSnapshot: true, snapshotVersion: N(fresh.snapshot_version), emailSubject: fresh.channel === 'email' ? fresh.email_subject : null });
      await sql`insert into ai_marketing_campaign_plans (campaign_id, tenant_id, branch_id, channel, message_version, body, offer_name, audience_definition, created_by_user_id)
          values (${id}, ${ctx.tenantId}, ${fresh.branch_id}, ${fresh.channel}, ${version}, ${body}, ${deal?.name ?? fresh.offer ?? null}, ${def}::jsonb, ${this.actorId(ctx)})
          on conflict (campaign_id) do update set channel = excluded.channel, message_version = excluded.message_version, body = excluded.body, offer_name = excluded.offer_name,
            audience_definition = excluded.audience_definition, updated_at = now()
          where ai_marketing_campaign_plans.tenant_id = excluded.tenant_id`.execute(trx);
      await this.audit1(trx, ctx, id, 'campaign.approved', `Approved message version ${version} for audience snapshot ${N(fresh.snapshot_version)}`, { messageVersion: version, snapshotVersion: N(fresh.snapshot_version), selfApproved: fresh.submitted_by_user_id ? String(fresh.submitted_by_user_id) === String(ctx.userId) : true });
      return { id, approved: true, messageVersion: version };
    });
  }

  /** Launch: approved + unchanged + ≥ 1 eligible → 'scheduled' at `at` (now when omitted). The sweep sends from there. */
  async launch(ctx: CampaignsContext, id: string, b: Record<string, any>) {
    this.need(ctx, 'pos.marketing.manage');
    const at = b.at ? new Date(String(b.at)) : new Date();
    if (Number.isNaN(at.getTime())) throw err('Choose a valid send time.', 'CAMPAIGN_TIME_INVALID');
    if (at.getTime() > Date.now() + 366 * 86_400_000) throw err('A campaign can be scheduled up to one year ahead.', 'CAMPAIGN_TIME_INVALID');
    if (b.confirm !== true) throw err('Confirm the send first.', 'CAMPAIGN_CONFIRMATION_REQUIRED', 409);
    const ready = await campaignSendReadiness(this.db, ctx.tenantId, id);
    if (!ready.ok) throw err(ready.message, ready.code, ready.code === 'CAMPAIGN_NOT_FOUND' ? 404 : 409);
    if (this.limitsPreflight) await this.limitsPreflight(ctx, id);
    return this.db.transaction().execute(async (trx) => {
      const c = await this.loadRow(trx, ctx, id, true);
      if (c.status !== 'draft') throw err('This campaign has already been launched.', 'CAMPAIGN_ALREADY_LAUNCHED', 409);
      const again = await campaignSendReadiness(trx, ctx.tenantId, id);   // re-checked under the row lock (a concurrent edit / second click)
      if (!again.ok) throw err(again.message, again.code, 409);
      const r = (await sql<any>`update campaigns set status = 'scheduled', scheduled_at = ${at.toISOString()}::timestamptz, updated_by = ${this.actorId(ctx)}, updated_at = now()
          where tenant_id = ${ctx.tenantId} and id = ${id} and ${canMoveToSql(CAMPAIGN, 'scheduled')} returning id`.execute(trx)).rows[0];
      if (!r) throw err('This campaign has already been launched.', 'CAMPAIGN_ALREADY_LAUNCHED', 409);
      await this.audit1(trx, ctx, id, 'campaign.launched', `Scheduled to send to up to ${again.eligible} eligible customers at ${at.toISOString()}`, { eligible: again.eligible, scheduledAt: at.toISOString() });
      return { id, status: 'scheduled', scheduledAt: at.toISOString(), eligible: again.eligible };
    });
  }

  /** a scheduled campaign that has not started goes back to draft (the machine's scheduled → draft); nothing was sent */
  async unschedule(ctx: CampaignsContext, id: string) {
    this.need(ctx, 'pos.marketing.manage');
    return this.db.transaction().execute(async (trx) => {
      await this.loadRow(trx, ctx, id, true);
      const r = (await sql<any>`update campaigns set status = 'draft', updated_by = ${this.actorId(ctx)}, updated_at = now()
          where tenant_id = ${ctx.tenantId} and id = ${id} and status = 'scheduled' and ${canMoveToSql(CAMPAIGN, 'draft')} returning id`.execute(trx)).rows[0];
      if (!r) throw err('Only a scheduled campaign that has not started can be moved back to draft.', 'CAMPAIGN_STATE_INVALID', 409);
      await this.audit1(trx, ctx, id, 'campaign.unscheduled', 'Moved back to draft before sending', {});
      return { id, status: 'draft' };
    });
  }

  /** duplicate a campaign as a NEW draft (content + offer; never the audience snapshot or approval) */
  async duplicate(ctx: CampaignsContext, id: string) {
    this.need(ctx, 'pos.marketing.manage');
    const c = await this.loadRow(this.db, ctx, id);
    return this.createDraft(ctx, { name: `${c.name} (copy)`.slice(0, 120), channel: c.channel === 'email' ? 'email' : 'sms', goal: c.goal, description: c.description, offer: c.offer,
      dealId: c.deal_id, messageBody: c.message_body, emailSubject: c.email_subject, branchId: c.branch_id, budgetCents: N(c.cost_cents) });
  }

  // ── §12 Check Campaign System (read-only) ──────────────────────────────────────────────────────────────────────────
  async healthCheck(ctx: CampaignsContext, b: Record<string, any>, env: NodeJS.ProcessEnv = process.env) {
    this.need(ctx, 'pos.marketing.view');
    const T = ctx.tenantId; const now = new Date().toISOString(); const correlationId = randomUUID();
    type F = { subsystem: string; status: 'ready' | 'attention_required' | 'pending' | 'failed' | 'unknown'; summary: string; evidence: string; nextStep: string | null; observedAt: string };
    const out: F[] = [];
    const f = (subsystem: string, status: F['status'], summary: string, evidence: string, nextStep: string | null) => out.push({ subsystem, status, summary, evidence, nextStep, observedAt: now });
    // Twilio (tenant credentials — read only; never shows a secret)
    const cred = (await sql<any>`select status, from_number is not null as has_from, messaging_service_sid is not null as has_svc, last_validated_at, last_validation_error, account_mode
        from tenant_messaging_credentials where tenant_id = ${T} and provider = 'twilio' order by branch_id nulls first limit 1`.execute(this.db).catch(() => ({ rows: [] }))).rows[0];
    if (!cred) f('twilio', 'attention_required', 'No Twilio account is connected for this salon.', 'tenant_messaging_credentials: none', 'Open Communications → Phone & Messaging to connect the salon\'s own Twilio account.');
    else if (cred.last_validation_error) f('twilio', 'failed', 'The last Twilio check failed.', 'a validation error is recorded on the account', 'Run the Phone & Messaging health check and fix the account.');
    else if (!cred.has_from && !cred.has_svc) f('twilio', 'attention_required', 'Twilio is connected but has no sending number.', 'no from number / messaging service', 'Assign a sending number in Phone & Messaging.');
    else f('twilio', cred.last_validated_at ? 'ready' : 'pending', cred.last_validated_at ? 'Twilio account and sender are set.' : 'Twilio is set but has never been checked.', `status ${cred.status}; ${cred.last_validated_at ? 'checked before' : 'never checked'}`, cred.last_validated_at ? null : 'Run the Phone & Messaging health check.');
    const failed24 = N((await sql<any>`select count(*)::int as n from notifications where tenant_id = ${T} and channel = 'sms' and status = 'failed' and created_at > now() - interval '24 hours'`.execute(this.db)).rows[0]?.n);
    if (failed24 > 0) f('twilio_failures', 'attention_required', `${failed24} text message(s) failed in the last 24 hours.`, 'notifications status=failed', 'Open the campaign details → Delivery Events for the provider error codes.');
    // Email
    const emailKey = !!String(env.SENDGRID_API_KEY ?? '').trim();
    f('email', emailKey ? 'ready' : 'attention_required', emailKey ? 'An email provider is configured for the platform.' : 'No email provider is configured, so campaign emails are not delivered.', `email provider key ${emailKey ? 'present' : 'absent'} (value never shown)`, emailKey ? null : 'Ask AI PowerSalon support to configure the email provider.');
    // Scheduler (the send sweep runs in a worker process that heartbeats)
    const hb = (await sql<any>`select count(*)::int as n, max(last_seen_at) as last from process_heartbeats where last_seen_at > now() - interval '5 minutes'`.execute(this.db).catch(() => ({ rows: [{ n: 0 }] }))).rows[0];
    f('scheduler', N(hb?.n) > 0 ? 'ready' : 'unknown', N(hb?.n) > 0 ? 'Background workers are reporting in.' : 'No background worker has reported in the last 5 minutes (or none is configured here).', `live worker processes in the last 5 minutes: ${N(hb?.n)}`, N(hb?.n) > 0 ? null : 'Check the worker deployment; scheduled campaigns wait until a worker runs.');
    const overdue = N((await sql<any>`select count(*)::int as n from campaigns where tenant_id = ${T} and status = 'scheduled' and scheduled_at < now() - interval '15 minutes'`.execute(this.db)).rows[0]?.n);
    if (overdue > 0) f('scheduler_backlog', 'attention_required', `${overdue} scheduled campaign(s) are more than 15 minutes overdue.`, 'campaigns status=scheduled, scheduled_at past', 'Check that the send worker is running.');
    // Recipients + Execution + Reporting — per campaign when one is named
    const cid = b?.campaignId && UUID.test(b.campaignId) ? String(b.campaignId) : null;
    let trace: Record<string, unknown> | null = null;
    if (cid) {
      const d: any = await this.detail(ctx, cid);
      const k = d.counts as CampaignCounts;
      const plan = (await sql<any>`select message_version, updated_at from ai_marketing_campaign_plans where tenant_id = ${T} and campaign_id = ${cid}`.execute(this.db)).rows[0];
      trace = { status: d.status, displayStatus: d.displayStatus, outcome: d.outcome, audienceSource: d.audienceSource, snapshotVersion: d.snapshotVersion, selected: k.selected, selectedIsEstimate: k.selectedIsEstimate,
        eligible: k.eligible, plan: plan ? { messageVersion: N(plan.message_version), updatedAt: iso(plan.updated_at) } : null, ledgerRows: k.queued + k.attempted + k.skippedAtSend,
        queued: k.queued, attempted: k.attempted, submitted: k.submitted, delivered: k.delivered, failed: k.failed, unknown: k.unknown, legacySentCount: k.legacySentCount };
      if (d.audienceSource !== 'segment_snapshot') f('recipients', 'attention_required', `The audience is a hand-typed estimate (${k.selected ?? 0}), not a list of customers.`, 'campaigns.audience_source = manual estimate; no campaign_recipients rows', 'Choose a saved audience from Customer Segments.');
      else f('recipients', (k.eligible ?? 0) > 0 ? 'ready' : 'attention_required', `${k.selected} selected, ${k.eligible} eligible, ${k.excluded} excluded.`, `campaign_recipients snapshot ${d.snapshotVersion}`, (k.eligible ?? 0) > 0 ? null : 'Nobody can receive it — review the exclusion reasons.');
      const execStatus = d.status === 'completed' && trace.ledgerRows === 0 ? 'attention_required' : d.status === 'scheduled' && !plan ? 'failed' : 'ready';
      const execSummary = d.status === 'completed' && trace.ledgerRows === 0
        ? 'Marked Completed, but no send was ever recorded: it was completed by hand, or before sending existed for it. Nothing was sent.'
        : d.status === 'scheduled' && !plan ? 'Scheduled without an approved send plan — the worker will skip it.' : `${k.submitted} accepted, ${k.delivered} delivered, ${k.failed} failed, ${k.unknown} awaiting a delivery callback.`;
      f('execution', execStatus, execSummary, `ledger rows ${String(trace.ledgerRows)}; plan ${plan ? 'v' + N(plan.message_version) : 'none'}`, execStatus === 'ready' ? null : 'Duplicate the campaign, choose an audience, approve it and launch again.');
      const mismatch = k.legacySentCount !== k.submitted;
      f('reporting', mismatch ? 'attention_required' : 'ready', mismatch ? `Old counter says ${k.legacySentCount} sent; the send records say ${k.submitted}. The send records are shown.` : 'Counts match their sources.', 'campaigns.sent_count vs ai_marketing_campaign_sends', null);
    }
    const order = ['failed', 'attention_required', 'pending', 'unknown', 'ready'] as const;
    const overall = order.find((s) => out.some((x) => x.status === s)) ?? 'unknown';
    await sql`insert into campaign_health_runs (tenant_id, branch_id, campaign_id, overall, findings_json, correlation_id, created_by)
        values (${T}, ${ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null}, ${cid}, ${overall}, ${JSON.stringify(out)}::jsonb, ${correlationId}, ${this.actorId(ctx)})`.execute(this.db);
    return { overall, findings: out, trace, correlationId, observedAt: now, sendsAnything: false };
  }

  // ── §14 AI Campaign Assistant (rules over real data; drafts only) ─────────────────────────────────────────────────
  async assistantSuggest(ctx: CampaignsContext, goal: string) {
    this.need(ctx, 'pos.marketing.view');
    if (!(CC_ASSISTANT_GOALS as readonly string[]).includes(goal)) throw err('Choose a goal.', 'ASSISTANT_GOAL_INVALID');
    const T = ctx.tenantId; const tz = await tenantTimeZone(this.db, T);
    const salon = (await sql<any>`select display_name from tenants where id = ${T}`.execute(this.db)).rows[0]?.display_name ?? 'our salon';
    const risks: string[] = []; let audience = ''; let liveCount: number | null = null; let name = ''; let body = ''; let schedule = 'Tuesday or Wednesday, 10:00–11:00 salon time (outside quiet hours).';
    const contactable = sql`c.status = 'active' and c.archived_at is null and c.marketing_sms_opt_in = true and coalesce(c.normalized_phone, '') <> ''
        and not exists (select 1 from notification_opt_outs o where o.tenant_id = c.tenant_id and o.channel = 'sms' and o.address = c.normalized_phone)`;
    // the Retention rule (Win-Back guide §03): a visit is a settled, NOT REMOVED ticket — a removed ticket never counts
    const visits = sql`(select count(*) from tickets t where t.tenant_id = c.tenant_id and t.customer_id = c.id and t.removed_at is null and t.status in ('paid', 'closed'))`;
    const lastVisit = sql`(select max(coalesce(t.paid_at, t.created_at)) from tickets t where t.tenant_id = c.tenant_id and t.customer_id = c.id and t.removed_at is null and t.status in ('paid', 'closed'))`;
    if (goal === 'inactive') {
      const days = N((await sql<any>`select risk_days from tenant_retention_settings where tenant_id = ${T}`.execute(this.db).catch(() => ({ rows: [] }))).rows[0]?.risk_days) || 60;
      liveCount = N((await sql<any>`select count(*)::int as n from customers c where c.tenant_id = ${T} and ${contactable} and ${visits} >= 1 and ${lastVisit} < now() - make_interval(days => ${days})`.execute(this.db)).rows[0]?.n);
      audience = `Customers Inactive / At Risk (at least one completed visit, none in ${days}+ days). Never-visited customers are a separate segment and are NOT included.`;
      name = 'We miss you'; body = `We miss you at {salon_name}! Come back this month and enjoy {offer}. Reply to book.`;
    } else if (goal === 'repeat_visits') {
      liveCount = N((await sql<any>`select count(*)::int as n from customers c where c.tenant_id = ${T} and ${contactable} and ${visits} = 1 and ${lastVisit} > now() - interval '60 days'`.execute(this.db)).rows[0]?.n);
      audience = 'New customers (exactly one completed visit in the last 60 days).';
      name = 'Your next visit'; body = `Thanks for visiting {salon_name}! Ready for your next appointment? {offer} Reply to book.`;
    } else if (goal === 'slow_weekdays') {
      const rows = (await sql<any>`select extract(isodow from (coalesce(t.paid_at, t.created_at) at time zone ${tz}))::int as dow, count(*)::int as n from tickets t
          where t.tenant_id = ${T} and t.status in ('paid', 'closed') and t.created_at > now() - interval '56 days' group by 1`.execute(this.db)).rows;
      const byDow = new Map<number, number>(rows.map((r: any) => [N(r.dow), N(r.n)]));
      const weekdays = [1, 2, 3, 4, 5].map((d) => ({ d, n: byDow.get(d) ?? 0 })).sort((a, b) => a.n - b.n);
      const dayName = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][weekdays[0].d];
      liveCount = N((await sql<any>`select count(*)::int as n from customers c where c.tenant_id = ${T} and ${contactable} and ${visits} >= 2`.execute(this.db)).rows[0]?.n);
      audience = `Returning customers (2+ completed visits). Slowest weekday over the last 8 weeks: ${dayName} (${weekdays[0].n} paid tickets).`;
      name = `${dayName} special`; body = `${dayName}s are relaxing at {salon_name}. Book a ${dayName} visit and get {offer}. Reply to book.`;
      schedule = `Send the day before: ${['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'][weekdays[0].d]} at 10:00 salon time.`;
      risks.push('Technician capacity for that day is NOT checked here — confirm the schedule has room before launching.');
    } else {
      liveCount = N((await sql<any>`select count(*)::int as n from customers c where c.tenant_id = ${T} and ${contactable} and ${visits} >= 1`.execute(this.db)).rows[0]?.n);
      audience = 'Customers with at least one completed visit. Narrow it to customers who had a related service in Customer Segments.';
      name = 'Try our new service'; body = `New at {salon_name}: try our latest service with {offer}. Reply to book.`;
      risks.push('Service eligibility is not checked automatically — pick the matching promotion so Checkout applies the right rules.');
    }
    risks.push('Consent and opt-outs are checked again at send time; the live count above can shrink.');
    const price = (await sql<any>`select value from platform_settings where setting_key = 'sms.marketing_segment_price_cents' limit 1`.execute(this.db).catch(() => ({ rows: [] }))).rows[0]?.value;
    const unit = price == null ? null : Number(typeof price === 'string' ? price.replace(/"/g, '') : price);
    const seg = estimateSmsSegments(`${salon}: ${renderMessage(body, { salonName: String(salon), offer: '20% off' })} Reply STOP to opt out`);
    return {
      goal, suggestedName: name, channel: 'sms', audience, liveEligibleEstimate: liveCount, messageDraft: body, variables: CC_VARIABLES, schedule,
      estimatedSegments: liveCount != null ? liveCount * seg.segments : null,
      estimatedCostCents: liveCount != null && unit != null && Number.isFinite(unit) ? Math.round(liveCount * seg.segments * unit) : null,
      costNote: unit == null ? 'Not available: the platform has no marketing price per segment set.' : 'Estimate only.',
      risks, isSuggestion: true, sends: false,
      nextSteps: ['Save as a draft', 'Build the audience in Customer Segments and attach it', 'Review the message', 'An owner or manager approves', 'Launch'],
    };
  }
  async assistantSaveDraft(ctx: CampaignsContext, b: Record<string, any>) {
    this.need(ctx, 'pos.marketing.manage');
    const s = await this.assistantSuggest(ctx, String(b.goal ?? ''));
    return this.createDraft(ctx, { name: this.cleanText(b.name, 120) ?? s.suggestedName, channel: 'sms', goal: `Assistant: ${String(b.goal)}`, description: s.audience,
      messageBody: this.cleanText(b.messageBody, 1600) ?? s.messageDraft, dealId: b.dealId, origin: 'assistant' });
  }
}

/** resolve the compose-time variables; unknown {tokens} are left visible so the reviewer sees them */
export function renderMessage(body: string, v: { salonName: string; offer: string }): string {
  return body.replace(/\{salon_name\}/gi, v.salonName || 'our salon').replace(/\{offer\}/gi, v.offer || '').replace(/\s{2,}/g, ' ').trim();
}

export function asHttp(e: unknown): never {
  if (e instanceof CampaignCenterError) throw withCode(new HttpException({ code: e.code, message: e.message, ...e.extra }, e.status as HttpStatus), e.code as ApiErrorCode);
  throw e;
}

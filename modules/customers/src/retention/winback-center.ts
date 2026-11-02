// winback-center.ts — Customer Retention & Win-Back Complete Build Guide (Oct 30 2026), the owner's recommendations 1 and 3
// on top of the existing Retention module (one definition of a visit / a segment — RetentionRepository.base()):
//
//   Check Retention Data (§09)   READ-ONLY. Nine checks over the salon's real records, each Ready / Attention required /
//                                Failed / Unknown with the affected count, up to 5 sample customer ids of THIS salon, the
//                                cause and the fix. It never edits a customer, a ticket or a message — problems become a
//                                review item for staff. Every run is recorded (retention_health_runs, migration 749) so
//                                "last successful verification" per check is a fact. Manual runs: one per salon per minute,
//                                decided under a per-salon advisory lock (two taps at once record ONE run).
//   Win-Back Assistant (§10)     A goal → an audience described by FACTUAL criteria (the Retention rules), the eligible /
//                                excluded counts with reasons (the Segments win-back verdict: consent · opt-out · recently
//                                contacted · upcoming booking · never visited), a SUGGESTED message, existing active offers,
//                                the send window, and a cost only when a per-text rate is configured. Never-visited customers
//                                are only ever a separately labelled count — never part of a win-back audience.
//                                "Save draft" stores a consent-checked, UNSENT audience (Segments audience draft, purpose
//                                win_back) — the campaign itself is created, approved and launched in Campaign Center. Nothing
//                                here sends, schedules or approves anything.
import { sql, type Kysely } from 'kysely';
import { tenantTimeZone } from '@aipowersalon/database';
import { RetentionRepository, RetentionError, SEGMENTATION_VERSION, isUuid, smsSegments, type RetentionContext, type ListFilters } from './retention.repository';
import { SegmentsRepository } from '../segments/segments.repository';
import { VISIT_TICKET_STATUSES } from '../customers/customer-segments';

const VISIT = [...VISIT_TICKET_STATUSES];
const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());

export const WINBACK_GOALS = ['inactive_risk', 'inactive_90', 'repeat_visits', 'slow_weekdays', 'promote_service'] as const;
export type WinBackGoal = (typeof WINBACK_GOALS)[number];
export const HEALTH_CHECK_KEYS = ['never_visited_not_lapsed', 'queued_to_never_visited', 'visit_timestamps', 'orphan_visits', 'possible_duplicate_visits',
  'segments_agree', 'lapsed_value_reconciles', 'snapshots', 'messaging_ready'] as const;
export type HealthStatus = 'ready' | 'attention_required' | 'failed' | 'unknown';
export interface HealthCheck { key: string; status: HealthStatus; affected: number | null; sampleCustomerIds: string[]; cause: string; fix: string | null; evidence: string; lastReadyAt?: string | null }
const RANK: Record<HealthStatus, number> = { ready: 0, unknown: 1, attention_required: 2, failed: 3 };
export const HEALTH_MIN_INTERVAL_SECONDS = 60;
export const WINBACK_MAX_AUDIENCE = 2000;   // = Segments' MAX_AUDIENCE

/** the goal → Retention filters (one rule set: the list, the Segments verdict and the send-time worker agree) */
export function goalFilters(goal: WinBackGoal, risk: number, service?: string | null): ListFilters {
  switch (goal) {
    case 'inactive_risk': return { segment: 'at_risk' };
    case 'inactive_90': return { segment: 'at_risk', minDays: Math.max(90, risk) };
    case 'repeat_visits': return { segment: 'approaching' };
    case 'slow_weekdays': return { segment: 'active', minVisits: 2 };
    case 'promote_service': return { segment: 'all', minVisits: 1, q: String(service ?? '').trim() };
  }
}

export class WinBackCenter {
  readonly ret: RetentionRepository; readonly seg: SegmentsRepository;
  constructor(readonly db: Kysely<any>, ret?: RetentionRepository) { this.ret = ret ?? new RetentionRepository(db); this.seg = new SegmentsRepository(db, this.ret); }

  // ── Check Retention Data ───────────────────────────────────────────────────────────────────────────────────────────
  async lastHealth(ctx: RetentionContext) {
    const r = (await sql<any>`select id, overall, results, ruleset_version, settings_version, created_at, duration_ms from retention_health_runs
      where tenant_id = ${ctx.tenantId} order by created_at desc, id desc limit 1`.execute(this.db)).rows[0];
    if (!r) return { run: null, lastReadyAt: {} as Record<string, string> };
    return { run: this.runOut(r, await this.lastReady(ctx)), lastReadyAt: await this.lastReady(ctx) };
  }
  private async lastReady(ctx: RetentionContext, db: Kysely<any> = this.db): Promise<Record<string, string>> {
    const rows = (await sql<any>`select k.key, max(r.created_at) as at from retention_health_runs r, jsonb_each(r.results) k
      where r.tenant_id = ${ctx.tenantId} and k.value->>'status' = 'ready' group by k.key`.execute(db)).rows;
    return Object.fromEntries(rows.map((x: any) => [String(x.key), String(iso(x.at))]));
  }
  private runOut(r: any, lastReady: Record<string, string>) {
    const res = typeof r.results === 'string' ? JSON.parse(r.results) : (r.results ?? {});
    const checks = HEALTH_CHECK_KEYS.filter((k) => res[k]).map((k) => ({ ...res[k], key: k, lastReadyAt: lastReady[k] ?? null }));
    return { runId: String(r.id), overall: String(r.overall) as HealthStatus, checkedAt: iso(r.created_at), rulesetVersion: String(r.ruleset_version), settingsVersion: N(r.settings_version),
      durationMs: N(r.duration_ms), checks, readOnly: true };
  }

  async runHealth(ctx: RetentionContext) {
    const started = Date.now();
    const k = await this.ret.window(ctx);
    const checks = await this.computeChecks(ctx, k);
    const overall = checks.reduce<HealthStatus>((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), 'ready');
    const results = Object.fromEntries(checks.map((c) => [c.key, c]));
    const id = await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'retention_health:' + ctx.tenantId}))`.execute(trx);
      const recent = (await sql<any>`select 1 from retention_health_runs where tenant_id = ${ctx.tenantId} and created_at > now() - make_interval(secs => ${HEALTH_MIN_INTERVAL_SECONDS}) limit 1`.execute(trx)).rows[0];
      if (recent) return null;
      return String((await sql<any>`insert into retention_health_runs (tenant_id, branch_id, trigger, overall, results, ruleset_version, settings_version, duration_ms, created_by_user_id)
        values (${ctx.tenantId}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, 'manual', ${overall}, ${JSON.stringify(results)}::jsonb, ${SEGMENTATION_VERSION}, ${k.settingsVersion},
          ${Date.now() - started}, ${isUuid(ctx.userId) ? ctx.userId : null}) returning id`.execute(trx)).rows[0].id);
    });
    if (!id) throw new RetentionError('The retention data check just ran. Try again in a minute.', 'WINBACK_HEALTH_RATE_LIMITED', 429);
    const r = (await sql<any>`select id, overall, results, ruleset_version, settings_version, created_at, duration_ms from retention_health_runs where tenant_id = ${ctx.tenantId} and id = ${id}`.execute(this.db)).rows[0];
    return this.runOut(r, await this.lastReady(ctx));
  }

  private async computeChecks(ctx: RetentionContext, k: Awaited<ReturnType<RetentionRepository['window']>>): Promise<HealthCheck[]> {
    const T = ctx.tenantId;
    const ids = (rows: any[]) => rows.slice(0, 5).map((x) => String(x.id));
    const out: HealthCheck[] = [];
    const safe = async (key: string, fn: () => Promise<HealthCheck>) => {
      try { out.push(await fn()); }
      catch (e) { out.push({ key, status: 'unknown', affected: null, sampleCustomerIds: [], cause: 'The check could not read its source records.', fix: 'Run the check again; if it repeats, contact support.', evidence: String((e as Error)?.message ?? e).slice(0, 160) }); }
    };
    // 1. the P0 of the guide: a zero-visit customer is Never Visited — never At Risk / Approaching / Active
    await safe('never_visited_not_lapsed', async () => {
      const rows = (await sql<any>`${this.ret.base(ctx, k)} select b.id from b where b.visits = 0 and b.segment <> 'never_visited' order by b.id limit 6`.execute(this.db)).rows;
      const never = N((await sql<any>`${this.ret.base(ctx, k)} select count(*)::int as n from b where b.visits = 0`.execute(this.db)).rows[0]?.n);
      return rows.length
        ? { key: 'never_visited_not_lapsed', status: 'failed', affected: rows.length, sampleCustomerIds: ids(rows), cause: 'Customers with no completed visit are classified as lapsed / active.', fix: 'Stop win-back outreach and report this to support — the shared segment rule is broken.', evidence: `${rows.length} zero-visit customers outside Never Visited` }
        : { key: 'never_visited_not_lapsed', status: 'ready', affected: 0, sampleCustomerIds: [], cause: `All ${never} customers with no completed visit are Never Visited (not At Risk).`, fix: null, evidence: `rule ${SEGMENTATION_VERSION}: visits = 0 → never_visited` };
    });
    // 2. messages still waiting to go to someone who now has no completed visit (the worker also blocks them at send time)
    await safe('queued_to_never_visited', async () => {
      const rows = (await sql<any>`select distinct r.customer_id as id from retention_sms_recipients r where r.tenant_id = ${T} and r.status in ('queued', 'submitting')
        and not exists (select 1 from tickets t where t.tenant_id = ${T} and t.customer_id = r.customer_id and t.removed_at is null and t.status = any(${VISIT}::text[])) limit 6`.execute(this.db)).rows;
      return rows.length
        ? { key: 'queued_to_never_visited', status: 'failed', affected: rows.length, sampleCustomerIds: ids(rows), cause: 'Win-back texts are queued for customers who no longer have a completed visit.', fix: 'They are blocked at send time ("never_visited"); cancel the campaign if more are pending.', evidence: 'retention_sms_recipients queued/submitting without a settled ticket' }
        : { key: 'queued_to_never_visited', status: 'ready', affected: 0, sampleCustomerIds: [], cause: 'No queued win-back text is addressed to a customer without a completed visit.', fix: null, evidence: 'queued / submitting recipients checked against settled tickets' };
    });
    // 3. visit timestamps: a settled visit with no paid time falls back to its creation time; a future visit time is wrong
    await safe('visit_timestamps', async () => {
      const r = (await sql<any>`select count(*) filter (where t.paid_at is null)::int as no_paid, count(*) filter (where coalesce(t.paid_at, t.created_at) > now() + interval '1 day')::int as future,
          (array_agg(t.customer_id) filter (where t.paid_at is null or coalesce(t.paid_at, t.created_at) > now() + interval '1 day'))[1:5] as sample
        from tickets t where t.tenant_id = ${T} and t.customer_id is not null and t.removed_at is null and t.status = any(${VISIT}::text[])`.execute(this.db)).rows[0] ?? {};
      const future = N(r.future), noPaid = N(r.no_paid); const sample = (Array.isArray(r.sample) ? r.sample : []).filter(Boolean).map(String);
      if (future > 0) return { key: 'visit_timestamps', status: 'failed', affected: future, sampleCustomerIds: sample, cause: `${future} completed visits are dated in the future.`, fix: 'Review those tickets in Transactions; a corrected time is needed before trusting Days Away.', evidence: 'coalesce(paid_at, created_at) > now() + 1 day' };
      if (noPaid > 0) return { key: 'visit_timestamps', status: 'attention_required', affected: noPaid, sampleCustomerIds: sample, cause: `${noPaid} completed visits have no paid time; their creation time is used as the visit time.`, fix: 'Usually imported or legacy tickets — review if Last Visit looks wrong.', evidence: 'settled tickets with paid_at null' };
      return { key: 'visit_timestamps', status: 'ready', affected: 0, sampleCustomerIds: [], cause: 'Every completed visit has a paid time in the past.', fix: null, evidence: 'settled tickets checked' };
    });
    // 4. settled visits linked to a customer that is not this salon's (or no longer exists)
    await safe('orphan_visits', async () => {
      const n = N((await sql<any>`select count(*)::int as n from tickets t where t.tenant_id = ${T} and t.customer_id is not null and t.removed_at is null and t.status = any(${VISIT}::text[])
        and not exists (select 1 from customers c where c.tenant_id = ${T} and c.id = t.customer_id)`.execute(this.db)).rows[0]?.n);
      return n > 0
        ? { key: 'orphan_visits', status: 'attention_required', affected: n, sampleCustomerIds: [], cause: `${n} completed visits point to a customer record that does not exist in this salon — they count for nobody.`, fix: 'Review the import / merge history; relink the tickets to the right customer (a staff task, never automatic).', evidence: 'settled tickets whose customer_id has no customer row' }
        : { key: 'orphan_visits', status: 'ready', affected: 0, sampleCustomerIds: [], cause: 'Every completed visit belongs to a customer of this salon.', fix: null, evidence: 'settled tickets checked' };
    });
    // 5. possible double checkouts: same customer, same total, settled within 5 minutes of each other (review, never auto-merge)
    await safe('possible_duplicate_visits', async () => {
      const rows = (await sql<any>`select distinct t1.customer_id as id from tickets t1 join tickets t2 on t2.tenant_id = t1.tenant_id and t2.customer_id = t1.customer_id and t2.id > t1.id
          and t2.total_cents = t1.total_cents and t2.removed_at is null and t2.status = any(${VISIT}::text[])
          and abs(extract(epoch from (coalesce(t2.paid_at, t2.created_at) - coalesce(t1.paid_at, t1.created_at)))) < 300
        where t1.tenant_id = ${T} and t1.customer_id is not null and t1.removed_at is null and t1.status = any(${VISIT}::text[]) and coalesce(t1.total_cents, 0) > 0 limit 51`.execute(this.db)).rows;
      return rows.length
        ? { key: 'possible_duplicate_visits', status: 'attention_required', affected: rows.length > 50 ? null : rows.length, sampleCustomerIds: ids(rows), cause: `${rows.length > 50 ? '50+' : rows.length} customers have two completed tickets of the same amount within 5 minutes — each counts as a visit.`, fix: 'Review in Transactions; void a true duplicate there (this check never edits tickets).', evidence: 'same customer · same total · settled < 5 min apart' }
        : { key: 'possible_duplicate_visits', status: 'ready', affected: 0, sampleCustomerIds: [], cause: 'No completed tickets look like double checkouts.', fix: null, evidence: 'same customer · same total · settled < 5 min apart' };
    });
    // 6. Customer Segments and Retention agree (they share the visit facts; a difference means a rule drifted)
    await safe('segments_agree', async () => {
      const s = await this.seg.summary(ctx, {});
      const r = (await sql<any>`${this.ret.base(ctx, k)} select count(*) filter (where b.visits = 0)::int as never, count(*) filter (where b.segment = 'at_risk')::int as at_risk,
          count(*) filter (where b.visits = 1)::int as new, count(*) filter (where b.visits >= 2)::int as returning from b`.execute(this.db)).rows[0] ?? {};
      const diffs: string[] = [];
      if (N(s.counts.never) !== N(r.never)) diffs.push(`Never Visited ${s.counts.never} vs ${r.never}`);
      if (N(s.counts.inactive) !== N(r.at_risk)) diffs.push(`Inactive ${s.counts.inactive} vs At Risk ${r.at_risk}`);
      if (N(s.counts.new) !== N(r.new)) diffs.push(`New ${s.counts.new} vs ${r.new}`);
      if (N(s.counts.returning) !== N(r.returning)) diffs.push(`Returning ${s.counts.returning} vs ${r.returning}`);
      return diffs.length
        ? { key: 'segments_agree', status: 'failed', affected: diffs.length, sampleCustomerIds: [], cause: `Customer Segments and Retention disagree: ${diffs.join('; ')}.`, fix: 'Report to support — both must use the shared visit rule.', evidence: `Segments vs Retention, rule ${SEGMENTATION_VERSION}` }
        : { key: 'segments_agree', status: 'ready', affected: 0, sampleCustomerIds: [], cause: `Customer Segments and Retention agree (Never Visited ${r.never}, New ${r.new}, Returning ${r.returning}, At Risk ${r.at_risk}).`, fix: null, evidence: `rule ${SEGMENTATION_VERSION}` };
    });
    // 7. Lapsed Value recomputed independently (not through base()) must equal the KPI
    await safe('lapsed_value_reconciles', async () => {
      const kpi = N((await this.ret.summary(ctx, {})).kpis.lapsedValueCents);
      const ind = N((await sql<any>`with v as (
          select t.customer_id, max(coalesce(t.paid_at, t.created_at)) as last_vt, sum(coalesce(t.total_cents, 0))::bigint as spend from tickets t
          where t.tenant_id = ${T} and t.customer_id is not null and t.removed_at is null and t.status = any(${VISIT}::text[]) group by t.customer_id),
        rf as (select t.customer_id, sum(pr.amount_cents)::bigint as refunded from payment_refunds pr join payments p on p.id = pr.payment_id and p.tenant_id = pr.tenant_id
          join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id where pr.tenant_id = ${T} and pr.status = 'refunded' and t.removed_at is null and t.status = any(${VISIT}::text[]) group by t.customer_id)
        select coalesce(sum(greatest(0, v.spend - coalesce(rf.refunded, 0))), 0)::bigint as cents from v join customers c on c.id = v.customer_id and c.tenant_id = ${T} and c.status <> 'archived'
        left join rf on rf.customer_id = v.customer_id
        where (${k.today}::date - (v.last_vt at time zone ${k.tz})::date) >= ${k.risk}`.execute(this.db)).rows[0]?.cents);
      return kpi === ind
        ? { key: 'lapsed_value_reconciles', status: 'ready', affected: 0, sampleCustomerIds: [], cause: `Lapsed Value matches an independent recount (${(kpi / 100).toFixed(2)}).`, fix: null, evidence: 'settled ticket totals − completed refunds, At Risk customers, salon days' }
        : { key: 'lapsed_value_reconciles', status: 'failed', affected: null, sampleCustomerIds: [], cause: `Lapsed Value ${(kpi / 100).toFixed(2)} differs from the recount ${(ind / 100).toFixed(2)}.`, fix: 'Report to support with this run id.', evidence: 'KPI vs independent query' };
    });
    // 8. the nightly snapshot job — no history is never invented
    await safe('snapshots', async () => {
      const last = (await sql<any>`select to_char(snapshot_local_date, 'YYYY-MM-DD') as d, status, last_error from customer_retention_snapshot_runs where tenant_id = ${T} and kind = 'nightly'
        order by snapshot_local_date desc, created_at desc limit 1`.execute(this.db)).rows[0];
      const failed = N((await sql<any>`select count(*)::int as n from customer_retention_snapshot_runs where tenant_id = ${T} and status = 'failed' and created_at > now() - interval '7 days'`.execute(this.db)).rows[0]?.n);
      if (!last) return { key: 'snapshots', status: 'unknown', affected: null, sampleCustomerIds: [], cause: 'No historical snapshot has been recorded yet — as-of-date views show "No historical snapshot".', fix: 'The nightly job records one each night once enabled.', evidence: 'customer_retention_snapshot_runs: none' };
      if (failed > 0) return { key: 'snapshots', status: 'failed', affected: failed, sampleCustomerIds: [], cause: `${failed} snapshot runs failed in the last 7 days.`, fix: 'Open Snapshot runs for the error; the job retries automatically.', evidence: `last nightly ${last.d} (${last.status})` };
      const ageDays = Math.round((Date.parse(k.today + 'T00:00:00Z') - Date.parse(String(last.d) + 'T00:00:00Z')) / 86400000);
      return ageDays > 2
        ? { key: 'snapshots', status: 'attention_required', affected: null, sampleCustomerIds: [], cause: `The last nightly snapshot is ${ageDays} days old (${last.d}).`, fix: 'Check that the background worker is running.', evidence: `last nightly ${last.d}` }
        : { key: 'snapshots', status: 'ready', affected: 0, sampleCustomerIds: [], cause: `Nightly snapshots are current (last ${last.d}).`, fix: null, evidence: `last nightly ${last.d} (${last.status})` };
    });
    // 9. can a win-back text actually leave? (sender facts only — never a send)
    await safe('messaging_ready', async () => {
      const s = await this.ret.sender(ctx);
      if (s.route === 'tenant_account') return { key: 'messaging_ready', status: s.a2pStatus && !/approved|verified|active/i.test(s.a2pStatus) ? 'attention_required' : 'ready', affected: null, sampleCustomerIds: [],
        cause: s.a2pStatus && !/approved|verified|active/i.test(s.a2pStatus) ? `The salon's Twilio sender is set, but carrier registration is ${s.a2pStatus}.` : 'The salon\'s own Twilio sender is set.', fix: s.a2pStatus && !/approved|verified|active/i.test(s.a2pStatus) ? 'Finish registration in Text Messaging Setup.' : null, evidence: `route ${s.route}` };
      if (s.route === 'simulated') return { key: 'messaging_ready', status: 'attention_required', affected: null, sampleCustomerIds: [], cause: 'Only the test sender is active — no real text would be delivered.', fix: 'Connect the salon\'s Twilio account in Text Messaging Setup.', evidence: 'route simulated' };
      if (s.route === 'shared') return { key: 'messaging_ready', status: 'attention_required', affected: null, sampleCustomerIds: [], cause: 'Texts would use the shared platform sender, not the salon\'s own account.', fix: 'Connect the salon\'s Twilio account in Text Messaging Setup.', evidence: 'route shared' };
      return { key: 'messaging_ready', status: 'attention_required', affected: null, sampleCustomerIds: [], cause: 'No text sender is configured — a win-back text cannot be sent.', fix: 'Connect the salon\'s Twilio account in Text Messaging Setup.', evidence: 'route not_configured' };
    });
    return out;
  }

  // ── AI Win-Back Assistant (suggestions; nothing is sent) ─────────────────────────────────────────────────────────────
  private goal(v: unknown): WinBackGoal {
    const g = String(v ?? '');
    if (!(WINBACK_GOALS as readonly string[]).includes(g)) throw new RetentionError('Choose a win-back goal.', 'WINBACK_GOAL_INVALID');
    return g as WinBackGoal;
  }
  private channel(v: unknown): 'sms' | 'email' { return v === 'email' ? 'email' : 'sms'; }

  async plan(ctx: RetentionContext, b: { goal?: unknown; channel?: unknown; service?: unknown }) {
    const goal = this.goal(b.goal); const channel = this.channel(b.channel);
    const service = typeof b.service === 'string' ? b.service.trim().slice(0, 60) : '';
    if (goal === 'promote_service' && service.length < 3) throw new RetentionError('Type at least 3 letters of the service to promote.', 'WINBACK_GOAL_INVALID');
    const k = await this.ret.window(ctx);
    const f = goalFilters(goal, k.risk, service);
    const ids = await this.ret.matchingIds(ctx, f);
    const v = await this.seg.verdicts(ctx, ids, channel, 'win_back');
    const excluded: Record<string, number> = {}; let eligible = 0;
    for (const x of v.values()) { if (x.status === 'eligible') eligible++; else excluded[x.status] = (excluded[x.status] || 0) + 1; }
    const never = N((await sql<any>`${this.ret.base(ctx, k)} select count(*)::int as n from b where b.visits = 0`.execute(this.db)).rows[0]?.n);
    const salon = (await sql<any>`select display_name from tenants where id = ${ctx.tenantId}`.execute(this.db)).rows[0]?.display_name ?? null;
    const offers = (await sql<any>`select d.id, d.title, d.ends_at from deals d where d.tenant_id = ${ctx.tenantId} and d.status = 'active' and coalesce(d.new_customers_only, false) = false
      and (d.ends_at is null or d.ends_at > now()) and (d.starts_at is null or d.starts_at <= now()) order by d.ends_at asc nulls last, d.id limit 5`.execute(this.db)).rows;
    const price = channel === 'sms' ? await this.seg.priceCents() : null;
    const quiet = await this.ret.quietUntil(ctx);
    const tz = await tenantTimeZone(this.db, ctx.tenantId).catch(() => k.tz);
    const slowDay = goal === 'slow_weekdays' ? await this.slowestWeekday(ctx, tz) : null;
    const copy = this.copy(goal, channel, slowDay, service);
    const segs = channel === 'sms' ? smsSegments(copy.body).segments : null;
    return {
      suggestion: true, goal, channel, rulesetVersion: SEGMENTATION_VERSION, settingsVersion: k.settingsVersion, asOf: k.today,
      audience: { criteria: this.criteria(goal, k, service), selected: ids.length, eligible, excluded, excludedTotal: ids.length - eligible,
        neverVisited: { count: never, included: false, note: 'Never-visited customers are a separate first-visit audience — they are never part of a win-back message.' } },
      message: { ...copy, salonName: salon, smsSegments: segs },
      offers: offers.map((o: any) => ({ dealId: String(o.id), title: String(o.title), endsAt: iso(o.ends_at) })),
      sendWindow: quiet.start != null && quiet.end != null && quiet.start !== quiet.end ? { text: `Outside quiet hours (${quiet.start}:00–${quiet.end}:00 salon time); Tuesday–Wednesday mid-morning suggested.`, quietStart: quiet.start, quietEnd: quiet.end }
        : { text: 'Tuesday–Wednesday mid-morning, salon time, suggested. No quiet hours are configured.', quietStart: null, quietEnd: null },
      estimatedCostCents: price != null && segs ? eligible * segs * price : null,
      costNote: price == null ? (channel === 'sms' ? 'No per-text rate is configured — cost is not estimated.' : 'Email has no per-message rate here.') : null,
      next: 'Save the audience, then create, approve and launch the campaign in Campaign Center. Nothing is sent from here.',
    };
  }
  private criteria(goal: WinBackGoal, k: { risk: number; approaching: number }, service: string) {
    switch (goal) {
      case 'inactive_risk': return `At least one completed visit and none in the last ${k.risk}+ salon days (At Risk).`;
      case 'inactive_90': return `At least one completed visit and none in the last ${Math.max(90, k.risk)}+ salon days.`;
      case 'repeat_visits': return `Visited before; ${k.approaching}–${k.risk - 1} salon days since the last completed visit (Approaching Risk).`;
      case 'slow_weekdays': return `Regulars: 2+ completed visits and a visit within the last ${k.risk} salon days.`;
      case 'promote_service': return `Customers with a completed visit whose history matches "${service}".`;
    }
  }
  private copy(goal: WinBackGoal, channel: 'sms' | 'email', slowDay: string | null, service: string) {
    const body = goal === 'inactive_risk' || goal === 'inactive_90' ? 'We miss you at {salon_name}! Come back soon and enjoy {offer}. Reply STOP to opt out.'
      : goal === 'repeat_visits' ? 'It\'s almost time for your next visit at {salon_name}. Book now and enjoy {offer}. Reply STOP to opt out.'
      : goal === 'slow_weekdays' ? `Treat yourself this ${slowDay ?? 'weekday'} at {salon_name} — {offer}. Reply STOP to opt out.`
      : `Love your last ${service} at {salon_name}? Book your next one and enjoy {offer}. Reply STOP to opt out.`;
    const name = goal === 'inactive_risk' || goal === 'inactive_90' ? 'We miss you' : goal === 'repeat_visits' ? 'Time for your next visit' : goal === 'slow_weekdays' ? `${slowDay ?? 'Weekday'} special` : `${service} promotion`;
    return { name, body: channel === 'email' ? body.replace(' Reply STOP to opt out.', '') : body, subject: channel === 'email' ? name : null, label: 'Suggested text — review and edit before approval.' };
  }
  private async slowestWeekday(ctx: RetentionContext, tz: string): Promise<string | null> {
    const rows = (await sql<any>`select extract(isodow from (coalesce(t.paid_at, t.created_at) at time zone ${tz}))::int as dow, count(*)::int as n from tickets t
      where t.tenant_id = ${ctx.tenantId} and t.removed_at is null and t.status = any(${VISIT}::text[]) and coalesce(t.paid_at, t.created_at) > now() - interval '56 days' group by 1`.execute(this.db)).rows;
    if (!rows.length) return null;
    const by = new Map<number, number>(rows.map((r: any) => [N(r.dow), N(r.n)]));
    const d = [1, 2, 3, 4, 5].map((x) => ({ x, n: by.get(x) ?? 0 })).sort((a, b) => a.n - b.n || a.x - b.x)[0].x;
    return ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][d];
  }

  /** Save the assistant's audience as an UNSENT Segments audience draft (purpose win_back): the audience is recomputed on the
   *  server (never trusted from the client), re-verdicted and stored; Campaign Center turns it into a campaign that still needs
   *  approval. Idempotent on idempotencyKey. */
  async saveAudience(ctx: RetentionContext, b: { goal?: unknown; channel?: unknown; service?: unknown; message?: unknown; idempotencyKey?: unknown },
    audit: (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<void>) {
    const goal = this.goal(b.goal); const channel = this.channel(b.channel);
    const key = String(b.idempotencyKey ?? '');
    if (key.length < 8) throw new RetentionError('An idempotency key is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    const service = typeof b.service === 'string' ? b.service.trim().slice(0, 60) : '';
    if (goal === 'promote_service' && service.length < 3) throw new RetentionError('Type at least 3 letters of the service to promote.', 'WINBACK_GOAL_INVALID');
    const k = await this.ret.window(ctx);
    const ids = await this.ret.matchingIds(ctx, goalFilters(goal, k.risk, service));
    const v = await this.seg.verdicts(ctx, ids, channel, 'win_back');
    const eligibleIds = ids.filter((id) => v.get(id)?.status === 'eligible');
    if (!eligibleIds.length) throw new RetentionError('No eligible customers match this win-back goal right now.', 'WINBACK_AUDIENCE_EMPTY', 409);
    // keep the excluded customers (and their reasons) in the draft when the audience fits; otherwise the eligible ones only
    const chosen = ids.length <= WINBACK_MAX_AUDIENCE ? ids : eligibleIds.slice(0, WINBACK_MAX_AUDIENCE);
    const message = typeof b.message === 'string' ? b.message.slice(0, 1000) : null;
    return this.seg.createDraft(ctx, { channel, purpose: 'win_back', selectionMode: 'selected', customerIds: chosen, filters: { segment: goal === 'inactive_risk' || goal === 'inactive_90' ? 'inactive' : 'all' },
      message, idempotencyKey: `winback:${key}` }, (trx, meta) => audit(trx, { ...meta, goal, assistant: true, ruleset: SEGMENTATION_VERSION }));
  }
}

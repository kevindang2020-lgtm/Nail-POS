/**
 * communications-activity.service.ts — the VOLUME/QUALITY metrics the Communications mockup asks for, each read from
 * a source that actually exists (Jul 28, 2026). The existing inbox KPIs are thread-centric (total/open/unread/
 * replied/missed); these are the activity ones:
 *
 *   Messages Sent Today   → communication_messages (outbound, today)          [migration 114]
 *   Campaign Delivery Rate→ campaign_delivery_rollups (delivered ÷ attempted) [241]
 *   AI Calls Handled      → voice_call_outcomes                               [299]
 *   Review Requests Sent  → review_requests (sent/delivered/converted)        [343]
 *   Avg Response Time     → communication_messages: inbound → next outbound in the same thread
 *
 * HONESTY (invariant §10): every metric carries `available`. A metric whose source has no rows reports
 * available:false with a REASON rather than a fabricated 0 or 100% — "0 messages sent" and "we don't have delivery
 * receipts" are different facts, and the second must not read as the first. Rebooking conversion (C2 audit, Nov 4 2026) is read
 * from the win-back campaigns' recipients (texted → booked within the observation window); before that it was reported unavailable: no source links a rebooking to the campaign that caused it (ai_revenue_attributions
 * covers AI-influenced revenue only), so it would have to be invented. Fail-soft throughout: a metric whose query
 * fails degrades to unavailable and never breaks the screen.
 */
import type { ActivityMetric } from '@aipowersalon/api-contracts/tenant';
export type { ActivityMetric };   // owned by packages/api-contracts (Constitution 13 §13)
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

export interface CommsActivity {
  windowDays: number;
  messagesSentToday: ActivityMetric;
  campaignDeliveryRatePct: ActivityMetric;
  aiCallsHandled: ActivityMetric;
  reviewRequestsSent: ActivityMetric;
  avgResponseMinutes: ActivityMetric;
  rebookingConversionPct: ActivityMetric;
}

const NA = (reason: string): ActivityMetric => ({ value: null, available: false, reason });
const OK = (value: number): ActivityMetric => ({ value, available: true });

/** delivered ÷ attempted as a whole percent. Zero attempts is NOT 0% — it's "nothing was sent". */
export function deliveryRatePct(attempted: number, delivered: number): ActivityMetric {
  if (!Number.isFinite(attempted) || attempted <= 0) return NA('No campaign messages have been attempted yet');
  const pct = Math.round((Math.max(0, Math.min(delivered, attempted)) / attempted) * 100);
  return OK(pct);
}

/**
 * Average first-response time in minutes: for each inbound message, the first OUTBOUND message after it in the same
 * thread. Threads still awaiting a reply contribute nothing (they are not a fast response OR a slow one — counting
 * them as either would lie); when nothing has been answered yet the metric is unavailable, not 0.
 */
export function avgFirstResponseMinutes(
  rows: { threadId: string; direction: string; createdAt: string | Date }[],
): ActivityMetric {
  const byThread = new Map<string, { t: number; dir: string }[]>();
  for (const r of rows) {
    const t = new Date(r.createdAt as any).getTime();
    if (!Number.isFinite(t)) continue;
    const list = byThread.get(r.threadId) ?? [];
    list.push({ t, dir: r.direction === 'outbound' ? 'outbound' : 'inbound' });
    byThread.set(r.threadId, list);
  }
  const gaps: number[] = [];
  for (const list of byThread.values()) {
    list.sort((a, b) => a.t - b.t);
    let pendingInbound: number | null = null;
    for (const m of list) {
      if (m.dir === 'inbound') { if (pendingInbound == null) pendingInbound = m.t; }
      else if (pendingInbound != null) { gaps.push((m.t - pendingInbound) / 60000); pendingInbound = null; }
    }
  }
  if (!gaps.length) return NA('No inbound message has been answered in this window yet');
  return OK(Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length));
}

export class CommunicationsActivityService {
  constructor(private readonly db: Kysely<DB> | null) {}

  private async rows<T>(text: ReturnType<typeof sql>): Promise<T[] | null> {
    if (!this.db) return null;
    try { const r = await text.execute(this.db); return ((r as any).rows || []) as T[]; } catch { return null; }
  }

  /** `branchIds`: null = the whole salon; else only these locations (C2 audit, Nov 4 2026 — the tiles counted the whole salon
   *  under a location filter). A source with no location (campaign delivery roll-ups) is then unavailable, never salon-wide. */
  async activity(tenantId: string, windowDays = 30, branchIds: string[] | null = null): Promise<CommsActivity & { branchIds: string[] | null }> {
    const days = Math.min(365, Math.max(1, Math.round(windowDays)));
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const unavailableDb = 'The source table could not be read';
    const br = branchIds && branchIds.length ? branchIds : null;
    const inBr = (col: ReturnType<typeof sql.ref>) => br ? sql`${col} = ANY(${br}::uuid[])` : sql`true`;
    const thr = br ? sql`AND EXISTS (SELECT 1 FROM communication_threads t WHERE t.tenant_id = m.tenant_id AND t.id = m.thread_id AND t.branch_id = ANY(${br}::uuid[]))` : sql``;

    // Communications guide §7/§11 (Oct 30 2026): "today" is the SALON's calendar day (its first branch's time zone), not
    // UTC — a 9 pm New York text no longer counts toward tomorrow. Only messages that actually left (or were reserved to
    // leave) count; refused / failed sends are not "sent".
    const tzRows = await this.rows<any>(sql`SELECT b.timezone FROM branches b WHERE b.tenant_id = ${tenantId} AND b.deleted_at IS NULL AND b.timezone IS NOT NULL ORDER BY b.created_at ASC LIMIT 1`);
    const tz = typeof tzRows?.[0]?.timezone === 'string' && tzRows[0].timezone ? String(tzRows[0].timezone) : 'America/New_York';
    const sent = await this.rows<any>(sql`
      SELECT count(*)::int AS n FROM communication_messages m
      WHERE m.tenant_id = ${tenantId} AND m.direction = 'outbound' AND m.status NOT IN ('failed', 'blocked') ${thr}
        AND m.created_at >= ((now() AT TIME ZONE ${tz})::date)::timestamp AT TIME ZONE ${tz}`);
    const roll = br ? null : await this.rows<any>(sql`
      SELECT COALESCE(SUM(attempted),0)::int AS attempted, COALESCE(SUM(delivered),0)::int AS delivered
      FROM campaign_delivery_rollups WHERE tenant_id = ${tenantId} AND subject_type = 'tenant_campaign'`);
    const calls = await this.rows<any>(sql`
      SELECT count(*)::int AS n FROM voice_call_outcomes
      WHERE tenant_id = ${tenantId} AND ${inBr(sql.ref('branch_id'))} AND COALESCE(started_at, created_at) >= ${since}`);
    const reviews = await this.rows<any>(sql`
      SELECT count(*)::int AS n FROM review_requests
      WHERE tenant_id = ${tenantId} AND ${inBr(sql.ref('branch_id'))} AND status IN ('sent','delivered','converted') AND created_at >= ${since}`);
    // Avg response = customer message → first STAFF reply that actually left (AI / automated replies and refused sends excluded)
    const msgs = await this.rows<any>(sql`
      SELECT m.thread_id, m.direction, m.created_at FROM communication_messages m
      WHERE m.tenant_id = ${tenantId} AND m.created_at >= ${since} ${thr}
        AND (m.direction = 'inbound' OR (COALESCE(m.author_kind, 'staff') = 'staff' AND m.status NOT IN ('failed', 'blocked', 'pending')))
      ORDER BY m.thread_id, m.created_at LIMIT 5000`);

    const rebook = await this.rows<any>(sql`
      WITH obs AS (SELECT coalesce((SELECT observation_window_days FROM tenant_retention_settings WHERE tenant_id = ${tenantId}), 30) AS d),
      texted AS (SELECT r.customer_id, min(r.sent_at) AS first_sent FROM retention_sms_recipients r
        WHERE r.tenant_id = ${tenantId} AND r.status = 'sent' AND r.sent_at >= ${since}
          ${br ? sql`AND EXISTS (SELECT 1 FROM retention_sms_campaigns c WHERE c.tenant_id = r.tenant_id AND c.id = r.campaign_id AND c.branch_id = ANY(${br}::uuid[]))` : sql``}
        GROUP BY r.customer_id)
      SELECT count(*)::int AS texted,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pos_tech_appointments a, obs WHERE a.tenant_id = ${tenantId} AND a.customer_id = x.customer_id
          AND a.created_at > x.first_sent AND a.created_at < x.first_sent + make_interval(days => obs.d)))::int AS booked
      FROM texted x`);
    return {
      windowDays: days, branchIds: br,
      messagesSentToday: sent ? OK(Number(sent[0]?.n ?? 0)) : NA(unavailableDb),
      campaignDeliveryRatePct: br ? NA('Campaign delivery is recorded for the whole salon, not per location') : roll ? deliveryRatePct(Number(roll[0]?.attempted ?? 0), Number(roll[0]?.delivered ?? 0)) : NA(unavailableDb),
      aiCallsHandled: calls ? OK(Number(calls[0]?.n ?? 0)) : NA(unavailableDb),
      reviewRequestsSent: reviews ? OK(Number(reviews[0]?.n ?? 0)) : NA(unavailableDb),
      avgResponseMinutes: msgs
        ? avgFirstResponseMinutes(msgs.map((m: any) => ({ threadId: String(m.thread_id), direction: String(m.direction), createdAt: m.created_at })))
        : NA(unavailableDb),
      // C2 audit (Nov 4 2026): the win-back campaigns are the outreach that records who was texted and when — conversion =
      // customers texted by a win-back campaign in this window who booked within the salon's observation window after the text
      rebookingConversionPct: rebook ? (Number(rebook[0]?.texted ?? 0) === 0 ? NA('No win-back texts were sent in this window')
        : OK(Math.round((Number(rebook[0]?.booked ?? 0) / Number(rebook[0]?.texted)) * 1000) / 10)) : NA(unavailableDb),
    };
  }
}

// ai-business-branch-freshness.ts — Extras · AI BRANCH COMPARISON 11 (round 10): per-branch freshness for the comparison.
// For each compared branch: the newest checkout and booking activity recorded there, and that branch's own undelivered
// events (the outbox feeding reports and live screens) with the oldest lag — so one branch whose sync is behind is named
// instead of the page showing one freshness for everything. Read-only.
// (Staffing / opening-hours normalisation is NOT here: the Branch Scorecard — branch-insights.ts — already computes
// technician hours and operating hours per branch, and the comparison's branch detail reads it from there.)
import { sql, type Kysely } from 'kysely';

/** the newest checkout and booking activity recorded for the branch, and its undelivered events */
export interface BranchFreshness { lastTicketAt: string | null; lastBookingAt: string | null; eventsWaiting: number; oldestEventLagSeconds: number | null; delayed: boolean }
export interface BranchFreshnessSource { freshness(tenantId: string, branchIds: string[], now?: Date): Promise<Record<string, BranchFreshness>> }
export const BRANCH_EVENT_LAG_DELAYED_SECONDS = 15 * 60;

export async function branchFreshness(db: Kysely<any>, tenantId: string, branchIds: string[], now: Date = new Date()): Promise<Record<string, BranchFreshness>> {
  const out: Record<string, BranchFreshness> = {};
  if (!branchIds.length) return out;
  const tk = (await sql<{ b: string; at: string | null }>`select t.branch_id::text as b, max(coalesce(t.paid_at, t.created_at)) as at from tickets t where t.tenant_id = ${tenantId} and t.branch_id = any(${branchIds}::uuid[]) group by 1`.execute(db)).rows;
  const ap = (await sql<{ b: string; at: string | null }>`select a.branch_id::text as b, max(a.created_at) as at from pos_tech_appointments a where a.tenant_id = ${tenantId} and a.branch_id = any(${branchIds}::uuid[]) group by 1`.execute(db)).rows;
  const ev = (await sql<{ b: string; n: number; oldest: string | null }>`select o.branch_id::text as b, count(*)::int as n, min(o.occurred_at) as oldest from outbox_events o
    where o.tenant_id = ${tenantId} and o.branch_id = any(${branchIds}::uuid[]) and o.publish_status in ('pending', 'claimed', 'failed') group by 1`.execute(db)).rows;
  const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
  for (const b of branchIds) {
    const e = ev.find((x) => x.b === b);
    const lag = e?.oldest ? Math.max(0, Math.round((now.getTime() - new Date(e.oldest).getTime()) / 1000)) : null;
    out[b] = { lastTicketAt: iso(tk.find((x) => x.b === b)?.at), lastBookingAt: iso(ap.find((x) => x.b === b)?.at), eventsWaiting: Number(e?.n ?? 0), oldestEventLagSeconds: lag,
      delayed: lag != null && lag > BRANCH_EVENT_LAG_DELAYED_SECONDS };
  }
  return out;
}

export class KyselyBranchFreshness implements BranchFreshnessSource {
  constructor(private readonly db: Kysely<any>) {}
  freshness(tenantId: string, branchIds: string[], now: Date = new Date()) { return branchFreshness(this.db, tenantId, branchIds, now); }
}

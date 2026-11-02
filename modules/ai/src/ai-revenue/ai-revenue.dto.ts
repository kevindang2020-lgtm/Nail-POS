import type { AiRevenueSummary } from '@aipowersalon/api-contracts/tenant';
export type { AiRevenueSummary };   // owned by packages/api-contracts (Constitution 13 §13)
/**
 * ai-revenue.dto.ts — AI revenue attribution contract + pure math. Records revenue an AI assistant influenced and
 * keeps it cleanly separate from booked/collected revenue (spec §35, §53). Idempotent on dedupeKey. Money is integer cents.
 */
export type RevenueKind = 'upsell' | 'add_on' | 'rebooking' | 'retail' | 'membership' | 'upgrade';

export interface RevenueAttributionInput {
  tenantId: string; branchId?: string | null; dedupeKey: string; source: string; kind?: RevenueKind;
  ticketId?: string | null; ticketServiceLineId?: string | null; customerId?: string | null;
  amountCents: number; acceptedAt?: string;
}
export interface RevenueAttributionRow extends RevenueAttributionInput { id: string; kind: RevenueKind; acceptedAt: string }


const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const within = (iso: string, days: number, now: Date) => (now.getTime() - new Date(iso).getTime()) <= days * 86400000;

export function summarizeRevenue(rows: RevenueAttributionRow[], now: Date = new Date()): AiRevenueSummary {
  const todayStr = now.toISOString().slice(0, 10);
  const today = rows.filter((r) => day(r.acceptedAt) === todayStr);
  const byKindToday: Record<string, number> = {};
  for (const r of today) byKindToday[r.kind] = (byKindToday[r.kind] ?? 0) + (r.amountCents || 0);
  return {
    todayCents: today.reduce((a, r) => a + (r.amountCents || 0), 0),
    weekCents: rows.filter((r) => within(r.acceptedAt, 7, now)).reduce((a, r) => a + (r.amountCents || 0), 0),
    byKindToday,
  };
}

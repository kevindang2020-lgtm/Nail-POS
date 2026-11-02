// website-leads-core.ts — pure logic for the Super-Admin Website Leads page: KPI rollup (with real month-over-month
// trends from created_at), filtering, pagination, source/status analytics, top sources, and lead scoring. No I/O —
// everything here is unit-tested and reused by the service over either the in-memory or Postgres repo.

export const LEAD_SOURCES = ['website_form', 'live_chat', 'instagram', 'facebook_ads', 'google_ads', 'referral', 'manual', 'phone', 'email'] as const;
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'unqualified', 'lost', 'spam', 'archived'] as const;

export interface LeadRow {
  id: string; salonName: string | null; contactName: string | null; phone: string | null; email: string | null;
  city: string | null; state: string | null; source: string | null; leadScore: number | null; status: string;
  message: string | null; currentPos: string | null; technicianCount: number | null; monthlyCardVolumeCents: number | null;
  assignedToUserId: string | null; assignedToName: string | null; nextFollowUpAt: string | null;
  convertedApplicationId: string | null; createdAt: string; updatedAt: string;
}

const PIPELINE_STATUSES = new Set(['new', 'contacted', 'qualified', 'converted']);
const isCounted = (s: string) => s !== 'spam' && s !== 'archived';

// ---- month helpers (UTC) for honest MoM trends ----
const ym = (iso: string) => { const d = new Date(iso); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
function monthIndexes(now: Date) { const cur = now.getUTCFullYear() * 12 + now.getUTCMonth(); return { cur, prev: cur - 1 }; }
function pctDelta(curr: number, prev: number): number {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

export interface LeadKpis {
  totalLeads: number; newLeads: number; contacted: number; qualified: number; converted: number; conversionRatePct: number;
  trends: { totalLeads: number; newLeads: number; contacted: number; qualified: number; converted: number; conversionRatePct: number };
}

export function computeLeadKpis(rows: LeadRow[], now: Date = new Date()): LeadKpis {
  const counted = rows.filter((r) => isCounted(r.status));
  const by = (s: string) => counted.filter((r) => r.status === s).length;
  const totalLeads = counted.length;
  const converted = by('converted');
  const conversionRatePct = totalLeads === 0 ? 0 : Math.round((converted / totalLeads) * 10000) / 100;

  const { cur, prev } = monthIndexes(now);
  const inMonth = (m: number, pred: (r: LeadRow) => boolean) => counted.filter((r) => ym(r.createdAt) === m && pred(r)).length;
  const trendFor = (pred: (r: LeadRow) => boolean) => pctDelta(inMonth(cur, pred), inMonth(prev, pred));
  const curTotal = inMonth(cur, () => true), prevTotal = inMonth(prev, () => true);
  const curConvRate = curTotal === 0 ? 0 : inMonth(cur, (r) => r.status === 'converted') / curTotal;
  const prevConvRate = prevTotal === 0 ? 0 : inMonth(prev, (r) => r.status === 'converted') / prevTotal;

  return {
    totalLeads, newLeads: by('new'), contacted: by('contacted'), qualified: by('qualified'), converted, conversionRatePct,
    trends: {
      totalLeads: trendFor(() => true), newLeads: trendFor((r) => r.status === 'new'), contacted: trendFor((r) => r.status === 'contacted'),
      qualified: trendFor((r) => r.status === 'qualified'), converted: trendFor((r) => r.status === 'converted'),
      conversionRatePct: pctDelta(Math.round(curConvRate * 1000), Math.round(prevConvRate * 1000)),
    },
  };
}

// ---- scoring ----
export type ScoreBand = 'hot' | 'warm' | 'cold' | 'none';
export function scoreBand(score: number | null | undefined): ScoreBand {
  if (score == null || score <= 0) return 'none';
  if (score >= 80) return 'hot';
  if (score >= 50) return 'warm';
  return 'cold';
}

/** Deterministic 0–100 lead score from the signals we capture. Editable weighting. */
export function computeLeadScore(lead: Partial<LeadRow>): number {
  let s = 0;
  const vol = lead.monthlyCardVolumeCents ?? 0;
  if (vol >= 5_000_000) s += 30; else if (vol >= 2_000_000) s += 20; else if (vol >= 1_000_000) s += 10;
  const techs = lead.technicianCount ?? 0;
  if (techs >= 8) s += 15; else if (techs >= 4) s += 10; else if (techs >= 1) s += 5;
  if (lead.phone && lead.email) s += 10;
  if ((lead.message?.length ?? 0) > 40) s += 10;
  const src = lead.source ?? '';
  if (src === 'referral') s += 20; else if (src === 'website_form') s += 12; else if (src === 'google_ads' || src === 'facebook_ads') s += 8; else if (src === 'instagram') s += 5;
  return Math.max(0, Math.min(100, s));
}

// ---- filtering / pagination ----
export interface LeadFilter { search?: string; source?: string; status?: string; scoreRange?: string; dateFrom?: string; dateTo?: string }
export function filterLeads(rows: LeadRow[], f: LeadFilter): LeadRow[] {
  const q = (f.search ?? '').trim().toLowerCase();
  return rows.filter((r) => {
    if (f.source && f.source !== 'all' && r.source !== f.source) return false;
    if (f.status && f.status !== 'all' && r.status !== f.status) return false;
    if (f.scoreRange && f.scoreRange !== 'all') {
      const b = scoreBand(r.leadScore);
      if (f.scoreRange === 'hot' && b !== 'hot') return false;
      if (f.scoreRange === 'warm' && b !== 'warm') return false;
      if (f.scoreRange === 'cold' && b !== 'cold') return false;
      if (f.scoreRange === 'none' && b !== 'none') return false;
    }
    if (f.dateFrom || f.dateTo) {
      const d = r.createdAt.slice(0, 10);                 // compare on calendar day, not timestamp
      const from = f.dateFrom ? f.dateFrom.slice(0, 10) : undefined;
      const to = f.dateTo ? f.dateTo.slice(0, 10) : undefined;
      if (from && d < from) return false;
      if (to && d > to) return false;                     // inclusive of the end day
    }
    if (q) {
      const hay = [r.salonName, r.contactName, r.email, r.phone].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function paginate<T>(rows: T[], page = 1, limit = 10): { items: T[]; pagination: { page: number; limit: number; totalItems: number; totalPages: number } } {
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const p = Math.min(Math.max(1, page), totalPages);
  return { items: rows.slice((p - 1) * limit, (p - 1) * limit + limit), pagination: { page: p, limit, totalItems, totalPages } };
}

// ---- analytics ----
export function analyticsBySource(rows: LeadRow[]): { source: string; count: number; pct: number }[] {
  const counted = rows.filter((r) => isCounted(r.status));
  const total = counted.length || 1;
  const m = new Map<string, number>();
  for (const r of counted) { const k = r.source || 'manual'; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].map(([source, count]) => ({ source, count, pct: Math.round((count / total) * 1000) / 10 })).sort((a, b) => b.count - a.count);
}
export function analyticsByStatus(rows: LeadRow[]): { status: string; count: number; pct: number }[] {
  const counted = rows.filter((r) => isCounted(r.status));
  const total = counted.length || 1;
  return ['new', 'contacted', 'qualified', 'converted'].map((status) => { const count = counted.filter((r) => r.status === status).length; return { status, count, pct: Math.round((count / total) * 1000) / 10 }; });
}
export function topSources(rows: LeadRow[], now: Date = new Date()): { rank: number; source: string; count: number; growthPct: number }[] {
  const counted = rows.filter((r) => isCounted(r.status));
  const { cur, prev } = monthIndexes(now);
  const m = new Map<string, number>();
  for (const r of counted) { const k = r.source || 'manual'; m.set(k, (m.get(k) ?? 0) + 1); }
  const growth = (src: string) => pctDelta(counted.filter((r) => r.source === src && ym(r.createdAt) === cur).length, counted.filter((r) => r.source === src && ym(r.createdAt) === prev).length);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([source, count], i) => ({ rank: i + 1, source, count, growthPct: growth(source) }));
}

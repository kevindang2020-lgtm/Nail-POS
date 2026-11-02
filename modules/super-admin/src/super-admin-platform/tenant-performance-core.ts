// tenant-performance-core.ts — PURE search/filter/sort/paginate/summary for the Tenant Performance report.
// Operates on the already-computed ranked rows (real per-tenant volume/growth from payments), so there is no
// duplicate calc and no DB dependency here — fully unit-testable. Powers GET /super-admin/platform/tenant-performance.

export interface PerfRow {
  rank: number; tenantId: string; tenantName: string; city: string | null; state: string | null;
  plan: string | null; status: string | null; monthlyCardVolumeCents: number; priorMonthVolumeCents: number;
  growthPercent: number | null; transactionCount: number; averageTicketCents: number;
}

export interface PerfQuery {
  search?: string; state?: string; status?: string; plan?: string;
  minVolume?: number; maxVolume?: number;            // in cents
  growthDirection?: 'positive' | 'negative' | 'new';
  sortBy?: string; sortDirection?: 'asc' | 'desc';
  page?: number; limit?: number;
}

const SORT_KEYS: Record<string, keyof PerfRow> = {
  rank: 'rank', salonName: 'tenantName', tenantName: 'tenantName',
  monthlyCardVolume: 'monthlyCardVolumeCents', monthlyCardVolumeCents: 'monthlyCardVolumeCents',
  transactionCount: 'transactionCount', averageTicket: 'averageTicketCents', averageTicketCents: 'averageTicketCents',
  growth: 'growthPercent', growthPercent: 'growthPercent', lastActive: 'rank',
};

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v); return Number.isFinite(n) ? n : undefined;
};

export function normalizePerfQuery(q: Record<string, unknown> = {}): Required<Pick<PerfQuery, 'page' | 'limit' | 'sortDirection'>> & PerfQuery {
  const page = Math.max(1, Math.floor(num(q.page) ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(num(q.limit) ?? 10)));
  const sortDirection = String(q.sortDirection).toLowerCase() === 'asc' ? 'asc' : 'desc';
  const gd = String(q.growthDirection || '').toLowerCase();
  return {
    search: q.search ? String(q.search) : undefined,
    state: q.state ? String(q.state) : undefined,
    status: q.status ? String(q.status) : undefined,
    plan: q.plan ? String(q.plan) : undefined,
    minVolume: num(q.minVolume),
    maxVolume: num(q.maxVolume),
    growthDirection: gd === 'positive' || gd === 'negative' || gd === 'new' ? (gd as any) : undefined,
    sortBy: q.sortBy ? String(q.sortBy) : 'monthlyCardVolume',
    sortDirection,
    page,
    limit,
  };
}

export function filterPerf(rows: PerfRow[], q: PerfQuery): PerfRow[] {
  let out = rows.slice();
  if (q.search && q.search.trim()) {
    const t = q.search.trim().toLowerCase();
    out = out.filter((r) => [r.tenantName, r.city, r.state, r.plan, r.status].some((v) => (v || '').toLowerCase().includes(t)));
  }
  if (q.state) out = out.filter((r) => (r.state || '').toLowerCase() === q.state!.toLowerCase());
  if (q.status) out = out.filter((r) => (r.status || '').toLowerCase() === q.status!.toLowerCase());
  if (q.plan) out = out.filter((r) => (r.plan || '').toLowerCase() === q.plan!.toLowerCase());
  if (q.minVolume !== undefined) out = out.filter((r) => r.monthlyCardVolumeCents >= q.minVolume!);
  if (q.maxVolume !== undefined) out = out.filter((r) => r.monthlyCardVolumeCents <= q.maxVolume!);
  if (q.growthDirection === 'positive') out = out.filter((r) => r.growthPercent != null && r.growthPercent >= 0);
  else if (q.growthDirection === 'negative') out = out.filter((r) => r.growthPercent != null && r.growthPercent < 0);
  else if (q.growthDirection === 'new') out = out.filter((r) => r.growthPercent == null);
  return out;
}

export function sortPerf(rows: PerfRow[], sortBy?: string, sortDirection: 'asc' | 'desc' = 'desc'): PerfRow[] {
  const key = SORT_KEYS[sortBy || 'monthlyCardVolume'] || 'monthlyCardVolumeCents';
  const dir = sortDirection === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const x = a[key] as any, y = b[key] as any;
    // nulls (e.g. growthPercent "new") always sort last regardless of direction
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

export function summarizePerf(rows: PerfRow[]) {
  const cur = rows.reduce((a, r) => a + r.monthlyCardVolumeCents, 0);
  const prior = rows.reduce((a, r) => a + r.priorMonthVolumeCents, 0);
  const txn = rows.reduce((a, r) => a + r.transactionCount, 0);
  const withVol = rows.filter((r) => r.monthlyCardVolumeCents > 0);
  const top = rows.reduce((m, r) => Math.max(m, r.monthlyCardVolumeCents), 0);
  return {
    totalVolumeCents: cur,
    totalTransactions: txn,
    averageTenantVolumeCents: withVol.length ? Math.round(cur / withVol.length) : 0,
    topTenantVolumeCents: top,
    momGrowthPercent: prior > 0 ? Math.round(((cur - prior) / prior) * 1000) / 10 : null,
    activeTenantsIncluded: withVol.length,
  };
}

export function applyPerformanceQuery(rows: PerfRow[], raw: Record<string, unknown> = {}) {
  const q = normalizePerfQuery(raw);
  const filtered = sortPerf(filterPerf(rows, q), q.sortBy, q.sortDirection);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / q.limit));
  const page = Math.min(q.page, totalPages);
  const start = (page - 1) * q.limit;
  return {
    rows: filtered.slice(start, start + q.limit),
    total,
    page,
    pageSize: q.limit,
    totalPages,
    summary: summarizePerf(filtered),   // summary reflects the full filtered set, not just the page
  };
}

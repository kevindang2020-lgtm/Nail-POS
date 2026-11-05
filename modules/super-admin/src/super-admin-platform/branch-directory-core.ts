/**
 * branch-directory-core.ts — pure, DB-free helpers for the server-side All Branches Directory endpoint.
 *
 * The repository computes the enriched per-branch directory once (reusing the verified branchesDashboard aggregate)
 * and then applies these helpers to normalize the request, filter/search/sort, and paginate SERVER-SIDE so the client
 * receives only the requested page. Keeping this logic pure means it is unit-tested without a database (the SQL that
 * produces the rows is exercised by the live smoke), matching the project's *-core.ts testing pattern.
 */

export interface BranchDirRow {
  id: string; name: string; tenantId: string; tenantName: string | null;
  address?: string | null; city: string | null; state: string | null; zip?: string | null; phone?: string | null;
  latitude?: number | null; longitude?: number | null;
  status: string; manager: string | null;
  staff: number; todaysAppts: number; revenueMtdCents: number; devices: number | null;
  openTickets: number; queueWaiting: number; healthScore: number | null;
}

export type BranchSortKey = 'name' | 'tenantName' | 'city' | 'status' | 'staff' | 'todaysAppts' | 'revenueMtdCents' | 'healthScore' | 'queueWaiting' | 'openTickets';
const SORT_KEYS: BranchSortKey[] = ['name', 'tenantName', 'city', 'status', 'staff', 'todaysAppts', 'revenueMtdCents', 'healthScore', 'queueWaiting', 'openTickets'];

export interface BranchDirQuery {
  page: number; pageSize: number; search: string;
  status?: string; tenant?: string; city?: string;
  healthMin?: number; healthMax?: number;
  sort: BranchSortKey; dir: 'asc' | 'desc';
}

const toInt = (v: unknown, d: number): number => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : d; };
const toNum = (v: unknown): number | undefined => { if (v === undefined || v === null || v === '') return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

/** Normalize + validate raw query params (defensive: clamps paging, whitelists sort, lowercases search/status). */
export function normalizeBranchQuery(raw: Record<string, unknown> | undefined): BranchDirQuery {
  const r = raw || {};
  const sortRaw = String(r.sort ?? 'revenueMtdCents') as BranchSortKey;
  const sort = SORT_KEYS.includes(sortRaw) ? sortRaw : 'revenueMtdCents';
  const dir = String(r.dir ?? r.direction ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  return {
    page: Math.max(1, toInt(r.page, 1)),
    pageSize: clamp(toInt(r.pageSize, 10), 1, 100),
    search: String(r.search ?? '').trim().toLowerCase(),
    status: r.status ? String(r.status).toLowerCase() : undefined,
    tenant: r.tenant ? String(r.tenant) : (r.tenantId ? String(r.tenantId) : undefined),
    city: r.city ? String(r.city) : undefined,
    healthMin: toNum(r.healthMin),
    healthMax: toNum(r.healthMax),
    sort, dir,
  };
}

/** Apply filters + search (name/tenant/manager/city/id) to the full directory. */
export function filterBranches(rows: BranchDirRow[], q: BranchDirQuery): BranchDirRow[] {
  return rows.filter((b) => {
    if (q.status && (b.status || '').toLowerCase() !== q.status) return false;
    if (q.tenant && b.tenantName !== q.tenant && b.tenantId !== q.tenant) return false;
    if (q.city && b.city !== q.city) return false;
    if (q.healthMin != null && (b.healthScore == null || b.healthScore < q.healthMin)) return false;
    if (q.healthMax != null && (b.healthScore == null || b.healthScore > q.healthMax)) return false;
    if (q.search) {
      const hay = [b.name, b.tenantName, b.manager, b.city, b.id].map((x) => (x || '').toLowerCase());
      if (!hay.some((h) => h.includes(q.search))) return false;
    }
    return true;
  });
}

/** Stable sort by the requested key; nulls sort last regardless of direction. */
export function sortBranches(rows: BranchDirRow[], sort: BranchSortKey, dir: 'asc' | 'desc'): BranchDirRow[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sort] as string | number | null, bv = b[sort] as string | number | null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // nulls last
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
    return String(av).localeCompare(String(bv)) * mul;
  });
}

export interface BranchDirPage {
  rows: BranchDirRow[]; total: number; page: number; pageSize: number; pages: number;
  facets: { statuses: string[]; tenants: string[]; cities: string[] };
}

/** Full server-side pipeline: facets from the unfiltered set, then filter → sort → paginate. */
export function paginateBranches(all: BranchDirRow[], q: BranchDirQuery): BranchDirPage {
  const facets = {
    statuses: Array.from(new Set(all.map((b) => (b.status || '').toLowerCase()).filter(Boolean))).sort(),
    tenants: Array.from(new Set(all.map((b) => b.tenantName).filter(Boolean))).sort() as string[],
    cities: Array.from(new Set(all.map((b) => b.city).filter(Boolean))).sort() as string[],
  };
  const filtered = sortBranches(filterBranches(all, q), q.sort, q.dir);
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / q.pageSize));
  const page = Math.min(q.page, pages);
  const rows = filtered.slice((page - 1) * q.pageSize, page * q.pageSize);
  return { rows, total, page, pageSize: q.pageSize, pages, facets };
}

// owner-staff-paging.ts — 200-technician mandate §62 / §69 / §71 (Oct 26 2026). PURE: search, sort and page the Owner
// App's per-technician performance rows (built from the server's SQL aggregates). 200 is a certification target, not a
// maximum: page sizes are bounded, never "all".
import type { OwnerStaffPerformancePage, OwnerStaffPerformanceRow, OwnerStaffPerformanceSort } from '@aipowersalon/api-contracts/tenant';

export const OWNER_STAFF_PAGE_SIZE = 20;
export const OWNER_STAFF_PAGE_SIZE_MAX = 100;
const SORTS: OwnerStaffPerformanceSort[] = ['sales', 'services', 'utilization', 'rating', 'commission', 'name'];
const KEY: Record<Exclude<OwnerStaffPerformanceSort, 'name'>, keyof OwnerStaffPerformanceRow> = {
  sales: 'salesCents', services: 'servicesCompleted', utilization: 'utilizationPercent', rating: 'rating', commission: 'commissionCents',
};

export function pageStaffRows(rows: OwnerStaffPerformanceRow[], period: { from: string; to: string },
  q: { search?: string; sort?: string; dir?: string; page?: number | string; pageSize?: number | string } = {}): OwnerStaffPerformancePage {
  // the canonical list form "-sales" / "+name" (packages/api-contracts list-query) and the plain sort + dir both work
  const rawSort = String(q.sort ?? ''); const signed = /^[-+]/.test(rawSort) ? (rawSort[0] === '-' ? 'desc' : 'asc') : null;
  const sort: OwnerStaffPerformanceSort = SORTS.includes(rawSort.replace(/^[-+]/, '') as OwnerStaffPerformanceSort) ? (rawSort.replace(/^[-+]/, '') as OwnerStaffPerformanceSort) : 'sales';
  const dir: 'asc' | 'desc' = q.dir === 'asc' || q.dir === 'desc' ? q.dir : signed ?? (sort === 'name' ? 'asc' : 'desc');
  const term = String(q.search ?? '').trim().toLowerCase().slice(0, 80);
  const rank = /^#(\d+)$/.exec(term);
  const hit = rows.filter((r) => !term || (rank ? r.rank === Number(rank[1]) : r.fullName.toLowerCase().includes(term)));
  const sign = dir === 'asc' ? 1 : -1;
  const sorted = hit.slice().sort((a, b) => {
    const c = sort === 'name' ? a.fullName.localeCompare(b.fullName) : (Number(a[KEY[sort]]) - Number(b[KEY[sort]]));
    return c !== 0 ? c * sign : a.rank - b.rank;   // ties: the sales rank, so the order is stable
  });
  const pageSize = Math.min(OWNER_STAFF_PAGE_SIZE_MAX, Math.max(1, Math.trunc(Number(q.pageSize)) || OWNER_STAFF_PAGE_SIZE));
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(Number(q.page)) || 1), totalPages);
  return { period, items: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length, totalAll: rows.length, page, pageSize, totalPages, sort, dir };
}

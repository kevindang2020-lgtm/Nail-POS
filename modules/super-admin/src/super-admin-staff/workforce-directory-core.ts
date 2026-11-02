/**
 * workforce-directory-core.ts — pure, DB-free normalization for the server-side workforce directory query.
 *
 * The directory is a real paginated SQL query over `users` (workers can number thousands), so filtering/sorting/paging
 * happen in SQL. This module only sanitizes the incoming query: clamps page/pageSize, whitelists sort keys, lowercases
 * search/filters, and maps a role-category filter to the underlying roles. Keeping it pure makes the safety guarantees
 * (no arbitrary sort column, bounded page size) unit-testable without a database.
 */

export type WorkforceSortKey = 'name' | 'role' | 'tenantName' | 'branchName' | 'status' | 'lastActivity' | 'createdAt';
const SORT_KEYS: WorkforceSortKey[] = ['name', 'role', 'tenantName', 'branchName', 'status', 'lastActivity', 'createdAt'];

export type RoleCategoryFilter = 'technician' | 'receptionist' | 'manager' | '';
const ROLE_CATEGORY_TO_ROLES: Record<Exclude<RoleCategoryFilter, ''>, string[]> = {
  technician: ['TECHNICIAN'],
  receptionist: ['RECEPTION', 'FRONT_DESK'],
  manager: ['MANAGER', 'OWNER'],
};

export interface WorkforceQuery {
  page: number; pageSize: number; search: string;
  roleCategory: RoleCategoryFilter; roles: string[];
  tenantId?: string; branchId?: string; status?: string;
  sort: WorkforceSortKey; dir: 'asc' | 'desc';
}

const toInt = (v: unknown, d: number): number => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : d; };
const s = (v: unknown): string => (v == null ? '' : String(v)).trim();

export function normalizeWorkforceQuery(raw: Record<string, unknown> | undefined): WorkforceQuery {
  const r = raw || {};
  const page = Math.max(1, toInt(r.page, 1));
  const pageSize = Math.min(100, Math.max(1, toInt(r.pageSize, 10)));
  const sortRaw = s(r.sort) as WorkforceSortKey;
  const sort = SORT_KEYS.includes(sortRaw) ? sortRaw : 'name';
  const dir = s(r.dir).toLowerCase() === 'desc' ? 'desc' : 'asc';
  const rcRaw = s(r.role || r.roleCategory).toLowerCase();
  const roleCategory: RoleCategoryFilter = (rcRaw === 'technician' || rcRaw === 'receptionist' || rcRaw === 'manager') ? rcRaw : '';
  const roles = roleCategory ? ROLE_CATEGORY_TO_ROLES[roleCategory] : [];
  const statusRaw = s(r.status).toLowerCase();
  return {
    page, pageSize,
    search: s(r.search).toLowerCase().slice(0, 120),
    roleCategory, roles,
    tenantId: s(r.tenantId) || undefined,
    branchId: s(r.branchId) || undefined,
    status: statusRaw || undefined,
    sort, dir,
  };
}

/** SQL column for a sort key (whitelisted; never interpolates user input). */
export const SORT_COLUMN: Record<WorkforceSortKey, string> = {
  name: 'u.full_name', role: 'u.role', tenantName: 't.display_name', branchName: 'b.name',
  status: 'u.status', lastActivity: 'u.last_login_at', createdAt: 'u.created_at',
};

export function pagesFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

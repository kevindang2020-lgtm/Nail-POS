// finance-scope.ts — the shared request scope of the three Payments & Money one-screen pages (Oct 29 2026 mandates:
// Deposits & Settlements, AI Deposit Reconciliation, Invoices): the salon-local reporting period, the page window, the
// search text, money parsing and the one error type the controllers turn into registered codes.
//
// PERIOD (every spec's calendar section): presets Today / This Week (Monday–Sunday) / This Month / This Year are computed
// on the SERVER in the salon's time zone; a Custom Range is two whole inclusive local dates. A timestamp column is compared
// start-inclusive / day-after-end exclusive — [from 00:00 local, (to + 1 day) 00:00 local) — so the whole end day is in and
// a DST change moves nothing. A DATE column (expected deposit date, bank posted date, invoice issue / due date) is compared
// as dates: from <= d <= to. The resolved period is returned with every answer so the page shows what was filtered.
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { isValidTimeZone } from '@aipowersalon/database';
export { isValidTimeZone };

export type Preset = 'today' | 'week' | 'month' | 'year' | 'custom' | 'all';
export const PRESETS: readonly Preset[] = ['today', 'week', 'month', 'year', 'custom', 'all'];
export const DEFAULT_TIME_ZONE = 'America/New_York';
export const MAX_RANGE_DAYS = 3700;   // ten years and change — beyond that, export
export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 50;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const N = (v: unknown): number => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
export const iso = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
/** A DATE column as 'YYYY-MM-DD' (node-postgres hands a DATE back as a local-midnight Date; a string keeps its prefix). */
export const ymd = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  if (v instanceof Date) { if (Number.isNaN(v.getTime())) return null; const p = (n: number) => String(n).padStart(2, '0'); return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`; }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v)); return m ? m[1] : null;
};

export interface FinanceCtx { tenantId: string; branchId?: string; userId: string; role: string; permissions: string[] }

/** A refusal with a registered code (packages/api-contracts ERROR_REGISTRY) — the controllers map it to the HTTP answer. */
export class FinanceError extends Error {
  constructor(message: string, readonly code: string, readonly status: 400 | 403 | 404 | 409 | 503 = 400, readonly details?: Record<string, unknown>) {
    super(message); this.name = 'FinanceError';
  }
}

export function isValidYmd(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = YMD.exec(s); if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
const dayNo = (s: string) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86_400_000);
const fromDayNo = (n: number) => { const t = new Date(n * 86_400_000); const p = (x: number) => String(x).padStart(2, '0'); return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`; };
export const addDaysYmd = (s: string, days: number) => fromDayNo(dayNo(s) + days);
export const daysBetween = (a: string, b: string) => dayNo(b) - dayNo(a);

/** The salon's time zone: its first live branch with a valid zone (the same rule as tenantTimeZone), else the default. */
export async function salonTimeZone(db: Kysely<any>, tenantId: string): Promise<string> {
  const r = await sql<{ timezone: string | null }>`select timezone from branches where tenant_id = ${tenantId} and deleted_at is null order by created_at asc limit 5`.execute(db);
  return r.rows.map((x) => x.timezone).find(isValidTimeZone) ?? DEFAULT_TIME_ZONE;
}
/** Today's date in a time zone (from the server clock — never the browser's). */
export function todayIn(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export interface Period { preset: Preset; from: string | null; to: string | null; tz: string; today: string }

/** Resolve ?preset=…&from=…&to=… into whole local dates. 'all' (no bounds) is offered only where a page says so. */
export function resolvePeriod(q: { preset?: unknown; from?: unknown; to?: unknown }, tz: string, opts: { defaultPreset?: Preset; allowAll?: boolean; now?: Date } = {}): Period {
  const today = todayIn(tz, opts.now);
  const raw = typeof q.preset === 'string' && q.preset ? q.preset : (q.from || q.to ? 'custom' : (opts.defaultPreset ?? 'month'));
  if (!PRESETS.includes(raw as Preset)) throw new FinanceError('Choose Today, This Week, This Month, This Year or a custom range.', 'VALIDATION_FAILED', 400, { field: 'preset' });
  const preset = raw as Preset;
  if (preset === 'all') {
    if (!opts.allowAll) throw new FinanceError('Choose a reporting period.', 'VALIDATION_FAILED', 400, { field: 'preset' });
    return { preset, from: null, to: null, tz, today };
  }
  if (preset === 'custom') {
    const from = typeof q.from === 'string' ? q.from.trim() : '', to = typeof q.to === 'string' ? q.to.trim() : '';
    if (!isValidYmd(from) || !isValidYmd(to)) throw new FinanceError('Enter a valid date.', 'DATE_INVALID', 400, { field: !isValidYmd(from) ? 'from' : 'to' });
    if (to < from) throw new FinanceError('The start date must be on or before the end date.', 'DATE_RANGE_INVALID', 400);
    if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new FinanceError('That date range is too long. Choose a shorter range or export it.', 'DATE_RANGE_TOO_LARGE', 400);
    return { preset, from, to, tz, today };
  }
  const y = today.slice(0, 4), m = today.slice(5, 7);
  if (preset === 'today') return { preset, from: today, to: today, tz, today };
  if (preset === 'week') {
    const dow = new Date(Date.UTC(+y, +m - 1, +today.slice(8, 10))).getUTCDay();   // 0 = Sunday
    const from = addDaysYmd(today, -((dow + 6) % 7));
    return { preset, from, to: addDaysYmd(from, 6), tz, today };
  }
  if (preset === 'month') {
    const last = new Date(Date.UTC(+y, +m, 0)).getUTCDate();
    return { preset, from: `${y}-${m}-01`, to: `${y}-${m}-${String(last).padStart(2, '0')}`, tz, today };
  }
  return { preset, from: `${y}-01-01`, to: `${y}-12-31`, tz, today };
}

/** `col` (a timestamptz) inside the period: [from 00:00 local, to+1 00:00 local). TRUE when the period is unbounded. */
export function tsInPeriod(col: RawBuilder<unknown>, p: Period): RawBuilder<boolean> {
  if (!p.from || !p.to) return sql<boolean>`true`;
  return sql<boolean>`(${col} >= (${p.from}::date)::timestamp at time zone ${p.tz} and ${col} < ((${p.to}::date + 1))::timestamp at time zone ${p.tz})`;
}
/** `col` (a DATE) inside the period, as dates. */
export function dateInPeriod(col: RawBuilder<unknown>, p: Period): RawBuilder<boolean> {
  if (!p.from || !p.to) return sql<boolean>`true`;
  return sql<boolean>`(${col} >= ${p.from}::date and ${col} <= ${p.to}::date)`;
}

export interface PageReq { page: number; pageSize: number }
export function pageReq(q: { page?: unknown; pageSize?: unknown }): PageReq {
  const page = Math.max(1, Math.min(100_000, Math.floor(N(q.page) || 1)));
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(N(q.pageSize) || DEFAULT_PAGE_SIZE)));
  return { page, pageSize };
}
/** The page actually served: an out-of-range page (the list shrank under a filter) lands on the last page. */
export function clampPage(req: PageReq, total: number): PageReq & { pageCount: number; offset: number } {
  const pageCount = Math.max(1, Math.ceil(total / req.pageSize));
  const page = Math.min(req.page, pageCount);
  return { page, pageSize: req.pageSize, pageCount, offset: (page - 1) * req.pageSize };
}
export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number; pageCount: number }

/** Search text: trimmed, at most 100 characters; '' = no search. */
export const searchText = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
export const digitsOf = (s: string): string => s.replace(/\D/g, '');
/** LIKE pattern with the wildcards in the user's text escaped. */
export const likeOf = (s: string): string => `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
export const prefixOf = (s: string): string => `${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

/** "$1,234.50", "1234.5", "1,000" → integer cents; anything else → null (never a float sum). */
export function moneyToCents(s: string): number | null {
  const t = s.trim().replace(/^\$/, '').trim();
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.replace(/,/g, '').split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}
/** A positive amount in cents from a request (an integer, ≤ $10,000,000) or null. */
export function positiveCents(v: unknown, max = 1_000_000_000): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= max ? n : null;
}

/** One value of a closed set, or undefined; anything else is the caller's mistake (400). */
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T | undefined {
  if (v == null || v === '' || v === 'all') return undefined;
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
  throw new FinanceError('Some fields are invalid.', 'VALIDATION_FAILED', 400, { field, allowed: [...allowed] });
}

/** CSV cell, formula-safe (a leading = + - @ tab / CR is prefixed with ') and quoted when needed. */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvRow = (cells: unknown[]): string => cells.map(csvCell).join(',');
export const usd = (cents: number): string => {
  const neg = cents < 0, a = Math.abs(Math.round(cents));
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};
/** The document a CSV export returns: a scope header (generated time, period, basis, filters, currency, definitions), the
 *  rows, and totals computed by the server over every filtered record — never the visible page. */
export function csvDocument(title: string, scope: Array<[string, string]>, header: string[], rows: unknown[][], totals: Array<[string, string]>): string {
  const lines = [csvRow([title]), ...scope.map(([k, v]) => csvRow([k, v])), '', csvRow(header), ...rows.map(csvRow), '', ...totals.map(([k, v]) => csvRow([k, v]))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** The audit writer (modules/audit AuditService.record) — the repositories record AFTER the change committed. */
export interface AuditRecorder { record(ctx: { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null }, input: { module: string; action: string; resourceType?: string | null; resourceId?: string | null; metadata?: Record<string, unknown> }): Promise<unknown> }
export async function audit(auditor: AuditRecorder | null, ctx: FinanceCtx, module: string, action: string, resourceType: string, resourceId: string | null, metadata: Record<string, unknown>, onError: (e: unknown) => void): Promise<void> {
  if (!auditor) return;
  try {
    await auditor.record({ tenantId: ctx.tenantId, branchId: isUuid(ctx.branchId) ? ctx.branchId : null, userId: isUuid(ctx.userId) ? ctx.userId : null, role: ctx.role ?? null },
      { module, action, resourceType, resourceId, metadata });
  } catch (e) { onError(e); }
}

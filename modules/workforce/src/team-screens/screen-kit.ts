// screen-kit.ts — the small shared pieces of the Team screen read models (Oct 30 2026): Technicians, Tech Appointments, Live
// Technician Schedule, Tech Queue, Commission Report and Team Performance. The salon's period (its own days, the end day
// included, DST-safe), server paging that clamps to the last page, search helpers that never build SQL from text.
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { HttpException } from '@nestjs/common';
import { withCode } from '@aipowersalon/api-contracts';
import { tenantTimeZone } from '@aipowersalon/database';
import { hasPermission } from '@aipowersalon/permissions';

export interface TeamCtx { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }
export interface TPeriod { preset: string; from: string | null; to: string | null; tz: string; today: string; nowMinute: number; dow: number }

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** the person making a change, for `updated_by` (migration 732; raw SQL is not stamped by the actor plugin) — null when the
 *  session has no user id (a system path): no person made it. */
export const actorOf = (ctx: { userId?: string | null } | null | undefined): string | null => (ctx?.userId && UUID.test(String(ctx.userId)) ? String(ctx.userId) : null);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const N = (v: unknown) => Number(v ?? 0) || 0;
export const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
export const like = (raw: string) => '%' + raw.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
export const err = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => withCode(new HttpException({ code, message, ...extra }, status), code);
export const maskPhone = (p: string | null | undefined) => { if (!p) return null; const d = String(p).replace(/\D/g, ''); return d.length >= 4 ? `••• ${d.slice(-4)}` : '•••'; };
/** digits of a phone typed in any format (8565551234 · (856) 555-1234 · +1 856 555 1234); phoneish = digits only, ≥ 4 */
export function phoneDigits(raw: string) { let d = raw.replace(/\D/g, ''); if (d.length === 11 && d.startsWith('1')) d = d.slice(1); return { d, phoneish: d.length >= 4 && !/[a-z@]/i.test(raw) }; }
export function paging(page: unknown, pageSize: unknown, def = 10) { return { page: Math.max(1, Math.trunc(Number(page)) || 1), pageSize: Math.max(1, Math.min(100, Math.trunc(Number(pageSize)) || def)) }; }
export function served(page: number, pageSize: number, total: number) { const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages); return { page: p, totalPages, offset: (p - 1) * pageSize }; }
export const branchOf = (ctx: TeamCtx) => (ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null);

/** The salon's period: Today · This Week · This Month · This Year · Custom (from..to, the end day included) · All. */
export async function teamPeriod(db: Kysely<any>, ctx: TeamCtx, q: { preset?: unknown; from?: unknown; to?: unknown }, def = 'today'): Promise<TPeriod> {
  const tz = await tenantTimeZone(db, ctx.tenantId);   // never throws: the salon default when unset
  const r = (await sql<any>`select to_char((now() at time zone ${tz})::date, 'YYYY-MM-DD') as today, to_char(date_trunc('week', now() at time zone ${tz})::date, 'YYYY-MM-DD') as wk,
      to_char(date_trunc('month', now() at time zone ${tz})::date, 'YYYY-MM-DD') as mo, to_char(date_trunc('year', now() at time zone ${tz})::date, 'YYYY-MM-DD') as yr,
      (extract(hour from now() at time zone ${tz}) * 60 + extract(minute from now() at time zone ${tz}))::int as now_minute, extract(dow from now() at time zone ${tz})::int as dow`.execute(db)).rows[0];
  const base = { tz, today: r.today, nowMinute: N(r.now_minute), dow: N(r.dow) };
  const preset = ['today', 'week', 'month', 'year', 'custom', 'all'].includes(String(q.preset ?? '')) ? String(q.preset) : def;
  if (preset === 'all') return { preset, from: null, to: null, ...base };
  if (preset === 'custom') {
    const from = YMD.test(String(q.from)) ? String(q.from) : null; const to = YMD.test(String(q.to)) ? String(q.to) : from;
    if (!from || !to || to < from) throw err(400, 'DATE_RANGE_INVALID', 'The start date must be on or before the end date.');
    return { preset, from, to, ...base };
  }
  return { preset, from: preset === 'today' ? r.today : preset === 'week' ? r.wk : preset === 'month' ? r.mo : r.yr, to: r.today, ...base };
}
/** a timestamp column within the period, salon-local days, half-open [from, to + 1 day) */
export function inPeriod(col: RawBuilder<unknown>, p: TPeriod): RawBuilder<unknown> {
  if (!p.from || !p.to) return sql`true`;
  return sql`(${col} >= (${p.from}::date)::timestamp at time zone ${p.tz} and ${col} < ((${p.to}::date + 1))::timestamp at time zone ${p.tz})`;
}
/** a DATE column within the period */
export function dateInPeriod(col: RawBuilder<unknown>, p: TPeriod): RawBuilder<unknown> {
  if (!p.from || !p.to) return sql`true`;
  return sql`(${col} >= ${p.from}::date and ${col} <= ${p.to}::date)`;
}
/** "HH:MM" (or "H:MM AM") → minutes after midnight, null when unreadable */
export function minuteOf(t: unknown): number | null {
  const m = String(t ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i); if (!m) return null;
  let h = Number(m[1]); const mi = Number(m[2]); const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
  return h * 60 + mi;
}
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** any of these permissions, through the ONE permission decision (roles map to their templates there, never here) */
export const canAny = (ctx: TeamCtx, ...keys: string[]) => keys.some((k) => hasPermission(ctx as unknown as Parameters<typeof hasPermission>[0], k));

/** a best-effort side write that must not hide its failure: one structured warning line (no payload, no PII) */
export const logGap = (what: string) => (e: unknown): void => {
  const code = (e as { code?: unknown } | null)?.code;
  process.stderr.write(JSON.stringify({ level: 'warn', msg: what, code: typeof code === 'string' ? code : null }) + '\n');
};

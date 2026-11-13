// report-export.ts — F3 (Finish the Five, 30 Oct 2026): the Commission and Team Performance CSV exports, generated on the
// SERVER and audited there, not in the browser's click handler.
//
//   report.export.requested   written BEFORE any row is read; if it cannot be written the export fails closed (503)
//   report.export.succeeded   written after the CSV is produced (row count, byte count, sha-256 digest, duration); if it
//                             cannot be written the CSV is NOT returned (503) — there is never an unlogged success
//   report.export.failed      generation failed (safe error code + elapsed time only); the caller gets the error
//   report.export.denied      the caller lacks the export / pay permission (the permission missing); no CSV is produced
// Every row carries the request id (the client's id for this attempt — a retry with the same id correlates, a new click is
// a new export), tenant + branch, report type, the salon-local period and a SAFE filter summary (search length only —
// never the words typed, never CSV rows, phone numbers, e-mail, tokens or card data). The CSV format, the columns, their
// calculation and the file names are the ones the screens produced before (FitKit downloadCsv: BOM + CRLF, the same
// formula-injection guard); the header language follows the screen language (EN / VI, Front Desk POS only).
import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { err, canAny, branchOf, N, iso, paging, served, logGap, type TeamCtx, type TPeriod } from './screen-kit';
import { writeAuditRow } from './audit-rows';
import type { CommissionScreenRepository } from './commission-screen.repository';
import type { TeamPerformanceScreenRepository } from './team-performance-screen.repository';

export type ReportType = 'COMMISSION' | 'TEAM_PERFORMANCE' | 'TEAM_DIRECTORY';
export const EXPORT_PERMISSIONS: Record<ReportType, string[]> = {
  COMMISSION: ['reports.export', 'pos.reports.export', 'payroll.export'],
  TEAM_PERFORMANCE: ['reports.export', 'pos.reports.export'],
  // Team Management directory (30 Oct 2026): contact columns stay masked and money columns empty without their permissions
  TEAM_DIRECTORY: ['reports.export', 'pos.reports.export'],
};
const PAY_VIEW = ['payroll.view', 'technicians.view_pay', 'reports.view', 'pos.reports.view'];
const MAX_PAGES = 20; // the same 2,000-row ceiling the screens used

const H = {
  en: { tech: 'Technician', services: 'Services', revenue: 'Service Revenue', discount: 'Discount', base: 'Commissionable base', commission: 'Commission', adjustments: 'Adjustments', rate: 'Rate', tips: 'Tips', payout: 'Payout', paid: 'Paid',
    branch: 'Branch', completed: 'Completed services', rating: 'Verified rating', reviews: 'Reviews', tier: 'Tier', last: 'Last service',
    tiers: { excellent: 'Excellent (4.5 – 5.0)', very_good: 'Very Good (3.5 – 4.4)', good: 'Good (2.5 – 3.4)', needs: 'Needs Improvement (< 2.5)', unrated: 'Unrated' } as Record<string, string> },
  vi: { tech: 'Thợ', services: 'Dịch vụ', revenue: 'Doanh thu dịch vụ', discount: 'Giảm giá', base: 'Cơ sở tính hoa hồng', commission: 'Hoa hồng', adjustments: 'Điều chỉnh', rate: 'Mức', tips: 'Tip', payout: 'Chi trả', paid: 'Đã trả',
    branch: 'Chi nhánh', completed: 'Dịch vụ đã hoàn tất', rating: 'Đánh giá xác thực', reviews: 'Đánh giá', tier: 'Mức', last: 'Dịch vụ gần nhất',
    tiers: { excellent: 'Xuất sắc (4.5 – 5.0)', very_good: 'Rất tốt (3.5 – 4.4)', good: 'Tốt (2.5 – 3.4)', needs: 'Cần cải thiện (< 2.5)', unrated: 'Chưa đánh giá' } as Record<string, string> },
};
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n');
}
const d2 = (c: number) => (c / 100).toFixed(2);

export interface ExportFilters { preset?: string; from?: string; to?: string; q?: string; sort?: string; tier?: string; lang?: string; /** 200-Tech 08: an export of SELECTED rows — how many were asked for (the ids themselves are not logged) */ selectedCount?: number }
export interface ExportResult { csv: string; filename: string; rows: number; bytes: number; requestId: string }

export async function commissionCsv(repo: CommissionScreenRepository, ctx: TeamCtx, f: ExportFilters) {
  const h = f.lang === 'vi' ? H.vi : H.en; const out: any[] = []; let per: TPeriod | null = null;
  for (let p = 1; p <= MAX_PAGES; p++) { const r = await repo.technicians(ctx, { q: f.q, sort: f.sort, preset: f.preset, from: f.from, to: f.to, page: p, pageSize: 100 }); per = r.period; out.push(...r.items); if (p >= r.totalPages) break; }
  return { period: per, filename: `commission-${per?.from ?? 'all'}-${per?.to ?? 'all'}.csv`, rows: out.length,
    csv: toCsv([h.tech, h.services, h.revenue, h.discount, h.base, h.commission, h.adjustments, h.rate, h.tips, h.payout, h.paid],
      out.map((r) => [r.technicianName ?? '', r.serviceCount, d2(r.serviceRevenueCents), d2(r.discountCents), d2(r.commissionableCents), d2(r.commissionCents), d2(r.commissionAdjustmentCents + r.tipAdjustmentCents),
        r.effectiveRatePercent + '%', d2(r.tipsCents), d2(r.payoutCents), d2(r.paidCents)])) };
}
export async function teamPerformanceCsv(repo: TeamPerformanceScreenRepository, ctx: TeamCtx, f: ExportFilters) {
  const h = f.lang === 'vi' ? H.vi : H.en; const out: any[] = []; let per: TPeriod | null = null;
  for (let p = 1; p <= MAX_PAGES; p++) { const r: any = await repo.directory(ctx, { q: f.q, tier: f.tier, sort: f.sort, preset: f.preset, from: f.from, to: f.to, page: p, pageSize: 100 }); per = r.period; out.push(...r.items); if (p >= r.totalPages) break; }
  return { period: per, filename: `team-performance-${per?.from ?? 'all'}-${per?.to ?? 'all'}.csv`, rows: out.length,
    csv: toCsv([h.tech, h.branch, h.completed, h.rating, h.reviews, h.tier, h.last], out.map((r) => [r.name, r.branch ?? '', r.services, r.rating ?? '', r.reviews, h.tiers[r.tier] ?? r.tier, r.lastServiceAt ?? ''])) };
}

/** the safe filter summary: enumerated values only; free text is reduced to its presence and length */
export function safeFilters(f: ExportFilters) {
  return { preset: f.preset ?? null, from: f.from ?? null, to: f.to ?? null, sort: f.sort ?? null, tier: f.tier ?? null, lang: f.lang === 'vi' ? 'vi' : 'en', search: f.q ? { present: true, length: f.q.length } : { present: false }, ...(f.selectedCount != null ? { selectedCount: f.selectedCount } : {}) };
}

export async function auditedExport(db: Kysely<any>, ctx: TeamCtx, type: ReportType, f: ExportFilters, requestId: string,
  generate: () => Promise<{ csv: string; filename: string; rows: number; period: TPeriod | null }>): Promise<ExportResult> {
  const filters = safeFilters(f); const base = { reportType: type, filters, branchId: branchOf(ctx) };
  const resource = { module: 'reports', resourceType: 'report_export', resourceId: type, requestId };
  const missing = !canAny(ctx, ...EXPORT_PERMISSIONS[type]) ? EXPORT_PERMISSIONS[type][0] : type === 'COMMISSION' && !canAny(ctx, ...PAY_VIEW) ? PAY_VIEW[0] : null;
  if (missing) {
    await writeAuditRow(db, ctx, { ...resource, action: 'report.export.denied', status: 'denied', severity: 'warning', summary: `${type} export denied`, metadata: { ...base, permissionMissing: missing } }).catch(logGap('report_export_denial_not_recorded'));
    throw err(403, 'EXPORT_FORBIDDEN', 'You do not have permission to export this report.', { permission: missing });
  }
  try { await writeAuditRow(db, ctx, { ...resource, action: 'report.export.requested', summary: `${type} export requested`, metadata: base }); }
  catch { throw err(503, 'AUDIT_UNAVAILABLE', 'The export is paused because its audit record cannot be written. Try again shortly.'); }
  const t0 = Date.now(); let out: Awaited<ReturnType<typeof generate>>;
  try { out = await generate(); }
  catch (e: any) {
    const code = String(e?.response?.code ?? e?.code ?? 'GENERATION_FAILED').replace(/[^A-Z0-9_]/gi, '').slice(0, 60) || 'GENERATION_FAILED';
    await writeAuditRow(db, ctx, { ...resource, action: 'report.export.failed', status: 'failure', severity: 'warning', summary: `${type} export failed`, metadata: { ...base, failureCode: code, elapsedMs: Date.now() - t0 } }).catch(logGap('report_export_failure_not_recorded'));
    throw e;
  }
  const bytes = Buffer.byteLength(out.csv, 'utf8'); const digest = createHash('sha256').update(out.csv, 'utf8').digest('hex');
  try {
    await writeAuditRow(db, ctx, { ...resource, action: 'report.export.succeeded', summary: `${type} export produced ${out.rows} rows`,
      metadata: { ...base, period: out.period ? { from: out.period.from, to: out.period.to, tz: out.period.tz, preset: out.period.preset } : null, rowCount: out.rows, byteCount: bytes, sha256: digest, durationMs: Date.now() - t0, filename: out.filename } });
  } catch { throw err(503, 'AUDIT_UNAVAILABLE', 'The export is paused because its audit record cannot be written. Try again shortly.'); }
  return { csv: out.csv, filename: out.filename, rows: out.rows, bytes, requestId };
}

/** export history: owners / managers with audit or pay-management access see the salon's; anyone else only their own */
export async function exportHistory(db: Kysely<any>, ctx: TeamCtx, f: { type?: string; page?: unknown; pageSize?: unknown }) {
  const T = ctx.tenantId; const all = canAny(ctx, 'audit.view', 'payroll.manage', 'reports.export');
  const type = f.type === 'COMMISSION' || f.type === 'TEAM_PERFORMANCE' || f.type === 'TEAM_DIRECTORY' ? f.type : null; const { page, pageSize } = paging(f.page, f.pageSize, 8);
  const w = sql`a.module = 'reports' and a.action like 'report.export.%' and (${type}::text is null or a.resource_id = ${type}) and (${all} or a.actor_user_id = ${ctx.userId ?? null})`;
  const total = N((await sql<any>`select count(*)::int as n from audit_events a where a.tenant_id = ${T} and ${w}`.execute(db)).rows[0]?.n); const sp = served(page, pageSize, total);
  const rows = (await sql<any>`select a.id, a.action, a.resource_id, a.status, a.occurred_at, a.request_id, a.metadata, coalesce(nullif(u.full_name, ''), u.email) as actor
    from audit_events a left join users u on u.id = a.actor_user_id and u.tenant_id = a.tenant_id where a.tenant_id = ${T} and ${w} order by a.occurred_at desc, a.id desc limit ${pageSize} offset ${sp.offset}`.execute(db)).rows;
  return { scope: all ? 'salon' : 'own', items: rows.map((r: any) => { const m = r.metadata ?? {}; return { id: String(r.id), event: String(r.action).replace('report.export.', ''), reportType: String(r.resource_id), result: String(r.status),
    at: iso(r.occurred_at), requestId: r.request_id ?? null, actor: r.actor ?? null, filters: m.filters ?? null, rowCount: m.rowCount ?? null, byteCount: m.byteCount ?? null, failureCode: m.failureCode ?? null, permissionMissing: m.permissionMissing ?? null }; }),
    page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
}

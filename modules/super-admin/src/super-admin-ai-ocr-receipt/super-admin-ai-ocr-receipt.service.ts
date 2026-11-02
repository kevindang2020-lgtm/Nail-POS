// super-admin-ai-ocr-receipt.service.ts — Super Admin oversight for the AI OCR Receipt pipeline. Read-only PLATFORM-
// OPERATIONAL aggregates + an audited, reason-gated per-tenant OPERATIONAL drill-down. Never returns a tenant's receipts,
// vendors, line items, amounts, or files — counts and storage totals only. The SuperAdminGuard on the controller is the
// auth boundary; the reason gate + audit here are the second layer. Aggregates use grouped counts (scalable platform-wide).
import { sql, type Kysely } from 'kysely';
import { Logger } from '@nestjs/common';
import type { DB } from '@aipowersalon/database';
import type { AppDatabase } from '@aipowersalon/database';
import type { AuditService } from '@aipowersalon/audit';
import { evaluateSupportAccess, operationalTenantSummary } from './super-admin-ai-ocr-receipt-core';

export interface SupportCtx { userId?: string; email?: string; ip?: string }
export class OcrOversightError extends Error {}

export interface OcrPlatformOverview {
  enabledTenants: number;
  totalDocuments: number;
  byStatus: Record<string, number>;
  reviewBacklog: number;
  /** §115 (Oct 27 2026): readings that used their automatic attempts and wait for a person (extraction_failed, no retry due) */
  extractionDeadLetter?: number;
  /** §145/§149 (Oct 27 2026): platform-wide quality figures over the last 30 days — counts and rates only, no salon named */
  metrics?: OcrPlatformMetrics;
  postingFailures: number;
  quarantined: number;
  ocrFailureRate: number; // 0..1
  generatedAt: string;
}

export interface OcrTenantView {
  tenantId: string; documentCount: number; byStatus: Record<string, number>; storageBytes: number;
  supportMode: true; generatedAt: string;
}

// grouped { pipeline_status: count } for ocr_documents, tenant-scoped when tenantId is given.
async function docStatusCounts(db: Kysely<DB>, tenantId?: string): Promise<Record<string, number>> {
  let q = db.selectFrom('ocr_documents').select(['pipeline_status']).select((eb: any) => eb.fn.countAll().as('n')).groupBy('pipeline_status');
  if (tenantId) q = q.where('tenant_id', '=', tenantId);
  const rows: any[] = await q.execute().catch(() => []);
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.pipeline_status)] = Number(r.n ?? 0);
  return out;
}
const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
// Derivations match super-admin-ai-ocr-receipt-core.buildPlatformOverview (kept in step with that pure helper).
const reviewBacklog = (m: Record<string, number>) => (m['review_required'] || 0) + (m['in_review'] || 0) + (m['duplicate_hold'] || 0);
const failureRate = (m: Record<string, number>, total: number) => (total ? Math.round((((m['failed'] || 0) + (m['extraction_failed'] || 0)) / total) * 100) / 100 : 0);

export interface OcrPlatformMetrics {
  windowDays: number;
  uploads: number;                      // documents uploaded in the window
  extracted: number;                    // readings that reached review / posting
  extractionFailed: number;             // readings that failed (manual entry / dead letter)
  ocrSuccessRate: number | null;        // extracted ÷ (extracted + failed)
  medianProcessingMs: number | null;    // upload → reading done (review_required / duplicate_hold / posted …)
  reviewRate: number | null;            // readings a person had to review (validation needs_review / duplicate hold) ÷ extracted
  autoCategoryAccuracy: number | null;  // scanned expenses whose category a person never corrected ÷ scanned expenses
  categoryCorrectionRate: number | null;// scanned expenses with a category_corrected history row ÷ scanned expenses
  duplicateRate: number | null;         // expenses flagged possible / exact ÷ expenses created
}
async function platformMetrics(db: Kysely<DB>, windowDays = 30): Promise<OcrPlatformMetrics> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const n = (v: unknown) => Number(v ?? 0);
  const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);
  let d: Record<string, unknown> = {}, e: Record<string, unknown> = {};
  try {
    d = (await sql<Record<string, unknown>>`SELECT count(*)::int AS uploads,
        count(*) FILTER (WHERE pipeline_status IN ('review_required','in_review','duplicate_hold','approved','posting','posted','failed'))::int AS extracted,
        count(*) FILTER (WHERE pipeline_status IN ('manual_entry_required','extraction_failed'))::int AS failed,
        count(*) FILTER (WHERE validation_status = 'needs_review' OR duplicate_status <> 'none')::int AS reviewed,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000) FILTER (WHERE pipeline_status IN ('review_required','in_review','duplicate_hold','approved','posting','posted')) AS p50_ms
      FROM ocr_documents WHERE deleted_at IS NULL AND created_at >= ${since}`.execute(db)).rows[0] ?? {};
    e = (await sql<Record<string, unknown>>`SELECT count(*)::int AS scanned,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM expense_history h WHERE h.expense_id = e.id AND h.action = 'category_corrected'))::int AS corrected,
        count(*) FILTER (WHERE duplicate_status IN ('possible','exact','overridden','confirmed_duplicate'))::int AS dup_all,
        (SELECT count(*)::int FROM expenses x WHERE x.created_at >= ${since}) AS created_all
      FROM expenses e WHERE e.source = 'ocr' AND e.created_at >= ${since}`.execute(db)).rows[0] ?? {};
  } catch (e) { metricsLog.warn(`OCR quality metrics unavailable: ${(e as Error).message}`); }   // an older schema: the overview still answers its counts
  const uploads = n(d.uploads), extracted = n(d.extracted), failed = n(d.failed), scanned = n(e.scanned), corrected = n(e.corrected);
  return { windowDays, uploads, extracted, extractionFailed: failed, ocrSuccessRate: rate(extracted, extracted + failed), medianProcessingMs: d.p50_ms == null ? null : Math.round(Number(d.p50_ms)),
    reviewRate: rate(n(d.reviewed), extracted), autoCategoryAccuracy: rate(scanned - corrected, scanned), categoryCorrectionRate: rate(corrected, scanned), duplicateRate: rate(n(e.dup_all), n(e.created_all)) };
}

const metricsLog = new Logger('SuperAdminOcrOverview');

export class SuperAdminAiOcrReceiptService {
  constructor(private readonly db: AppDatabase, private readonly auditSvc?: AuditService) {}

  async platformOverview(_ctx: SupportCtx): Promise<OcrPlatformOverview> {
    const base: OcrPlatformOverview = { enabledTenants: 0, totalDocuments: 0, byStatus: {}, reviewBacklog: 0, postingFailures: 0, quarantined: 0, ocrFailureRate: 0, generatedAt: new Date().toISOString() };
    if (!this.db) return base;
    const db = this.db as Kysely<DB>;
    const count = (q: Promise<any>) => q.then((r) => Number(r?.n ?? 0)).catch(() => 0);
    const [enabledTenants, byStatus, extractionDeadLetter, metrics] = await Promise.all([
      count(db.selectFrom('tenant_ocr_ai_settings').select((eb) => eb.fn.countAll<number>().as('n'))
        .where('level', '=', 'tenant').where('enabled', '=', true).executeTakeFirst()),
      docStatusCounts(db),
      count(db.selectFrom('ocr_documents').select((eb) => eb.fn.countAll<number>().as('n')).where('pipeline_status', '=', 'extraction_failed').where('next_extraction_at', 'is', null).where('deleted_at', 'is', null).executeTakeFirst()),
      platformMetrics(db),
    ]);
    const total = sum(byStatus);
    return {
      enabledTenants, totalDocuments: total, byStatus, extractionDeadLetter, metrics,
      reviewBacklog: reviewBacklog(byStatus), postingFailures: byStatus['failed'] || 0, quarantined: byStatus['quarantined'] || 0,
      ocrFailureRate: failureRate(byStatus, total), generatedAt: new Date().toISOString(),
    };
  }

  // Audited, reason-required, per-tenant OPERATIONAL drill-down. Returns counts + storage total — never document content.
  async tenantView(ctx: SupportCtx, tenantId: string, reason: string): Promise<OcrTenantView> {
    const grant = evaluateSupportAccess({ role: 'super_admin', tenantId, reason, nowMs: Date.now() });
    if (!grant.granted) throw new OcrOversightError(grant.error || 'SUPPORT_ACCESS_DENIED');
    if (grant.audit) this.auditSvc?.record?.({ tenantId, userId: ctx.userId || 'super_admin', role: 'SUPER_ADMIN' } as any, { action: grant.audit.action, metadata: { reason: grant.audit.reason, ip: ctx.ip } } as any);
    const empty: OcrTenantView = { tenantId, documentCount: 0, byStatus: {}, storageBytes: 0, supportMode: true, generatedAt: new Date().toISOString() };
    if (!this.db) return empty;
    const db = this.db as Kysely<DB>;
    const [byStatus, storageRow] = await Promise.all([
      docStatusCounts(db, tenantId),
      db.selectFrom('ocr_document_files').select((eb) => eb.fn.sum('size_bytes').as('s')).where('tenant_id', '=', tenantId).executeTakeFirst().catch(() => null),
    ]);
    const storageBytes = Number(storageRow?.s ?? 0);
    const summary = operationalTenantSummary({ tenantId, documentCount: sum(byStatus), byStatus, storageBytes });
    return { ...summary, supportMode: true, generatedAt: new Date().toISOString() };
  }
}

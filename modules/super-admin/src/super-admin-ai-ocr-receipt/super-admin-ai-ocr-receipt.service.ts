// super-admin-ai-ocr-receipt.service.ts — Super Admin oversight for the AI OCR Receipt pipeline. Read-only PLATFORM-
// OPERATIONAL aggregates + an audited, reason-gated per-tenant OPERATIONAL drill-down. Never returns a tenant's receipts,
// vendors, line items, amounts, or files — counts and storage totals only. The SuperAdminGuard on the controller is the
// auth boundary; the reason gate + audit here are the second layer. Aggregates use grouped counts (scalable platform-wide).
import type { Kysely } from 'kysely';
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
  if (tenantId) q = q.where('tenant_id', '=', tenantId as any) as any;
  const rows: any[] = await (q as any).execute().catch(() => []);
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.pipeline_status)] = Number(r.n ?? 0);
  return out;
}
const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
// Derivations match super-admin-ai-ocr-receipt-core.buildPlatformOverview (kept in step with that pure helper).
const reviewBacklog = (m: Record<string, number>) => (m['review_required'] || 0) + (m['in_review'] || 0) + (m['duplicate_hold'] || 0);
const failureRate = (m: Record<string, number>, total: number) => (total ? Math.round((((m['failed'] || 0) + (m['extraction_failed'] || 0)) / total) * 100) / 100 : 0);

export class SuperAdminAiOcrReceiptService {
  constructor(private readonly db: AppDatabase, private readonly auditSvc?: AuditService) {}

  async platformOverview(_ctx: SupportCtx): Promise<OcrPlatformOverview> {
    const base: OcrPlatformOverview = { enabledTenants: 0, totalDocuments: 0, byStatus: {}, reviewBacklog: 0, postingFailures: 0, quarantined: 0, ocrFailureRate: 0, generatedAt: new Date().toISOString() };
    if (!this.db) return base;
    const db = this.db as Kysely<DB>;
    const count = (q: Promise<any>) => q.then((r) => Number(r?.n ?? 0)).catch(() => 0);
    const [enabledTenants, byStatus] = await Promise.all([
      count(db.selectFrom('tenant_ocr_ai_settings').select((eb) => eb.fn.countAll<number>().as('n'))
        .where('level', '=', 'tenant').where('enabled', '=', true as any).executeTakeFirst()),
      docStatusCounts(db),
    ]);
    const total = sum(byStatus);
    return {
      enabledTenants, totalDocuments: total, byStatus,
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
      db.selectFrom('ocr_document_files').select((eb) => eb.fn.sum('size_bytes').as('s')).where('tenant_id', '=', tenantId as any).executeTakeFirst().catch(() => null),
    ]);
    const storageBytes = Number((storageRow as any)?.s ?? 0);
    const summary = operationalTenantSummary({ tenantId, documentCount: sum(byStatus), byStatus, storageBytes });
    return { ...summary, supportMode: true, generatedAt: new Date().toISOString() };
  }
}

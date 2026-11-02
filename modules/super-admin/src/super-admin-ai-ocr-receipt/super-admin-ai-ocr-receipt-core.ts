// super-admin-ai-ocr-receipt-core.ts — PURE platform-oversight logic. Super Admin sees OPERATIONAL COUNTS ONLY — never a
// tenant's receipts, vendors, line items, amounts, or files. Tenant-content access requires an authorized support role, a
// tenant selection, a stated reason, and a time-limited session, and every such access is audited. This core builds the
// aggregate shapes and enforces the support-access gate; it never returns document content.

export interface DocStatusRow { pipelineState: string; }
export interface PlatformOverview {
  enabledTenants: number;
  totalDocuments: number;
  byStatus: Record<string, number>;
  reviewBacklog: number;
  postingFailures: number;
  quarantined: number;
  ocrFailureRate: number;   // 0..1
}

/** Aggregate operational counts across tenants. Input is status rows only — never document content. */
export function buildPlatformOverview(input: { enabledTenants: number; statuses: DocStatusRow[] }): PlatformOverview {
  const byStatus: Record<string, number> = {};
  for (const r of input.statuses) byStatus[r.pipelineState] = (byStatus[r.pipelineState] || 0) + 1;
  const total = input.statuses.length;
  const failed = (byStatus['failed'] || 0) + (byStatus['extraction_failed'] || 0);
  return {
    enabledTenants: input.enabledTenants,
    totalDocuments: total,
    byStatus,
    reviewBacklog: (byStatus['review_required'] || 0) + (byStatus['in_review'] || 0) + (byStatus['duplicate_hold'] || 0),
    postingFailures: byStatus['failed'] || 0,
    quarantined: byStatus['quarantined'] || 0,
    ocrFailureRate: total ? Math.round((failed / total) * 100) / 100 : 0,
  };
}

// ── support-access gate ──────────────────────────────────────────────────────
export interface SupportAccessRequest { role: string; tenantId: string | null; reason: string | null; nowMs: number; sessionTtlMs?: number; }
export interface SupportAccessGrant { granted: boolean; error?: string; expiresAtMs?: number; audit?: { action: string; tenantId: string; reason: string } }
const SUPPORT_ROLES = new Set(['super_admin', 'platform_support']);

/** Gate a Super Admin's request to enter tenant support mode. Requires an authorized role, a tenant, and a reason; the
 *  session is time-limited; the grant is audited. NEVER returns document content — only permission to open an audited session. */
export function evaluateSupportAccess(req: SupportAccessRequest): SupportAccessGrant {
  if (!SUPPORT_ROLES.has(req.role)) return { granted: false, error: 'FORBIDDEN_ROLE' };
  if (!req.tenantId) return { granted: false, error: 'TENANT_REQUIRED' };
  if (!req.reason || req.reason.trim().length < 5) return { granted: false, error: 'REASON_REQUIRED' };
  const ttl = req.sessionTtlMs ?? 30 * 60 * 1000;   // 30-minute default
  return { granted: true, expiresAtMs: req.nowMs + ttl, audit: { action: 'support_mode_started', tenantId: req.tenantId, reason: req.reason.trim().slice(0, 200) } };
}

/** A support session is valid only until it expires. */
export function isSupportSessionActive(grant: SupportAccessGrant, nowMs: number): boolean {
  return !!grant.granted && grant.expiresAtMs != null && nowMs < grant.expiresAtMs;
}

/** Strip a tenant summary to operational fields only — asserts no document content can leak through oversight. */
export function operationalTenantSummary(input: { tenantId: string; documentCount: number; byStatus: Record<string, number>; storageBytes: number }): { tenantId: string; documentCount: number; byStatus: Record<string, number>; storageBytes: number } {
  // deliberately whitelists only counts — vendors/amounts/line items/files are never included
  return { tenantId: input.tenantId, documentCount: input.documentCount, byStatus: input.byStatus, storageBytes: input.storageBytes };
}

// audit.ts — wire contract (Constitution 13 §13, §15). Realm: tenant.

export type AuditStatus = 'success' | 'failed' | 'warning';
export type AuditSeverity = 'low' | 'medium' | 'high' | 'critical';
export interface AuditEventRow {
  id: string;
  tenantId: string;
  branchId: string | null;
  occurredAt: string;
  actorUserId: string | null;
  actorRole: string | null;
  actorName: string | null;
  module: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  summary: string | null;
  status: AuditStatus;
  severity: AuditSeverity;
  ip: string | null;
  device: string | null;
  metadata: Record<string, unknown>;
  // BUILD_PLAN Phase 10 (Constitution 1 §32–§33): the change itself and where it came from (null on older rows)
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  reason?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  sessionId?: string | null;
}
export interface AuditPage { items: AuditEventRow[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } }

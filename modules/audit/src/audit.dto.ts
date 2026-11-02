// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { AuditStatus, AuditSeverity, AuditEventRow } from '@aipowersalon/api-contracts/tenant';
import type { AuditStatus, AuditSeverity, AuditEventRow } from '@aipowersalon/api-contracts/tenant';
import { foldVi } from '@aipowersalon/api-contracts';
// audit.dto.ts — types + pure helpers for the unified audit trail. Helpers are side-effect free and unit-tested.

export interface AuditContext {
  tenantId: string;
  branchId?: string | null;
  userId?: string | null;
  role?: string | null;
  actorName?: string | null;
  ip?: string | null;
  device?: string | null;
  // BUILD_PLAN Phase 10 (Constitution 1 §32–§33): where the change came from. AuditService.record fills these from the
  // request context (@aipowersalon/observability getContext()) when the caller does not.
  requestId?: string | null;
  correlationId?: string | null;
  sessionId?: string | null;
}

// What a caller supplies when recording an event. Only module + action are required.
export interface AuditEventInput {
  module: string;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  summary?: string | null;
  status?: AuditStatus;
  severity?: AuditSeverity;
  metadata?: Record<string, unknown>;
  // optional per-event overrides of the context actor/ip/device
  actorName?: string | null;
  ip?: string | null;
  device?: string | null;
  // Phase 10: the record's state before and after the change (redacted like metadata) and the human reason for it
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}


export interface AuditFilters {
  module?: string;
  severity?: AuditSeverity;
  status?: AuditStatus;
  actorUserId?: string;
  resourceType?: string;
  search?: string;
  from?: string; // ISO
  to?: string;   // ISO
  page?: number;
  pageSize?: number;
}

const SEVERITIES: AuditSeverity[] = ['low', 'medium', 'high', 'critical'];
const STATUSES: AuditStatus[] = ['success', 'failed', 'warning'];

// Pure: coerce an arbitrary severity to a valid enum (default 'low').
export function normalizeSeverity(v: unknown): AuditSeverity {
  return typeof v === 'string' && (SEVERITIES as string[]).includes(v) ? (v as AuditSeverity) : 'low';
}
// Pure: coerce status (default 'success').
export function normalizeStatus(v: unknown): AuditStatus {
  return typeof v === 'string' && (STATUSES as string[]).includes(v) ? (v as AuditStatus) : 'success';
}

// Keys whose values must never be written to the audit trail (PCI / secrets / credentials). Append-only storage means
// a leaked secret here cannot be edited out, so redaction happens before the row is created.
const SENSITIVE_KEY = /(\bpan\b|card[_-]?number|\bcvv\b|cvc|track[_-]?data|magstripe|nfc|password|passcode|secret|token|api[_-]?key|authorization|ssn|cardholder)/i;
// Pure + deep: replace sensitive values with '[redacted]', leaving structure intact. Caps depth/size to stay bounded.
export function redactMetadata(input: unknown, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (depth > 5 || input == null || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) { out[k] = '[redacted]'; continue; }
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = redactMetadata(v, depth + 1);
    else out[k] = v;
  }
  return out;
}

// Pure: build the stored shape (sans id/occurredAt, which the store assigns) from context + input. Centralizes
// normalization + redaction so both adapters and tests share one code path.
// audit_events.actor_user_id is a UUID column. A system actor (a job, a sweep, a webhook) carries a non-UUID id —
// 'system' before Constitution 13, 'system:<job>' from systemContext() — and binding it made the INSERT throw, which
// record() swallows: every system-actor audit event was silently LOST. A non-UUID id is kept as the actor NAME instead
// (so the row says which system acted) and actor_user_id is NULL. A real user id is unchanged.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function auditActorUserId(userId: string | null | undefined): string | null {
  return userId && UUID_RE.test(userId) ? userId : null;
}

export function buildAuditRow(ctx: AuditContext, input: AuditEventInput) {
  const systemActor = ctx.userId && !UUID_RE.test(ctx.userId) ? ctx.userId : null;
  return {
    tenantId: ctx.tenantId,
    // w4 sweep SW-14: a context with no branch carries '' (or a non-id) — branch_id is a uuid column, so it is NULL, never
    // '' (that INSERT failed and the event was lost; 177 lost in one sweep)
    branchId: ctx.branchId && UUID_RE.test(ctx.branchId) ? ctx.branchId : null,
    actorUserId: auditActorUserId(ctx.userId),
    actorRole: ctx.role ?? null,
    actorName: input.actorName ?? ctx.actorName ?? systemActor ?? null,
    module: String(input.module || '').trim() || 'unknown',
    action: String(input.action || '').trim() || 'unknown',
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    summary: input.summary ?? null,
    status: normalizeStatus(input.status),
    severity: normalizeSeverity(input.severity),
    ip: input.ip ?? ctx.ip ?? null,
    device: input.device ?? ctx.device ?? null,
    metadata: redactMetadata(input.metadata),
    beforeState: auditState(input.before),
    afterState: auditState(input.after),
    reason: input.reason != null && String(input.reason).trim() ? String(input.reason).trim().slice(0, 2000) : null,
    requestId: ctx.requestId ?? null,
    correlationId: ctx.correlationId ?? null,
    sessionId: ctx.sessionId ?? null,
  };
}

/** A before/after snapshot as stored: an object is redacted like metadata, a scalar is wrapped, nothing stays null. */
export function auditState(v: unknown): Record<string, unknown> | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'object' && !Array.isArray(v)) return redactMetadata(v);
  return { value: Array.isArray(v) ? v.slice(0, 200) : v };
}

// Pure: apply filters to an in-memory list (also used by the in-memory adapter).
export function applyAuditFilters(rows: AuditEventRow[], f: AuditFilters): AuditEventRow[] {
  let out = rows;
  if (f.module) out = out.filter((r) => r.module === f.module);
  if (f.severity) out = out.filter((r) => r.severity === f.severity);
  if (f.status) out = out.filter((r) => r.status === f.status);
  if (f.actorUserId) out = out.filter((r) => r.actorUserId === f.actorUserId);
  if (f.resourceType) out = out.filter((r) => r.resourceType === f.resourceType);
  if (f.from) { const t = Date.parse(f.from); out = out.filter((r) => Date.parse(r.occurredAt) >= t); }
  if (f.to) { const t = Date.parse(f.to); out = out.filter((r) => Date.parse(r.occurredAt) <= t); }
  if (f.search) { const s = foldVi(f.search);   /* accent-insensitive (Vietnamese POS §41) */ out = out.filter((r) =>
    [r.action, r.module, r.summary, r.resourceId, r.actorName].some((x) => foldVi(x).includes(s))); }
  return out;
}

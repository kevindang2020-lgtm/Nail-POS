// audit.kysely.repository.ts — Postgres adapter for the append-only audit trail (insert + scoped/cross-tenant reads).
// Mirrors the port: no update/delete. Tenant reads are filtered by tenant_id; platform reads are cross-tenant and are
// only reachable through the Super-Admin-guarded controller.
import { safeInet, applyListQuery, parseListQuery, tenantTimeZone, type DB, type ParsedListQuery } from '@aipowersalon/database';
import { AUDIT_EVENTS_SPEC } from './audit.list-queries';
import { sql, type Kysely } from 'kysely';
import type { AuditContext, AuditEventInput, AuditEventRow, AuditFilters, AuditSeverity, AuditStatus } from './audit.dto';
import { buildAuditRow, redactMetadata, auditActorUserId } from './audit.dto';
import type { AuditRepositoryPort, AuditPage, PlatformAuditInput } from './audit.repository';
import { clampPage } from '@aipowersalon/api-contracts';

const toRow = (r: any): AuditEventRow => ({
  id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, occurredAt: new Date(r.occurred_at).toISOString(),
  actorUserId: r.actor_user_id ?? null, actorRole: r.actor_role ?? null, actorName: r.actor_name ?? null,
  module: r.module, action: r.action, resourceType: r.resource_type ?? null, resourceId: r.resource_id ?? null,
  summary: r.summary ?? null, status: (r.status || 'success') as AuditStatus, severity: (r.severity || 'low') as AuditSeverity,
  ip: safeInet(r?.ip) ?? null, device: r.device ?? null, metadata: (r.metadata as Record<string, unknown>) || {},
  beforeState: (r.before_state as Record<string, unknown>) ?? null, afterState: (r.after_state as Record<string, unknown>) ?? null,
  reason: r.reason ?? null, requestId: r.request_id ?? null, correlationId: r.correlation_id ?? null, sessionId: r.session_id ?? null,
});

export class KyselyAuditRepository implements AuditRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async record(ctx: AuditContext, input: AuditEventInput): Promise<AuditEventRow> {
    const b = buildAuditRow(ctx, input);
    const ins = await this.db.insertInto('audit_events').values({
      tenant_id: b.tenantId, branch_id: b.branchId, actor_user_id: b.actorUserId, actor_role: b.actorRole, actor_name: b.actorName,
      module: b.module, action: b.action, resource_type: b.resourceType, resource_id: b.resourceId, summary: b.summary,
      status: b.status, severity: b.severity, ip: b.ip, device: b.device, metadata: JSON.stringify(b.metadata) as any,
      before_state: b.beforeState ? (JSON.stringify(b.beforeState) as any) : null, after_state: b.afterState ? (JSON.stringify(b.afterState) as any) : null,
      reason: b.reason, request_id: b.requestId, correlation_id: b.correlationId, session_id: b.sessionId,
    } as any).returningAll().executeTakeFirstOrThrow();
    return toRow(ins);
  }

  // Platform (tenant-less) events share audit_logs with every other Super Admin action: action_type is
  // "<module>.<action>", the summary rides in metadata_json, and the actor id is kept only when it is a UUID.
  async recordPlatform(input: PlatformAuditInput): Promise<void> {
    const metadata = { ...redactMetadata(input.metadata), ...(input.summary ? { summary: input.summary } : {}) };
    await this.db.insertInto('audit_logs').values({
      tenant_id: null, branch_id: null,
      user_id: auditActorUserId(input.userId), role: input.role ?? null,
      action_type: `${String(input.module || 'unknown').trim()}.${String(input.action || 'unknown').trim()}`,
      entity_type: input.resourceType ?? null, entity_id: input.resourceId ?? null,
      ip_address: safeInet(input.ip) ?? null, user_agent: input.device ?? null,
      metadata_json: JSON.stringify(metadata) as any,
    } as any).execute();
  }

  // BUILD_PLAN Phase 12 (DoD #21/#22/#23): filters, search, range and order from AUDIT_EVENTS_SPEC — the same declaration
  // the interceptor validated the request against; date-only bounds are the salon's calendar day.
  private async parsed(f: AuditFilters, tenantId: string | null | undefined): Promise<ParsedListQuery> {
    return parseListQuery(f as Record<string, unknown>, AUDIT_EVENTS_SPEC, { timeZone: tenantId ? await tenantTimeZone(this.db, tenantId) : 'UTC' });
  }

  private async page(baseWhere: (qb: any) => any, f: AuditFilters, tenantId: string | null | undefined): Promise<AuditPage> {
    const lq = await this.parsed(f, tenantId);
    const page = clampPage(f.page);
    const pageSize = lq.limit;
    const countRow: any = await applyListQuery(baseWhere(this.db.selectFrom('audit_events')), lq, { sort: false, limit: false })
      .select(sql<number>`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 }));
    const totalItems = Number(countRow?.n || 0);
    const rows = await applyListQuery(baseWhere(this.db.selectFrom('audit_events')), lq, { limit: false })
      .selectAll().limit(pageSize).offset((page - 1) * pageSize).execute().catch(() => []);
    return { items: (rows as any[]).map(toRow), pagination: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) } };
  }

  list(tenantId: string, filters: AuditFilters): Promise<AuditPage> {
    return this.page((qb) => qb.where('tenant_id', '=', tenantId), filters, tenantId);
  }

  listPlatform(filters: AuditFilters & { tenantId?: string }): Promise<AuditPage> {
    return this.page((qb) => (filters.tenantId ? qb.where('tenant_id', '=', filters.tenantId) : qb), filters, filters.tenantId);
  }
}

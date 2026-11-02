// audit.service.ts — the write/read surface other modules use. record() is resilient: audit logging must never break
// a business operation, so failures are swallowed (and surfaced via the returned null) rather than thrown. Reads are
// split into tenant-scoped (list) and cross-tenant (listPlatform, Super-Admin only).
import type { AuditContext, AuditEventInput, AuditEventRow, AuditFilters } from './audit.dto';
import type { AuditRepositoryPort, AuditPage, PlatformAuditInput } from './audit.repository';
import { getContext } from '@aipowersalon/observability';

/** The caller's context plus the request / correlation / session ids of the request in flight (caller's values win). */
export function withRequestContext(ctx: AuditContext): AuditContext {
  const t = getContext();
  if (!t) return ctx;
  return { ...ctx, requestId: ctx.requestId ?? t.requestId ?? null, correlationId: ctx.correlationId ?? t.correlationId ?? null, sessionId: ctx.sessionId ?? t.sessionId ?? null };
}

export class AuditService {
  constructor(private readonly repo: AuditRepositoryPort) {}

  // Best-effort write. Returns the row on success or null on failure; never throws into the caller's path.
  // Phase 10 (Constitution 1 §32–§33): the request / correlation / session ids come from the request context when the
  // caller did not pass them, so every audit row can be traced to the request (and the workflow) that made it.
  async record(ctx: AuditContext, input: AuditEventInput): Promise<AuditEventRow | null> {
    try {
      if (!ctx?.tenantId) return null;
      return await this.repo.record(withRequestContext(ctx), input);
    } catch {
      return null;
    }
  }

  // Best-effort write of a PLATFORM (tenant-less) event — a Super Admin action. Same contract: never throws.
  async recordPlatform(input: PlatformAuditInput): Promise<void> {
    try { await this.repo.recordPlatform(input); } catch { /* audit never breaks the operation */ }
  }

  list(tenantId: string, filters: AuditFilters): Promise<AuditPage> {
    return this.repo.list(tenantId, filters);
  }

  listPlatform(filters: AuditFilters & { tenantId?: string }): Promise<AuditPage> {
    return this.repo.listPlatform(filters);
  }
}

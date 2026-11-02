// ai-booking-context.ts — resolves the TRUSTED booking context for every ai_booking request. The single most important
// isolation rule in the spec: tenant_id and branch_id must come ONLY from a server-derived, authenticated/verified
// context — never from the request body, query, headers, or AI model output. This resolver takes the context the guard
// already attached to the request (req.ctx: tenant/branch/user/role/permissions, derived from the authenticated POS /
// mobile / online / signed session) and a requested source, validates the source, and returns a trusted AiBookingContext.
// Any tenant/branch a caller tries to supply is ignored by construction — it is never read here.
import { isAiBookingSource, requiresSupportSession, type AiBookingSource } from './ai-booking-source';

export interface ServerDerivedCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[]; supportSessionId?: string | null }

export interface AiBookingContext {
  tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[];
  source: AiBookingSource; correlationId: string; supportSessionId: string | null;
}

export class AiBookingError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

/**
 * Build a trusted context. `server` MUST be the guard-populated req.ctx (already tenant/branch scoped). `requestedSource`
 * is validated against the catalog. Client-supplied tenant/branch are structurally impossible to inject — this function
 * does not accept them. Super-admin support mode additionally requires an active support session id on the server ctx.
 */
export function resolveTrustedContext(server: ServerDerivedCtx, requestedSource: unknown, correlationId?: string): AiBookingContext {
  if (!server?.tenantId || !server?.userId) throw new AiBookingError('PERMISSION_DENIED', 'No authenticated context.');
  if (!isAiBookingSource(requestedSource)) throw new AiBookingError('INVALID_BOOKING_SOURCE', 'Unknown or missing booking source.');
  if (requiresSupportSession(requestedSource) && !server.supportSessionId) {
    throw new AiBookingError('PERMISSION_DENIED', 'Super Admin support mode requires an active, audited support session.');
  }
  return {
    tenantId: server.tenantId,
    branchId: server.branchId ?? null,
    userId: server.userId,
    role: server.role,
    permissions: Array.isArray(server.permissions) ? server.permissions : [],
    source: requestedSource,
    correlationId: correlationId && /^[A-Za-z0-9_-]{1,64}$/.test(correlationId) ? correlationId : cryptoId(),
    supportSessionId: server.supportSessionId ?? null,
  };
}

function cryptoId(): string {
  // Best-effort correlation id; not security-sensitive.
  return 'aib_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

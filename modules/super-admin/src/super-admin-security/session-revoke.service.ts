// Session-revocation engine — validated, idempotent, audited, self-lockout-safe. Revokes sessions AND their refresh
// tokens (closing the gap in the legacy revokeAllForUser). Broad scopes require a reason; the acting admin's current
// session is preserved unless explicitly overridden.
import { validateRevokeScope, protectedSessionId, summarizeRevoke } from './session-revoke-core';
import type { SessionRevokeRepositoryPort, RevokeActor } from './session-revoke.repository';

export class RevokeError extends Error { constructor(public code: 'invalid', message: string) { super(message); } }

export interface RevokeInput { scope: string; target: string; reason?: string | null; currentSessionId?: string | null; includeCurrent?: boolean }

export class SessionRevokeService {
  constructor(private readonly repo: SessionRevokeRepositoryPort) {}

  private guard(input: RevokeInput): { protectedId: string | null } {
    const v = validateRevokeScope(input.scope, input.target, input.reason);
    if (!v.ok) throw new RevokeError('invalid', v.reason);
    const protectedId = input.includeCurrent ? null : protectedSessionId(input.currentSessionId);
    return { protectedId };
  }

  async preview(input: RevokeInput) {
    const { protectedId } = this.guard(input);
    const counts = await this.repo.countImpact(input.scope, input.target, protectedId);
    const summary = summarizeRevoke({ ...counts, protectedSession: !!protectedId });
    return { scope: input.scope, target: input.target, ...counts, protectedSession: !!protectedId, ...summary };
  }

  async revoke(input: RevokeInput, actor: RevokeActor) {
    const { protectedId } = this.guard(input);
    const result = await this.repo.revoke(input.scope, input.target, protectedId, input.reason ?? null, actor);
    const summary = summarizeRevoke({ sessionsToRevoke: result.revokedSessions, alreadyRevoked: 0, refreshTokensToRevoke: result.revokedRefreshTokens, protectedSession: !!protectedId });
    return { scope: input.scope, target: input.target, ...result, protectedSession: !!protectedId, message: `Revoked ${result.revokedSessions} session(s) and ${result.revokedRefreshTokens} refresh token(s).`, summary: summary.message };
  }
}

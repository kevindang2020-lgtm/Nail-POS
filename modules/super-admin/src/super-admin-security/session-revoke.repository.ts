// Repository port for session revocation. Closes the real gap in the existing revokeAllForUser (which left refresh tokens
// live): this revokes sessions AND their refresh tokens in one transaction, idempotently, and writes a security audit
// event. In-memory mirrors the contract for tests.
export interface RevokeImpactCounts { sessionsToRevoke: number; alreadyRevoked: number; refreshTokensToRevoke: number }
export interface RevokeResult { revokedSessions: number; revokedRefreshTokens: number }
export interface RevokeActor { userId: string | null; role: string | null; name: string | null; ip: string | null }

export interface SessionRevokeRepositoryPort {
  countImpact(scope: string, target: string, protectedSessionId: string | null): Promise<RevokeImpactCounts>;
  revoke(scope: string, target: string, protectedSessionId: string | null, reason: string | null, actor: RevokeActor): Promise<RevokeResult>;
}

interface MemSession { id: string; userId: string; tenantId: string | null; role: string; status: string }
interface MemToken { id: string; sessionId: string; revoked: boolean }
export class InMemorySessionRevokeRepository implements SessionRevokeRepositoryPort {
  sessions: MemSession[] = []; tokens: MemToken[] = []; audits: any[] = [];
  private match(s: MemSession, scope: string, target: string) {
    if (scope === 'session') return s.id === target;
    if (scope === 'user') return s.userId === target;
    if (scope === 'tenant') return s.tenantId === target;
    if (scope === 'role') return s.role === target;
    return false;
  }
  async countImpact(scope: string, target: string, protectedSessionId: string | null): Promise<RevokeImpactCounts> {
    const inScope = this.sessions.filter((s) => this.match(s, scope, target) && s.id !== protectedSessionId);
    const active = inScope.filter((s) => s.status === 'active');
    const already = inScope.filter((s) => s.status === 'revoked');
    const ids = new Set(active.map((s) => s.id));
    const tokens = this.tokens.filter((t) => ids.has(t.sessionId) && !t.revoked);
    return { sessionsToRevoke: active.length, alreadyRevoked: already.length, refreshTokensToRevoke: tokens.length };
  }
  async revoke(scope: string, target: string, protectedSessionId: string | null, reason: string | null, actor: RevokeActor): Promise<RevokeResult> {
    const active = this.sessions.filter((s) => this.match(s, scope, target) && s.id !== protectedSessionId && s.status === 'active');
    const ids = new Set(active.map((s) => s.id));
    active.forEach((s) => { s.status = 'revoked'; });
    const tokens = this.tokens.filter((t) => ids.has(t.sessionId) && !t.revoked);
    tokens.forEach((t) => { t.revoked = true; });
    this.audits.push({ module: 'security', action: 'session_revoked', actor: actor.userId, scope, target, reason, revokedSessions: active.length, revokedRefreshTokens: tokens.length });
    return { revokedSessions: active.length, revokedRefreshTokens: tokens.length };
  }
}

// Kysely implementation — transactional revoke of sessions + their refresh tokens, idempotent (only active/non-revoked
// rows change), with a security audit event. No tokens or secrets are ever read or logged; only counts + scope/target.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { SessionRevokeRepositoryPort, RevokeImpactCounts, RevokeResult, RevokeActor } from './session-revoke.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { SESSION } from '@aipowersalon/identity';

const n = (v: unknown) => Number(v) || 0;

// Build the WHERE predicate for a scope. Role scope resolves via the session's user.
function scopeWhere(scope: string, target: string) {
  if (scope === 'session') return sql`s.id = ${target}`;
  if (scope === 'user') return sql`s.user_id = ${target}`;
  if (scope === 'tenant') return sql`s.tenant_id = ${target}`;
  if (scope === 'role') return sql`s.user_id in (select id from users where role = ${target})`;
  return sql`false`;
}

export class KyselySessionRevokeRepository implements SessionRevokeRepositoryPort {
  constructor(private readonly db: AppDatabase) {}

  async countImpact(scope: string, target: string, protectedSessionId: string | null): Promise<RevokeImpactCounts> {
    const guard = protectedSessionId ? sql`and s.id <> ${protectedSessionId}` : sql``;
    const where = scopeWhere(scope, target);
    const r: any = await sql`select count(*) filter (where s.status = 'active')::int active, count(*) filter (where s.status = 'revoked')::int already from sessions s where ${where} ${guard}`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    const t: any = await sql`select count(*)::int c from refresh_tokens rt where rt.revoked_at is null and rt.session_id in (select s.id from sessions s where ${where} ${guard} and s.status = 'active')`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    return { sessionsToRevoke: n(r?.active), alreadyRevoked: n(r?.already), refreshTokensToRevoke: n(t?.c) };
  }

  async revoke(scope: string, target: string, protectedSessionId: string | null, reason: string | null, actor: RevokeActor): Promise<RevokeResult> {
    const guard = protectedSessionId ? sql`and s.id <> ${protectedSessionId}` : sql``;
    const where = scopeWhere(scope, target);
    return (this.db as any).transaction().execute(async (trx: AppDatabase) => {
      // 1) revoke matching active sessions
      const sess: any = await sql`update sessions s set status = 'revoked', revoked_at = now() where ${where} ${guard} and s.status = 'active' and ${canMoveToSql(SESSION, 'revoked', 's')} returning s.id`.execute(trx as any);
      const ids: string[] = (sess.rows || []).map((r: any) => String(r.id));
      let tokens = 0;
      if (ids.length) {
        // 2) revoke the refresh tokens tied to exactly those sessions (the gap the old path left open)
        const tok: any = await sql`update refresh_tokens set revoked_at = now() where revoked_at is null and session_id = any(${ids}) returning id`.execute(trx as any);
        tokens = (tok.rows || []).length;
      }
      // 3) security audit event — counts + scope only, never tokens/secrets
      await sql`insert into audit_events (occurred_at, actor_user_id, actor_role, actor_name, module, action, resource_type, resource_id, summary, status, severity, ip, metadata)
        values (now(), ${actor.userId}, ${actor.role}, ${actor.name}, 'security', 'session_revoked', 'session_scope', ${target}, ${`Revoked ${ids.length} session(s) [${scope}]`}, 'success', ${ids.length > 0 ? 'warning' : 'info'}, ${actor.ip}, ${JSON.stringify({ scope, target, reason, revokedSessions: ids.length, revokedRefreshTokens: tokens })}::jsonb)`.execute(trx as any).catch(() => undefined);
      return { revokedSessions: ids.length, revokedRefreshTokens: tokens };
    });
  }
}

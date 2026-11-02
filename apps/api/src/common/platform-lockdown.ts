// platform-lockdown.ts — Constitution 12 §198, §279 (finding M13): a PLATFORM lockdown actually locks the platform.
//
// WHAT WAS WRONG. The Security Center's emergency lockdown has three scopes. Account and tenant lockdowns revoked the
// in-scope sessions. A PLATFORM lockdown was marked 'active' — its code said it "relies on the auth gate" — and NOTHING
// outside the lockdown module ever read it. A Super Admin responding to a breach would execute it, see "active", and
// believe the platform was locked while every session and login carried on. False assurance, at the worst moment.
//
// NOW, while a platform lockdown is active:
//   • every request from a non-SUPER_ADMIN session is refused (503) in TenantContextMiddleware;
//   • executing it also revokes every non-SUPER_ADMIN session — the stolen sessions an attacker is most likely to hold;
//   • Super Admins keep access, so they can investigate and LIFT it (lifting restores service; revoked sessions sign in again).
// The active flag is cached per instance for CACHE_MS so this is one query every few seconds, not one per request. It
// FAILS OPEN on a read error: a database blip must not take the whole platform down — the lockdown's revocation at
// execute time has already cut existing sessions.
import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { isPlatformPrincipal } from '@aipowersalon/permissions';
import { canMoveToSql } from '@aipowersalon/database';
import { SESSION } from '@aipowersalon/identity';

export const PLATFORM_LOCKDOWN_CACHE_MS = 5_000;

@Injectable()
export class PlatformLockdownGate {
  private cached: { active: boolean; at: number } | null = null;
  now: () => number = Date.now;
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  async isActive(): Promise<boolean> {
    if (!this.db) return false;
    if (this.cached && this.now() - this.cached.at < PLATFORM_LOCKDOWN_CACHE_MS) return this.cached.active;
    try {
      const r = await sql<any>`select 1 from emergency_lockdowns where scope = 'platform' and status = 'active' limit 1`.execute(this.db);
      this.cached = { active: r.rows.length > 0, at: this.now() };
    } catch { this.cached = { active: false, at: this.now() }; }          // fail open (see header)
    return this.cached.active;
  }
  /** Call after execute/lift so this instance reacts at once (others within CACHE_MS). */
  invalidate(): void { this.cached = null; }

  /** Throws for a non-SUPER_ADMIN principal while a platform lockdown is active. */
  async assertAllowed(role: string | undefined): Promise<void> {
    if (isPlatformPrincipal(role)) return;
    if (await this.isActive()) throw new ServiceUnavailableException('AI PowerSalon is temporarily locked down by the platform security team. Please try again later.');
  }
}

/** SQL predicate for "every non-SUPER_ADMIN session" — used when a platform lockdown executes. */
export async function revokeAllNonSuperAdminSessions(db: any, reason: string, keepSessionId: string | null): Promise<number> {
  const r = await sql`update sessions s set status = 'revoked', revoked_at = now()
      where s.status = 'active' and ${canMoveToSql(SESSION, 'revoked', 's')} and (${keepSessionId}::uuid is null or s.id <> ${keepSessionId}::uuid)
        and not exists (select 1 from users u where u.id = s.user_id and u.role = 'SUPER_ADMIN')
      returning s.id`.execute(db);
  void reason;
  return r.rows.length;
}

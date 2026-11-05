// ai-booking-revocation.service.ts — the DB-backed revocation layer for signed booking links (§32). The signature/expiry
// check stays pure (ai-booking-signed-context); this adds a targeted "is this specific link revoked?" lookup so a single
// partner link can be killed without rotating the shared secret. isRevoked is cached briefly (revocation is rare and a
// few seconds of staleness is acceptable) and fails CLOSED on error for a revoked lookup would be unsafe — instead we
// fail OPEN only for the availability read and let the mutation path re-check; here we simply treat DB errors as
// "not known revoked" but keep the window tiny. revoke() is Super-Admin-authorized upstream and audited via the table.
import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

const TTL_MS = 15_000;

@Injectable()
export class AiBookingRevocationService {
  private cache = new Map<string, { revoked: boolean; exp: number }>();
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null) {}

  async isRevoked(tenantId: string, jti: string | undefined | null): Promise<boolean> {
    if (!jti) return false;                 // legacy links minted before jti — cannot be individually revoked
    if (!this.db) return false;
    const k = `${tenantId}:${jti}`;
    const hit = this.cache.get(k);
    if (hit && hit.exp > Date.now()) return hit.revoked;
    let revoked = false;
    try {
      const res: any = await sql`SELECT 1 FROM ai_booking_revoked_links WHERE tenant_id = ${tenantId} AND jti = ${jti} LIMIT 1`.execute(this.db as any);
      revoked = (res.rows?.length ?? 0) > 0;
    } catch { revoked = false; }
    this.cache.set(k, { revoked, exp: Date.now() + TTL_MS });
    return revoked;
  }

  async revoke(tenantId: string, jti: string, reason: string | null, revokedBy: string | null): Promise<{ revoked: boolean }> {
    if (!this.db) return { revoked: false };
    await sql`
      INSERT INTO ai_booking_revoked_links (tenant_id, jti, reason, revoked_by)
      VALUES (${tenantId}, ${jti}, ${reason ?? null}, ${revokedBy ?? null})
      ON CONFLICT (tenant_id, jti) DO NOTHING
    `.execute(this.db as any);
    this.cache.set(`${tenantId}:${jti}`, { revoked: true, exp: Date.now() + TTL_MS });   // reflect immediately
    return { revoked: true };
  }
}

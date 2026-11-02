// ephemeral-grants.ts — short-lived single-use grants that survive restarts and work across instances (migration 456).
//
// put()  mints a 256-bit token (secure-random) and stores ONLY its SHA-256, with a payload and an expiry.
// peek() reads without consuming (a reset session survives a rejected weak password).
// take() consumes ATOMICALLY: one DELETE ... RETURNING, so of two concurrent redemptions exactly one wins — the same
//        single-use guarantee Phase 12 gave one-time codes.
// Expired rows are refused on read and swept opportunistically; nothing depends on the sweep for correctness.
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { secureToken } from '@aipowersalon/security';

export type GrantKind = 'activation_ticket' | 'password_reset_session';
export interface EphemeralGrants {
  put(kind: GrantKind, payload: unknown, ttlMs: number): Promise<string>;
  peek<T>(kind: GrantKind, token: string): Promise<T | null>;
  take<T>(kind: GrantKind, token: string): Promise<T | null>;
}
export const grantHash = (token: string) => createHash('sha256').update(`aps-grant:${token}`).digest('hex');

export class KyselyEphemeralGrants implements EphemeralGrants {
  constructor(private readonly db: any, private readonly now: () => number = Date.now) {}
  async put(kind: GrantKind, payload: unknown, ttlMs: number): Promise<string> {
    const token = secureToken(32);
    await sql`insert into ephemeral_grants (token_hash, kind, payload, expires_at) values (${grantHash(token)}, ${kind}, ${JSON.stringify(payload)}::jsonb, ${new Date(this.now() + ttlMs)})`.execute(this.db);
    if (Math.floor(this.now() / 1000) % 50 === 0) void sql`delete from ephemeral_grants where expires_at < now() - interval '1 hour'`.execute(this.db).catch(() => undefined);
    return token;
  }
  async peek<T>(kind: GrantKind, token: string): Promise<T | null> {
    if (!token) return null;
    const r = (await sql<any>`select payload from ephemeral_grants where token_hash = ${grantHash(token)} and kind = ${kind} and expires_at > ${new Date(this.now())}`.execute(this.db)).rows[0];
    return r ? (r.payload as T) : null;
  }
  async take<T>(kind: GrantKind, token: string): Promise<T | null> {
    if (!token) return null;
    const r = (await sql<any>`delete from ephemeral_grants where token_hash = ${grantHash(token)} and kind = ${kind} returning payload, expires_at`.execute(this.db)).rows[0];
    if (!r || new Date(r.expires_at).getTime() <= this.now()) return null;     // expired: deleted AND refused
    return r.payload as T;
  }
}

/** Single-process fallback for tests and database-less dev. Same semantics. */
export class InMemoryEphemeralGrants implements EphemeralGrants {
  private readonly m = new Map<string, { kind: GrantKind; payload: unknown; exp: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async put(kind: GrantKind, payload: unknown, ttlMs: number) { const t = secureToken(32); this.m.set(grantHash(t), { kind, payload: JSON.parse(JSON.stringify(payload)), exp: this.now() + ttlMs }); return t; }
  async peek<T>(kind: GrantKind, token: string) { const v = this.m.get(grantHash(token)); return v && v.kind === kind && v.exp > this.now() ? (v.payload as T) : null; }
  async take<T>(kind: GrantKind, token: string) { const k = grantHash(token); const v = this.m.get(k); if (!v || v.kind !== kind) return null; this.m.delete(k); return v.exp > this.now() ? (v.payload as T) : null; }
}

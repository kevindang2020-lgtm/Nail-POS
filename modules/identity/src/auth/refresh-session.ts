// refresh-session.ts — Constitution 3 §7–12 / §170 (Step 2, Oct 3 2026): refresh-token rotation on the refresh_tokens
// table migration 001 created (nothing used it). The ACCESS token becomes short-lived (AUTH_ACCESS_TTL, default 15 min);
// a session holds an opaque REFRESH token, rotated on every use with a compare-and-set supersede: two concurrent uses of
// the same token (a replay, §170) → the second finds it superseded, and reuse of a rotated token burns the whole family
// (every refresh token of the session, and the session itself). Only the sha256 of a token is stored.
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';

export interface RefreshTokenRow { id: string; sessionId: string; userId: string; expiresAtMs: number; revokedAt: string | null; supersededById: string | null }
export interface RefreshRepository {
  insert(row: { sessionId: string; userId: string; tokenHash: string; expiresAtMs: number; rotatedFromId?: string | null }): Promise<string>;
  findByHash(tokenHash: string): Promise<RefreshTokenRow | null>;
  /** Marks `id` superseded by `newId` ONLY if it was not superseded yet — the atomic step a replay loses. */
  supersede(id: string, newId: string): Promise<boolean>;
  revokeAllForSession(sessionId: string): Promise<void>;
}
export const hashRefreshToken = (raw: string) => createHash('sha256').update(raw).digest('hex');
const newRawToken = () => 'rt_' + randomBytes(32).toString('base64url');

export type RotateResult =
  | { ok: true; sessionId: string; userId: string; refreshToken: string; expiresAtMs: number }
  | { ok: false; reason: 'invalid' | 'expired' | 'reused' | 'session_revoked' };

export class RefreshSessionService {
  constructor(private readonly repo: RefreshRepository, private readonly sessions: { revoke(id: string): Promise<void>; isRevoked(id: string): Promise<boolean> } | null, private readonly now: () => number = () => Date.now()) {}

  /** At login: a refresh token living as long as the session. The raw token is returned ONCE and never stored. */
  async issue(sessionId: string, userId: string, ttlSeconds: number): Promise<{ refreshToken: string; expiresAtMs: number }> {
    const raw = newRawToken(); const expiresAtMs = this.now() + ttlSeconds * 1000;
    await this.repo.insert({ sessionId, userId, tokenHash: hashRefreshToken(raw), expiresAtMs });
    return { refreshToken: raw, expiresAtMs };
  }

  async rotate(raw: string): Promise<RotateResult> {
    if (typeof raw !== 'string' || !raw.startsWith('rt_') || raw.length < 20) return { ok: false, reason: 'invalid' };
    const row = await this.repo.findByHash(hashRefreshToken(raw));
    if (!row || row.revokedAt) return { ok: false, reason: 'invalid' };
    if (row.supersededById) {   // §170: a token that was already rotated is being presented again — a replay or a theft
      await this.burn(row.sessionId);
      return { ok: false, reason: 'reused' };
    }
    if (row.expiresAtMs <= this.now()) return { ok: false, reason: 'expired' };
    if (this.sessions && await this.sessions.isRevoked(row.sessionId)) return { ok: false, reason: 'session_revoked' };
    const next = newRawToken();
    const newId = await this.repo.insert({ sessionId: row.sessionId, userId: row.userId, tokenHash: hashRefreshToken(next), expiresAtMs: row.expiresAtMs, rotatedFromId: row.id });
    if (!(await this.repo.supersede(row.id, newId))) {   // lost the race to a concurrent use of the same token: replay
      await this.burn(row.sessionId);
      return { ok: false, reason: 'reused' };
    }
    return { ok: true, sessionId: row.sessionId, userId: row.userId, refreshToken: next, expiresAtMs: row.expiresAtMs };
  }

  async revokeSession(sessionId: string): Promise<void> { await this.burn(sessionId); }
  private async burn(sessionId: string): Promise<void> {
    await this.repo.revokeAllForSession(sessionId);
    if (this.sessions) await this.sessions.revoke(sessionId);
  }
}

export class KyselyRefreshRepository implements RefreshRepository {
  constructor(private readonly db: any) {}
  async insert(r: { sessionId: string; userId: string; tokenHash: string; expiresAtMs: number; rotatedFromId?: string | null }): Promise<string> {
    const res: any = await sql`insert into refresh_tokens (session_id, user_id, token_hash, rotated_from_token_id, expires_at)
      values (${r.sessionId}::uuid, ${r.userId}::uuid, ${r.tokenHash}, ${r.rotatedFromId ?? null}::uuid, ${new Date(r.expiresAtMs)}) returning id`.execute(this.db);
    return String(res.rows[0].id);
  }
  async findByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
    const res: any = await sql`select id, session_id, user_id, expires_at, revoked_at, superseded_by_token_id from refresh_tokens where token_hash = ${tokenHash}`.execute(this.db);
    const r = res.rows[0]; if (!r) return null;
    return { id: String(r.id), sessionId: String(r.session_id), userId: String(r.user_id), expiresAtMs: new Date(r.expires_at).getTime(), revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null, supersededById: r.superseded_by_token_id ? String(r.superseded_by_token_id) : null };
  }
  async supersede(id: string, newId: string): Promise<boolean> {
    const res: any = await sql`update refresh_tokens set superseded_by_token_id = ${newId}::uuid where id = ${id}::uuid and superseded_by_token_id is null and revoked_at is null`.execute(this.db);
    return Number(res.numAffectedRows ?? res.numUpdatedRows ?? 0) > 0;
  }
  async revokeAllForSession(sessionId: string): Promise<void> {
    await sql`update refresh_tokens set revoked_at = now() where session_id = ${sessionId}::uuid and revoked_at is null`.execute(this.db);
  }
}

export class InMemoryRefreshRepository implements RefreshRepository {
  rows: (RefreshTokenRow & { tokenHash: string })[] = [];
  async insert(r: { sessionId: string; userId: string; tokenHash: string; expiresAtMs: number; rotatedFromId?: string | null }) { const id = 'rt' + (this.rows.length + 1); this.rows.push({ id, sessionId: r.sessionId, userId: r.userId, tokenHash: r.tokenHash, expiresAtMs: r.expiresAtMs, revokedAt: null, supersededById: null }); return id; }
  async findByHash(h: string) { const r = this.rows.find((x) => x.tokenHash === h); return r ? { ...r } : null; }
  async supersede(id: string, newId: string) { const r = this.rows.find((x) => x.id === id); if (!r || r.supersededById || r.revokedAt) return false; r.supersededById = newId; return true; }
  async revokeAllForSession(sid: string) { for (const r of this.rows) if (r.sessionId === sid && !r.revokedAt) r.revokedAt = new Date().toISOString(); }
}

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
  /** When the token `id` was created (ms) — for a superseded token, its successor's creation is the moment it was rotated. */
  createdAtMs(id: string): Promise<number | null>;
}

/** Nov 6 2026: how long after a rotation the PREVIOUS token is still accepted (REFRESH_REUSE_GRACE_SECONDS, default 30,
 *  0 turns it off, max 120). Two POS tabs share one cookie and renew at the same moment; a reply lost on salon Wi-Fi
 *  leaves the device holding the old token. Without a grace window both looked like theft and signed the person out. */
export function refreshReuseGraceMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.REFRESH_REUSE_GRACE_SECONDS);
  const s = Number.isFinite(n) && env.REFRESH_REUSE_GRACE_SECONDS !== undefined && env.REFRESH_REUSE_GRACE_SECONDS !== '' ? n : 30;
  return Math.min(Math.max(Math.floor(s), 0), 120) * 1000;
}
export const hashRefreshToken = (raw: string) => createHash('sha256').update(raw).digest('hex');
const newRawToken = () => 'rt_' + randomBytes(32).toString('base64url');

export type RotateResult =
  | { ok: true; sessionId: string; userId: string; refreshToken: string; expiresAtMs: number }
  | { ok: false; reason: 'invalid' | 'expired' | 'reused' | 'session_revoked' };

export class RefreshSessionService {
  constructor(private readonly repo: RefreshRepository, private readonly sessions: { revoke(id: string): Promise<void>; isRevoked(id: string): Promise<boolean> } | null, private readonly now: () => number = () => Date.now(), private readonly graceMs: number = refreshReuseGraceMs()) {}

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
      // Nov 6 2026: …unless it was rotated a moment ago — the same device racing itself (a second tab, a lost reply). Then
      // this caller gets an extra valid token for the SAME session and nothing is retired: whichever reply the browser
      // keeps last, the cookie holds a token that renews. The family is not burned.
      const rotatedAt = this.graceMs > 0 ? await this.repo.createdAtMs(row.supersededById) : null;
      if (rotatedAt !== null && this.now() - rotatedAt <= this.graceMs && row.expiresAtMs > this.now()
          && !(this.sessions && await this.sessions.isRevoked(row.sessionId))) {
        return this.sibling(row);
      }
      await this.burn(row.sessionId);
      return { ok: false, reason: 'reused' };
    }
    if (row.expiresAtMs <= this.now()) return { ok: false, reason: 'expired' };
    if (this.sessions && await this.sessions.isRevoked(row.sessionId)) return { ok: false, reason: 'session_revoked' };
    const next = newRawToken();
    const newId = await this.repo.insert({ sessionId: row.sessionId, userId: row.userId, tokenHash: hashRefreshToken(next), expiresAtMs: row.expiresAtMs, rotatedFromId: row.id });
    if (!(await this.repo.supersede(row.id, newId))) {   // lost the race to a concurrent use of the same token: replay
      // Nov 6 2026: two tabs renewing at the very same instant land here too — the same device racing itself. With the
      // grace window on, the token just inserted stays valid as an extra token for the session (nothing retired).
      if (this.graceMs > 0) return { ok: true, sessionId: row.sessionId, userId: row.userId, refreshToken: next, expiresAtMs: row.expiresAtMs };
      await this.burn(row.sessionId);
      return { ok: false, reason: 'reused' };
    }
    return { ok: true, sessionId: row.sessionId, userId: row.userId, refreshToken: next, expiresAtMs: row.expiresAtMs };
  }

  /** Grace path: an extra valid token for the same session, ending when the session ends; nothing is retired. */
  private async sibling(row: RefreshTokenRow): Promise<RotateResult> {
    const next = newRawToken();
    await this.repo.insert({ sessionId: row.sessionId, userId: row.userId, tokenHash: hashRefreshToken(next), expiresAtMs: row.expiresAtMs, rotatedFromId: row.id });
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
  async createdAtMs(id: string): Promise<number | null> {
    const res: any = await sql`select created_at from refresh_tokens where id = ${id}::uuid`.execute(this.db);
    return res.rows[0] ? new Date(res.rows[0].created_at).getTime() : null;
  }
}

export class InMemoryRefreshRepository implements RefreshRepository {
  rows: (RefreshTokenRow & { tokenHash: string; createdAtMs: number })[] = [];
  constructor(private readonly clock: () => number = () => Date.now()) {}
  async insert(r: { sessionId: string; userId: string; tokenHash: string; expiresAtMs: number; rotatedFromId?: string | null }) { const id = 'rt' + (this.rows.length + 1); this.rows.push({ id, sessionId: r.sessionId, userId: r.userId, tokenHash: r.tokenHash, expiresAtMs: r.expiresAtMs, revokedAt: null, supersededById: null, createdAtMs: this.clock() }); return id; }
  async createdAtMs(id: string) { return this.rows.find((x) => x.id === id)?.createdAtMs ?? null; }

  async findByHash(h: string) { const r = this.rows.find((x) => x.tokenHash === h); return r ? { ...r } : null; }
  async supersede(id: string, newId: string) { const r = this.rows.find((x) => x.id === id); if (!r || r.supersededById || r.revokedAt) return false; r.supersededById = newId; return true; }
  async revokeAllForSession(sid: string) { for (const r of this.rows) if (r.sessionId === sid && !r.revokedAt) r.revokedAt = new Date().toISOString(); }
}

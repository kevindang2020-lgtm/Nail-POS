// refresh-session.ts — Constitution 3 §7–12 / §170 (Step 2, Oct 3 2026): refresh-token rotation on the refresh_tokens
// table migration 001 created (nothing used it). The ACCESS token becomes short-lived (AUTH_ACCESS_TTL, default 15 min);
// a session holds an opaque REFRESH token, rotated on every use with a compare-and-set supersede: two concurrent uses of
// the same token (a replay, §170) → the second finds it superseded, and reuse of a rotated token burns the whole family
// (every refresh token of the family, and the session itself). Only the sha256 of a token is stored.
//
// Secure Tap to Pay M6-6 (Oct 23 2026, migration 689): the family is NAMED (refresh_tokens.family_id — login issues the
// root, every rotation inherits it; a legacy row's family is its session), and a session opened on a payment phone is only
// extended while that phone is in good standing: the REFRESH_DEVICE_GUARD port (refresh-device-guard.ts, provided by the
// module that owns mobile_pay_devices) answers DEVICE_REVOKED (the session + family end — §16 / §61) or DEVICE_SUSPENDED
// (this refresh is refused). A guard that cannot answer fails the refresh closed.
//
// Nov 6 2026 (merged Nov 7): a short grace window (REFRESH_REUSE_GRACE_SECONDS) lets the same device race itself — two
// POS tabs renewing together, or a reply lost on salon Wi-Fi — without that reading as theft. The grace path still asks
// the payment-device guard first, so a revoked phone never gets an extra token.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { RefreshDeviceGuardPort } from './refresh-device-guard';

export interface RefreshTokenRow {
  id: string; sessionId: string; userId: string; expiresAtMs: number; revokedAt: string | null; supersededById: string | null;
  /** 689: the rotation chain this token belongs to (a legacy row reads as its session id) */
  familyId?: string;
  /** the session's salon and the per-install device id it was opened on (sessions.tenant_id / device_id) — null when absent */
  tenantId?: string | null;
  deviceId?: string | null;
}
export interface RefreshRepository {
  insert(row: { sessionId: string; userId: string; tokenHash: string; expiresAtMs: number; rotatedFromId?: string | null; familyId?: string | null }): Promise<string>;
  findByHash(tokenHash: string): Promise<RefreshTokenRow | null>;
  /** Marks `id` superseded by `newId` ONLY if it was not superseded yet — the atomic step a replay loses. */
  supersede(id: string, newId: string): Promise<boolean>;
  revokeAllForSession(sessionId: string): Promise<void>;
  /** M6-6: every live token of the family (a reuse of any one of them burns them all). Optional for older repositories. */
  revokeFamily?(familyId: string): Promise<void>;
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
  | { ok: false; reason: 'invalid' | 'expired' | 'session_revoked' }
  /** Security Deep Scan C13: a reuse names the burned session and its account, so the event and the alert can too.
   *  M6-6: and the family that was revoked. */
  | { ok: false; reason: 'reused'; sessionId: string; userId: string; familyId: string }
  /** M6-6 (§16 / §61): the session was opened on a payment phone that is revoked / compromised (session ended) or
   *  suspended (refused, session kept). `device_check_failed`: the device registry could not answer — fail closed. */
  | { ok: false; reason: 'device_revoked' | 'device_suspended' | 'device_check_failed'; sessionId: string; userId: string; tenantId: string | null; deviceId: string | null };

export class RefreshSessionService {
  constructor(
    private readonly repo: RefreshRepository,
    private readonly sessions: { revoke(id: string): Promise<void>; isRevoked(id: string): Promise<boolean> } | null,
    private readonly now: () => number = () => Date.now(),
    /** M6-6: the payment-device registry's answer, resolved per call (null = this API has no payment module) */
    private readonly deviceGuard: () => RefreshDeviceGuardPort | null = () => null,
    /** Nov 6 2026: the reuse grace window in ms (0 = off) */
    private readonly graceMs: number = refreshReuseGraceMs(),
  ) {}

  /** At login: a refresh token living as long as the session — the ROOT of a new family. The raw token is returned ONCE
   *  and never stored. */
  async issue(sessionId: string, userId: string, ttlSeconds: number): Promise<{ refreshToken: string; expiresAtMs: number; familyId: string }> {
    const raw = newRawToken(); const expiresAtMs = this.now() + ttlSeconds * 1000; const familyId = randomUUID();
    await this.repo.insert({ sessionId, userId, tokenHash: hashRefreshToken(raw), expiresAtMs, familyId });
    return { refreshToken: raw, expiresAtMs, familyId };
  }

  async rotate(raw: string): Promise<RotateResult> {
    if (typeof raw !== 'string' || !raw.startsWith('rt_') || raw.length < 20) return { ok: false, reason: 'invalid' };
    const row = await this.repo.findByHash(hashRefreshToken(raw));
    if (!row || row.revokedAt) return { ok: false, reason: 'invalid' };
    const familyId = row.familyId ?? row.sessionId;
    if (row.supersededById) {   // §170: a token that was already rotated is being presented again — a replay or a theft
      // Nov 6 2026: …unless it was rotated a moment ago — the same device racing itself (a second tab, a lost reply). Then
      // this caller gets an extra valid token for the SAME session and family and nothing is retired. The family is not
      // burned. The payment-device guard still answers first (a revoked phone gets nothing).
      const rotatedAt = this.graceMs > 0 ? await this.repo.createdAtMs(row.supersededById) : null;
      if (rotatedAt !== null && this.now() - rotatedAt <= this.graceMs && row.expiresAtMs > this.now()
          && !(this.sessions && await this.sessions.isRevoked(row.sessionId))) {
        const blocked = await this.deviceBlock(row, familyId);
        if (blocked) return blocked;
        return this.sibling(row, familyId);
      }
      await this.burn(row.sessionId, familyId);
      return { ok: false, reason: 'reused', sessionId: row.sessionId, userId: row.userId, familyId };
    }
    if (row.expiresAtMs <= this.now()) return { ok: false, reason: 'expired' };
    if (this.sessions && await this.sessions.isRevoked(row.sessionId)) return { ok: false, reason: 'session_revoked' };
    const blocked = await this.deviceBlock(row, familyId);
    if (blocked) return blocked;
    const next = newRawToken();
    const newId = await this.repo.insert({ sessionId: row.sessionId, userId: row.userId, tokenHash: hashRefreshToken(next), expiresAtMs: row.expiresAtMs, rotatedFromId: row.id, familyId });
    if (!(await this.repo.supersede(row.id, newId))) {   // lost the race to a concurrent use of the same token: replay
      // Nov 6 2026: two tabs renewing at the very same instant land here too — the same device racing itself. With the
      // grace window on, the token just inserted stays valid as an extra token for the session (nothing retired).
      if (this.graceMs > 0) return { ok: true, sessionId: row.sessionId, userId: row.userId, refreshToken: next, expiresAtMs: row.expiresAtMs };
      await this.burn(row.sessionId, familyId);
      return { ok: false, reason: 'reused', sessionId: row.sessionId, userId: row.userId, familyId };
    }
    return { ok: true, sessionId: row.sessionId, userId: row.userId, refreshToken: next, expiresAtMs: row.expiresAtMs };
  }

  /** M6-6 (§16 / §61): a session opened on a payment phone lives only as long as that phone is in good standing.
   *  Returns the refusal, or null when the refresh may go on. */
  private async deviceBlock(row: RefreshTokenRow, familyId: string): Promise<RotateResult | null> {
    const guard = row.deviceId && row.tenantId ? this.deviceGuard() : null;
    if (!guard || !row.deviceId || !row.tenantId) return null;
    const who = { sessionId: row.sessionId, userId: row.userId, tenantId: row.tenantId, deviceId: row.deviceId };
    let block: Awaited<ReturnType<RefreshDeviceGuardPort['refreshBlock']>>;
    try { block = await guard.refreshBlock({ tenantId: row.tenantId, userId: row.userId, deviceId: row.deviceId, sessionId: row.sessionId }); }
    catch (e) {
      console.warn('[refresh] payment-device check failed — refresh refused (fail closed):', (e as Error)?.message);
      return { ok: false, reason: 'device_check_failed', ...who };
    }
    if (!block) return null;
    if (block.endSession) await this.burn(row.sessionId, familyId);
    return { ok: false, reason: block.code === 'DEVICE_REVOKED' ? 'device_revoked' : 'device_suspended', ...who };
  }

  /** Grace path: an extra valid token for the same session and family, ending when the session ends; nothing is retired. */
  private async sibling(row: RefreshTokenRow, familyId: string): Promise<RotateResult> {
    const next = newRawToken();
    await this.repo.insert({ sessionId: row.sessionId, userId: row.userId, tokenHash: hashRefreshToken(next), expiresAtMs: row.expiresAtMs, rotatedFromId: row.id, familyId });
    return { ok: true, sessionId: row.sessionId, userId: row.userId, refreshToken: next, expiresAtMs: row.expiresAtMs };
  }

  async revokeSession(sessionId: string): Promise<void> { await this.burn(sessionId, null); }
  private async burn(sessionId: string, familyId: string | null): Promise<void> {
    if (familyId && this.repo.revokeFamily) await this.repo.revokeFamily(familyId);
    await this.repo.revokeAllForSession(sessionId);
    if (this.sessions) await this.sessions.revoke(sessionId);
  }
}

export class KyselyRefreshRepository implements RefreshRepository {
  constructor(private readonly db: any) {}
  async insert(r: { sessionId: string; userId: string; tokenHash: string; expiresAtMs: number; rotatedFromId?: string | null; familyId?: string | null }): Promise<string> {
    const res: any = await sql`insert into refresh_tokens (session_id, user_id, token_hash, rotated_from_token_id, expires_at, family_id)
      values (${r.sessionId}::uuid, ${r.userId}::uuid, ${r.tokenHash}, ${r.rotatedFromId ?? null}::uuid, ${new Date(r.expiresAtMs)}, ${r.familyId ?? null}::uuid) returning id`.execute(this.db);
    return String(res.rows[0].id);
  }
  async findByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
    const res: any = await sql`select rt.id, rt.session_id, rt.user_id, rt.expires_at, rt.revoked_at, rt.superseded_by_token_id, coalesce(rt.family_id, rt.session_id) as family_id,
                                      s.tenant_id, s.device_id
                                 from refresh_tokens rt left join sessions s on s.id = rt.session_id
                                where rt.token_hash = ${tokenHash}`.execute(this.db);
    const r = res.rows[0]; if (!r) return null;
    return { id: String(r.id), sessionId: String(r.session_id), userId: String(r.user_id), expiresAtMs: new Date(r.expires_at).getTime(), revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null, supersededById: r.superseded_by_token_id ? String(r.superseded_by_token_id) : null,
      familyId: String(r.family_id), tenantId: r.tenant_id ? String(r.tenant_id) : null, deviceId: r.device_id ? String(r.device_id) : null };
  }
  async supersede(id: string, newId: string): Promise<boolean> {
    const res: any = await sql`update refresh_tokens set superseded_by_token_id = ${newId}::uuid where id = ${id}::uuid and superseded_by_token_id is null and revoked_at is null`.execute(this.db);
    return Number(res.numAffectedRows ?? res.numUpdatedRows ?? 0) > 0;
  }
  async revokeAllForSession(sessionId: string): Promise<void> {
    await sql`update refresh_tokens set revoked_at = now() where session_id = ${sessionId}::uuid and revoked_at is null`.execute(this.db);
  }
  async revokeFamily(familyId: string): Promise<void> {
    await sql`update refresh_tokens set revoked_at = now() where (family_id = ${familyId}::uuid or (family_id is null and session_id = ${familyId}::uuid)) and revoked_at is null`.execute(this.db);
  }
  async createdAtMs(id: string): Promise<number | null> {
    const res: any = await sql`select created_at from refresh_tokens where id = ${id}::uuid`.execute(this.db);
    return res.rows[0] ? new Date(res.rows[0].created_at).getTime() : null;
  }
}

export class InMemoryRefreshRepository implements RefreshRepository {
  rows: (RefreshTokenRow & { tokenHash: string; createdAtMs: number })[] = [];
  constructor(private readonly clock: () => number = () => Date.now()) {}
  /** tests: the (tenant, device) a session was opened on — what the sessions row says in Postgres */
  sessionDevices = new Map<string, { tenantId: string; deviceId: string }>();
  async insert(r: { sessionId: string; userId: string; tokenHash: string; expiresAtMs: number; rotatedFromId?: string | null; familyId?: string | null }) { const id = 'rt' + (this.rows.length + 1); this.rows.push({ id, sessionId: r.sessionId, userId: r.userId, tokenHash: r.tokenHash, expiresAtMs: r.expiresAtMs, revokedAt: null, supersededById: null, familyId: r.familyId ?? r.sessionId, createdAtMs: this.clock() }); return id; }
  async createdAtMs(id: string) { return this.rows.find((x) => x.id === id)?.createdAtMs ?? null; }
  async findByHash(h: string) { const r = this.rows.find((x) => x.tokenHash === h); if (!r) return null; const d = this.sessionDevices.get(r.sessionId); return { ...r, tenantId: d?.tenantId ?? null, deviceId: d?.deviceId ?? null }; }
  async supersede(id: string, newId: string) { const r = this.rows.find((x) => x.id === id); if (!r || r.supersededById || r.revokedAt) return false; r.supersededById = newId; return true; }
  async revokeAllForSession(sid: string) { for (const r of this.rows) if (r.sessionId === sid && !r.revokedAt) r.revokedAt = new Date().toISOString(); }
  async revokeFamily(fid: string) { for (const r of this.rows) if ((r.familyId ?? r.sessionId) === fid && !r.revokedAt) r.revokedAt = new Date().toISOString(); }
}

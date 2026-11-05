// session-store.ts — makes session revocation ACTUALLY revoke.
//
// The bug this fixes: the app already exposed "sign out other devices" (profile `listSessions` / `revokeSession`,
// plus Super Admin session controls). Revoking flipped `sessions.status = 'revoked'` — but **no guard ever read
// that table**, and a normal login never even inserted a session row. The session cookie is a stateless signed
// token, so a "revoked" session kept working until it expired. Users and Super Admins were told a compromised
// session had been killed while it stayed live — up to 12h, or 30 DAYS with "Remember me".
//
// The fix has three parts:
//   1. Login now creates a row in the existing `sessions` table and embeds its id (`sid`) in the signed claims.
//   2. The auth chokepoint (tenant-context middleware) checks that `sid` against the table.
//   3. Revocation therefore takes effect on the very next request.
//
// Two deliberate properties:
//   • BACKWARD COMPATIBLE — a token minted before this change has no `sid`, so it is accepted exactly as before.
//     Nobody is signed out by the deploy.
//   • FAILS OPEN, ON PURPOSE — if the revocation lookup errors (DB blip), the request proceeds on the strength of
//     the verified signature. Failing closed would take the entire app down on a transient DB error, which is a
//     worse outcome than a revocation taking effect a few seconds late. Errors are not silently "clean": the
//     cache is not poisoned, so the next request retries.
import { canMoveToSql } from '@aipowersalon/database';
import { SESSION } from './identity-lifecycles';
import { type AppDatabase, safeInet } from '@aipowersalon/database';
import { sql } from 'kysely';
import { randomUUID } from 'crypto';
import { AUTO_LOCK_DEFAULT, POS_CLIENT_TYPE, SESSION_LOCK_MAX_MS as LOCK_MAX_MS, serverLockedAt, type AutoLockPolicy, type SessionLockFacts } from '@aipowersalon/api-contracts';

const clip = (v: string | null | undefined, n: number) => (v ? String(v).slice(0, n) : null);

export interface NewSession {
  userId: string;
  tenantId: string | null;
  branchId: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Constitution 12 §144: a per-install id and a display label the app supplies (never a security decision). */
  deviceId?: string | null;
  deviceName?: string | null;
  platform?: string | null;
  /** Constitution 3 §21–24: the auth_devices row this session came from, and whether its sign-in proved a second factor. */
  authDeviceId?: string | null;
  mfaVerified?: boolean;
  /** Constitution 3 §55–57: how this session's sign-in proved identity ('password' | 'password_mfa' | 'passkey'). */
  authStrength?: string | null;
  /** Oct 12 2026 (Kevin's POS auto-lock): 'pos' when the POS web app signed in (X-Client-Type: pos) — only such a session is
   *  idle-locked by the server. Anything else is stored as null. */
  clientApp?: string | null;
  ttlSeconds: number;
}
/** How the session store learns a salon's auto-lock policy, and what time it is (injectable: tests and the live proof). */
export interface SessionStoreOptions {
  idleLockPolicy?: (tenantId: string) => Promise<AutoLockPolicy>;
  now?: () => number;
}
export interface SessionLockFactsResult { facts: SessionLockFacts; policy: AutoLockPolicy; now: number }

export interface SessionStore {
  /** Create a session row and return its id, to be embedded in the signed token as `sid`. */
  create(s: NewSession): Promise<string | null>;
  /** True when this session has been revoked (or no longer exists / has expired). */
  isRevoked(sessionId: string): Promise<boolean>;
  /** Revoke a session server-side. Used by logout — clearing the cookie alone does NOT invalidate a token that
   *  was already captured, and it leaves a stale row in the user's "active sessions" list. */
  revoke(sessionId: string): Promise<void>;
  /** Decision 35 — idle lock, server side. lock() stamps the session; unlock() clears it after a correct PIN;
   *  lockedAt() is when it was locked (ms) or null. Optional so older stores keep compiling (they never lock). */
  lock?(sessionId: string): Promise<void>;
  unlock?(sessionId: string): Promise<void>;
  lockedAt?(sessionId: string): Promise<number | null>;
  /** Oct 12 2026 — the SERVER's idle lock. lockedAt() also answers for a POS session nobody used for the salon's minutes
   *  (locked from last activity + minutes, written to the row). touchActivity() is a person's activity on the POS (the only
   *  thing that moves the idle clock — reads, polling and streams never do); it never unlocks a locked session. */
  touchActivity?(sessionId: string): Promise<void>;
  lockFacts?(sessionId: string): Promise<SessionLockFactsResult | null>;
  /** One more wrong PIN on this session; returns the count since the last correct PIN (unlock() resets it). */
  recordPinFailure?(sessionId: string): Promise<number>;
}
/** A session locked longer than this is revoked: quick PIN is no longer enough (Kevin: full sign-in after 8 hours locked). */
export const SESSION_LOCK_MAX_MS = LOCK_MAX_MS;
const clientAppOf = (v: string | null | undefined): string | null => (v === POS_CLIENT_TYPE ? POS_CLIENT_TYPE : null);
const ms = (v: unknown): number | null => (v ? new Date(v as any).getTime() : null);

const isUuid = (v: string | null | undefined) =>
  !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export class KyselySessionStore implements SessionStore {
  // Short-lived cache so we don't add a database round-trip to every authenticated request. A revocation takes
  // effect within CACHE_MS. Only NEGATIVE results (not revoked) are cached — a revoked session is remembered
  // permanently for the process, so it can never come back to life from a stale cache entry.
  private static readonly CACHE_MS = 15_000;
  private readonly ok = new Map<string, number>();   // sid -> timestamp verified-not-revoked
  private readonly revoked = new Set<string>();
  // Decision 35: lock state rides the same cached read. A lock/unlock made through THIS process is effective at once;
  // one made on another instance within CACHE_MS (the same bound revocation already has).
  // Oct 12 2026: the row's lock facts (locked_at, client_app, tenant_id, last_activity_at) ride the same cached read.
  private readonly facts = new Map<string, SessionLockFacts>();
  private readonly now: () => number;
  private readonly policyOf: (tenantId: string) => Promise<AutoLockPolicy>;

  constructor(private readonly db: AppDatabase, opts: SessionStoreOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.policyOf = opts.idleLockPolicy ?? (async () => AUTO_LOCK_DEFAULT);
  }

  /**
   * Create the session row whose id goes into the token as `sid`.
   *
   * The subtlety that matters: returning `null` here means the token is minted WITHOUT a `sid`, and a token with
   * no `sid` is **UNREVOCABLE** — the middleware skips the revocation check for it. So "swallow the error and
   * return null" quietly downgrades security in a way nobody can see: the sign-in succeeds, everything looks
   * fine, and "sign out other devices" simply will not work for that session, forever.
   *
   * So `null` is reserved for the ONE case where it is honest: no database at all (dev/tests), where there is no
   * revocation to speak of. If a database IS configured and the insert fails — a bad user id, an FK violation,
   * a NOT NULL breach — that is a real error, not a transient blip (the login already read from this database to
   * get here), and it must NOT be papered over with an unrevocable session. It throws, and the sign-in fails
   * loudly.
   *
   * Failing a login is bad. Silently issuing a session that can never be revoked is worse.
   */
  async create(s: NewSession): Promise<string | null> {
    if (!this.db) return null;                     // no database → no revocation to lose
    if (!isUuid(s.userId)) {
      throw new Error('SessionStore.create: userId is not a UUID — refusing to mint an unrevocable session.');
    }
    const id = randomUUID();
    await sql`
      insert into sessions (id, user_id, tenant_id, branch_id, ip_address, user_agent, device_id, device_name, platform, status, expires_at, last_seen_at, auth_device_id, last_mfa_at, last_primary_auth_at, auth_strength)
      values (${id}, ${s.userId}, ${isUuid(s.tenantId) ? s.tenantId : null},
              ${isUuid(s.branchId) ? s.branchId : null}, ${safeInet(s.ip)}, ${clip(s.userAgent, 300)},
              ${clip(s.deviceId, 80)}, ${clip(s.deviceName, 80)}, ${clip(s.platform, 20)}, 'active',
              now() + make_interval(secs => ${s.ttlSeconds}), now(),
              ${isUuid(s.authDeviceId) ? s.authDeviceId : null}, ${s.mfaVerified ? sql`now()` : null}, now(),
              ${s.authStrength ? String(s.authStrength).slice(0, 20) : (s.mfaVerified ? 'password_mfa' : 'password')})`.execute(this.db);
    // Oct 12 2026: a POS session starts its idle clock at sign-in (one clock — the store's — for writing and comparing).
    const app = clientAppOf(s.clientApp);
    if (app) await sql`update sessions set client_app = ${app}, last_activity_at = ${new Date(this.now())} where id = ${id}`.execute(this.db);
    return id;
  }

  async revoke(sessionId: string): Promise<void> {
    if (!sessionId || !this.db) return;
    this.revoked.add(sessionId);   // effective immediately in this process, even before the write lands
    this.ok.delete(sessionId);
    try {
      await sql`update sessions set status = 'revoked', revoked_at = now() where id = ${sessionId} and ${canMoveToSql(SESSION, 'revoked')}`.execute(this.db);
    } catch { /* the in-process denial still stands; the row will also be caught by expiry */ }
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    if (!sessionId || !this.db) return false;
    if (this.revoked.has(sessionId)) return true;                     // sticky: never un-revoke
    const seen = this.ok.get(sessionId);
    if (seen && Date.now() - seen < KyselySessionStore.CACHE_MS) return false;
    try {
      // §146 last_seen_at rides the revocation read, at most once per CACHE_MS (the cache above bounds it) and only
      // when a minute has passed — so the sessions list can show "last used 2 minutes ago" without a write per request.
      const db = this.db;
      const touched: any = await sql`update sessions set last_seen_at = now() where id = ${sessionId} and (last_seen_at is null or last_seen_at < now() - interval '1 minute') returning status, locked_at, client_app, tenant_id, last_activity_at, revoked_at, (expires_at is not null and expires_at < now()) as expired`.execute(db);
      const r: any = touched.rows?.length ? touched : await sql`select status, locked_at, client_app, tenant_id, last_activity_at, revoked_at, (expires_at is not null and expires_at < now()) as expired from sessions where id = ${sessionId} limit 1`.execute(db);
      const row = r?.rows?.[0];
      // A row we don't recognize is NOT treated as revoked: tokens minted before this change have no row, and
      // signing those users out would be a self-inflicted outage.
      if (!row) { this.ok.set(sessionId, Date.now()); return false; }
      // Oct 12 2026 merge (workforce audit P0 #4): revoked = status 'revoked' OR revoked_at stamped OR expired. The
      // platform suspend/lock/revoke-sessions path wrote only `revoked_at` while this guard read only `status`, so a
      // session the operator was told had been killed kept working until it expired. Any marker now ends it.
      if (String(row.status ?? '').toLowerCase() === 'revoked' || row.revoked_at != null || row.expired === true) { this.revoked.add(sessionId); this.ok.delete(sessionId); return true; }
      this.facts.set(sessionId, { lockedAt: ms(row.locked_at), clientApp: clientAppOf(row.client_app), tenantId: row.tenant_id ?? null, lastActivityAt: ms(row.last_activity_at) });
      this.ok.set(sessionId, Date.now());
      return false;
    } catch {
      return false;   // fail open on a lookup error (see header); the cache is not poisoned, so we retry next time
    }
  }

  // ── Decision 35: idle lock, server side ──
  async lock(sessionId: string): Promise<void> {
    if (!sessionId || !this.db) return;
    const at = this.now();
    const f = this.facts.get(sessionId);
    if (f && !f.lockedAt) this.facts.set(sessionId, { ...f, lockedAt: at });
    await sql`update sessions set locked_at = coalesce(locked_at, ${new Date(at)}) where id = ${sessionId}`.execute(this.db).catch(() => undefined);
    this.ok.delete(sessionId);   // re-read the stored (first) lock time on the next request
  }
  /** A correct PIN: unlocked, and the idle clock restarts now (else a session idle for an hour would re-lock at once). */
  async unlock(sessionId: string): Promise<void> {
    if (!sessionId || !this.db) return;
    const at = this.now();
    const f = this.facts.get(sessionId);
    if (f) this.facts.set(sessionId, { ...f, lockedAt: null, lastActivityAt: f.clientApp ? at : f.lastActivityAt });
    await sql`update sessions set locked_at = null, pin_failures = 0, last_activity_at = case when client_app is null then last_activity_at else ${new Date(at)} end where id = ${sessionId}`.execute(this.db).catch(() => undefined);
  }
  async recordPinFailure(sessionId: string): Promise<number> {
    if (!sessionId || !this.db) return 0;
    const r: any = await sql`update sessions set pin_failures = pin_failures + 1 where id = ${sessionId} returning pin_failures`.execute(this.db);
    return Number(r.rows?.[0]?.pin_failures ?? 0);
  }
  async touchActivity(sessionId: string): Promise<void> {
    if (!sessionId || !this.db) return;
    const at = this.now();
    const f = this.facts.get(sessionId);
    if (f?.clientApp && !f.lockedAt) this.facts.set(sessionId, { ...f, lastActivityAt: Math.max(at, f.lastActivityAt ?? 0) });
    // never on a locked row; never backwards
    await sql`update sessions set last_activity_at = greatest(coalesce(last_activity_at, ${new Date(at)}), ${new Date(at)}) where id = ${sessionId} and client_app is not null and locked_at is null`.execute(this.db).catch(() => undefined);
  }
  private async loadFacts(sessionId: string, fresh = false): Promise<SessionLockFacts | null> {
    if (fresh || !this.facts.has(sessionId)) { this.ok.delete(sessionId); await this.isRevoked(sessionId); }   // fills the facts from the row
    return this.facts.get(sessionId) ?? null;
  }
  async lockedAt(sessionId: string): Promise<number | null> {
    if (!sessionId || !this.db) return null;
    let f = await this.loadFacts(sessionId);
    if (!f) return null;
    if (f.lockedAt) return f.lockedAt;
    if (f.clientApp !== POS_CLIENT_TYPE || !f.tenantId) return null;
    const policy = await this.policyOf(f.tenantId).catch(() => AUTO_LOCK_DEFAULT);
    if (!serverLockedAt(f, policy, this.now())) return null;
    // About to lock on cached facts: re-read the row first — activity on another API server in the last seconds must win.
    f = await this.loadFacts(sessionId, true);
    const at = f ? serverLockedAt(f, policy, this.now()) : null;
    if (!f || !at) return null;
    this.facts.set(sessionId, { ...f, lockedAt: at });
    await sql`update sessions set locked_at = coalesce(locked_at, ${new Date(at)}) where id = ${sessionId}`.execute(this.db).catch(() => undefined);
    return at;
  }
  async lockFacts(sessionId: string): Promise<SessionLockFactsResult | null> {
    if (!sessionId || !this.db) return null;
    const f = await this.loadFacts(sessionId);
    if (!f) return null;
    const policy = f.tenantId ? await this.policyOf(f.tenantId).catch(() => AUTO_LOCK_DEFAULT) : AUTO_LOCK_DEFAULT;
    return { facts: { ...f }, policy, now: this.now() };
  }
}

/** In-memory store for tests / no-DB dev. */
export class InMemorySessionStore implements SessionStore {
  private readonly rows = new Map<string, { revoked: boolean; pinFailures?: number } & SessionLockFacts>();
  private readonly now: () => number;
  private readonly policyOf: (tenantId: string) => Promise<AutoLockPolicy>;
  constructor(opts: SessionStoreOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.policyOf = opts.idleLockPolicy ?? (async () => AUTO_LOCK_DEFAULT);
  }
  async create(s: NewSession): Promise<string> {
    const id = randomUUID();
    const app = clientAppOf(s.clientApp);
    this.rows.set(id, { revoked: false, lockedAt: null, clientApp: app, tenantId: isUuid(s.tenantId) ? s.tenantId : null, lastActivityAt: app ? this.now() : null });
    return id;
  }
  async lock(sessionId: string, at = this.now()): Promise<void> { const r = this.rows.get(sessionId); if (r && !r.lockedAt) r.lockedAt = at; }
  async unlock(sessionId: string): Promise<void> { const r = this.rows.get(sessionId); if (r) { r.lockedAt = null; r.pinFailures = 0; if (r.clientApp) r.lastActivityAt = this.now(); } }
  async recordPinFailure(sessionId: string): Promise<number> { const r = this.rows.get(sessionId); if (!r) return 0; r.pinFailures = (r.pinFailures ?? 0) + 1; return r.pinFailures; }
  async touchActivity(sessionId: string): Promise<void> { const r = this.rows.get(sessionId); if (r?.clientApp && !r.lockedAt) r.lastActivityAt = Math.max(this.now(), r.lastActivityAt ?? 0); }
  async lockedAt(sessionId: string): Promise<number | null> {
    const r = this.rows.get(sessionId); if (!r) return null;
    if (r.lockedAt) return r.lockedAt;
    if (r.clientApp !== POS_CLIENT_TYPE || !r.tenantId) return null;
    const at = serverLockedAt(r, await this.policyOf(r.tenantId), this.now());
    if (at) r.lockedAt = at;
    return at;
  }
  async lockFacts(sessionId: string): Promise<SessionLockFactsResult | null> {
    const r = this.rows.get(sessionId); if (!r) return null;
    const { revoked: _r, pinFailures: _p, ...facts } = r;
    return { facts, policy: r.tenantId ? await this.policyOf(r.tenantId) : AUTO_LOCK_DEFAULT, now: this.now() };
  }
  async isRevoked(sessionId: string): Promise<boolean> {
    return this.rows.get(sessionId)?.revoked === true;
  }
  async revoke(sessionId: string): Promise<void> { const r = this.rows.get(sessionId); if (r) r.revoked = true; }
}

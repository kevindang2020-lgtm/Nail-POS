// password-reset.ports.kysely.ts — production Ports for PasswordResetService backed by Postgres (Kysely), real scrypt
// hashing (password.ts), HMAC session issuance (auth-session-token), crypto RNG, and an injected SMS sender. Rate limits
// are kept in-process (swap for Redis in a multi-instance deploy); audit is a no-op hook here. A NullResetPorts is also
// exported for DB-less dev so the endpoints still respond (always-generic) without a database.
import { canMoveToSql } from '@aipowersalon/database';
import { SESSION } from './identity-lifecycles';
import { KyselyEphemeralGrants, hashPassword, verifyPassword } from '@aipowersalon/auth';
import { randomBytes, randomInt } from 'node:crypto';
import { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { Ports, TenantRow, UserRow, TokenRow } from './password-reset.service';
import { signSession } from './auth-session-token';
import type { SmsSender } from '@aipowersalon/notifications';
import { propagateTechnicianPassword } from './password-scope';

const nowMs = () => Date.now();
const ms = (v: unknown): number => (v == null ? 0 : v instanceof Date ? v.getTime() : new Date(v as string).getTime());

const hasher = { hash: (s: string) => hashPassword(s), verify: (s: string, h: string) => verifyPassword(s, h) };
const clock = { now: () => nowMs(), iso: () => new Date().toISOString() };
const rng = { sixDigits: () => randomInt(0, 1_000_000), token: () => randomBytes(24).toString('hex') };

// in-process sliding-window rate limiter (per-phone / per-ip, last hour)
function makeRate() {
  const phone = new Map<string, number[]>(); const ip = new Map<string, number[]>();
  const recent = (m: Map<string, number[]>, k: string) => { const cut = nowMs() - 3_600_000; const arr = (m.get(k) || []).filter((t) => t >= cut); m.set(k, arr); return arr.length; };
  return {
    async counts(p: string, i?: string) { return { phoneLastHour: recent(phone, p), ipLastHour: i ? recent(ip, i) : 0, tokenAttempts: 0 }; },
    async bump(p: string, i?: string) { (phone.get(p) || phone.set(p, []).get(p)!).push(nowMs()); if (i) (ip.get(i) || ip.set(i, []).get(i)!).push(nowMs()); },
  };
}
const audit = { async record() { /* best-effort no-op hook; wire to audit_logs when needed */ } };

const SESSION_TTL = Number(process.env.AUTH_SESSION_TTL) || 60 * 60 * 12;

export function makeKyselyResetPorts(db: Kysely<DB>, sms: SmsSender): Ports {
  return {
    grants: new KyselyEphemeralGrants(db),   // durable, cross-instance reset sessions (migration 456)
    sms, hasher, clock, rng, audit, rate: makeRate(),
    tenants: {
      async findActiveByCode(code: string): Promise<TenantRow | null> {
        const r = await db.selectFrom('tenants').select(['id', 'display_name', 'tenant_code', 'status'])
          .where('tenant_code', '=', code).where('status', '=', 'active').executeTakeFirst();
        return r ? { tenantId: r.id, salonName: r.display_name, tenantCode: r.tenant_code, status: r.status } : null;
      },
    },
    users: {
      async findActiveByTenantPhone(tenantId: string, phone: string): Promise<UserRow | null> {
        const r = await db.selectFrom('users')
          .select(['id', 'tenant_id', 'full_name', 'role', 'status', 'normalized_phone', 'branch_id'])
          .where('tenant_id', '=', tenantId).where('normalized_phone', '=', phone).where('status', '=', 'active')
          .executeTakeFirst();
        return r ? { userId: r.id, tenantId: r.tenant_id ?? tenantId, fullName: r.full_name ?? '', role: String(r.role), status: String(r.status), normalizedPhone: r.normalized_phone, permissions: [], branchId: r.branch_id ?? '', branchName: '' } : null;
      },
      async findForLogin(tenantCodeOrSlug: string, emailOrPhone: string): Promise<{ user: UserRow; tenant: TenantRow } | null> {
        if (!tenantCodeOrSlug && !emailOrPhone) return null;
        const t = await db.selectFrom('tenants').select(['id', 'display_name', 'tenant_code', 'status'])
          .where((eb) => eb.or([eb('tenant_code', '=', tenantCodeOrSlug), eb('tenant_slug', '=', tenantCodeOrSlug)])).executeTakeFirst();
        if (!t) return null;
        const u = await db.selectFrom('users')
          .select(['id', 'tenant_id', 'full_name', 'role', 'status', 'normalized_phone', 'branch_id'])
          .where('tenant_id', '=', t.id)
          .where((eb) => eb.or([eb('email', '=', emailOrPhone), eb('normalized_phone', '=', emailOrPhone)])).executeTakeFirst();
        if (!u) return null;
        return {
          user: { userId: u.id, tenantId: u.tenant_id ?? t.id, fullName: u.full_name ?? '', role: String(u.role), status: String(u.status), normalizedPhone: u.normalized_phone, permissions: [], branchId: u.branch_id ?? '', branchName: '' },
          tenant: { tenantId: t.id, salonName: t.display_name, tenantCode: t.tenant_code, status: t.status },
        };
      },
      async setPasswordHash(userId: string, hash: string): Promise<void> {
        await db.updateTable('users').set({ password_hash: hash, password_changed_at: new Date(), updated_at: new Date() }).where('id', '=', userId).execute();
        // A technician has ONE password. See auth/password-scope.ts.
        await propagateTechnicianPassword(db, userId, hash);
      },
    },
    tokens: {
      async create(row: Omit<TokenRow, 'id'>): Promise<TokenRow> {
        const r = await db.insertInto('password_reset_tokens').values({
          user_id: row.userId, tenant_id: row.tenantId, token_hash: row.tokenHash, token_type: row.tokenType,
          expires_at: new Date(row.expiresAt), used_at: null, attempt_count: row.attemptCount, max_attempts: row.maxAttempts,
        }).returning(['id']).executeTakeFirstOrThrow();
        return { id: r.id, ...row };
      },
      async latestUsable(tenantId: string, userId: string): Promise<TokenRow | null> {
        const r = await db.selectFrom('password_reset_tokens')
          .select(['id', 'tenant_id', 'user_id', 'token_hash', 'token_type', 'expires_at', 'used_at', 'attempt_count', 'max_attempts'])
          .where('tenant_id', '=', tenantId).where('user_id', '=', userId).where('used_at', 'is', null)
          .orderBy('created_at', 'desc').executeTakeFirst();
        return r ? { id: r.id, tenantId: r.tenant_id ?? tenantId, userId: r.user_id, tokenHash: r.token_hash, tokenType: r.token_type, expiresAt: ms(r.expires_at), usedAt: r.used_at ? ms(r.used_at) : null, attemptCount: r.attempt_count, maxAttempts: r.max_attempts } : null;
      },
      async markUsed(id: string, n: number): Promise<void> {
        await db.updateTable('password_reset_tokens').set({ used_at: new Date(n) }).where('id', '=', id).execute();
      },
      async incAttempt(id: string): Promise<void> {
        await db.updateTable('password_reset_tokens').set((eb) => ({ attempt_count: eb('attempt_count', '+', 1) })).where('id', '=', id).execute();
      },
      async claimAttempt(id: string, nowMs: number): Promise<boolean> {
        const r = await db.updateTable('password_reset_tokens').set((eb) => ({ attempt_count: eb('attempt_count', '+', 1) }))
          .where('id', '=', id).where('used_at', 'is', null).where('expires_at', '>', new Date(nowMs))
          .where((eb) => eb('attempt_count', '<', eb.ref('max_attempts'))).returning('id').execute();
        return r.length === 1;
      },
      async markUsedOnce(id: string, nowMs: number): Promise<boolean> {
        const r = await db.updateTable('password_reset_tokens').set({ used_at: new Date(nowMs) }).where('id', '=', id).where('used_at', 'is', null).returning('id').execute();
        return r.length === 1;
      },
    },
    sessions: {
      async revokeAllForUser(userId: string): Promise<void> {
        await db.updateTable('sessions').set({ status: 'revoked', revoked_at: new Date() }).where('user_id', '=', userId).where('status', '=', 'active').where(canMoveToSql(SESSION, 'revoked') as any).execute();
      },
      async create(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
        const u = await db.selectFrom('users').select(['tenant_id', 'branch_id', 'role']).where('id', '=', userId).executeTakeFirstOrThrow();
        const s = await db.insertInto('sessions').values({ user_id: userId, tenant_id: u.tenant_id, branch_id: u.branch_id, status: 'active', expires_at: new Date(nowMs() + SESSION_TTL * 1000) }).returning(['id']).executeTakeFirstOrThrow();
        // Carry the session row id (`sid`) into the token. Without it this session is UNREVOCABLE — and a
        // password-reset session is exactly the one you'd most want to kill if a reset link were intercepted.
        // (The row was already created above; only its id was never reaching the token.)
        const accessToken = signSession({ userId, tenantId: u.tenant_id, branchId: u.branch_id, role: u.role, permissions: [], subscriptionStatus: 'active', sid: s.id } as any, { secret: process.env.AUTH_SESSION_SECRET || '', ttlSeconds: SESSION_TTL });
        const refreshPlain = rng.token();
        await db.insertInto('refresh_tokens').values({ session_id: s.id, user_id: userId, token_hash: await hasher.hash(refreshPlain), expires_at: new Date(nowMs() + 30 * 24 * 3_600_000) }).execute();
        return { accessToken, refreshToken: refreshPlain };
      },
    },
  };
}

// DB-less stub: requestReset stays generic; temp-login/complete report not-usable. Keeps endpoints alive in dev.
export function makeNullResetPorts(sms: SmsSender): Ports {
  return {
    sms, hasher, clock, rng, audit, rate: makeRate(),
    tenants: { async findActiveByCode() { return null; } },
    users: { async findActiveByTenantPhone() { return null; }, async findForLogin() { return null; }, async setPasswordHash() { /* no-op */ } },
    tokens: { async create(row) { return { id: 'mem', ...row }; }, async latestUsable() { return null; }, async markUsed() { /* no-op */ }, async incAttempt() { /* no-op */ }, async claimAttempt() { return false; }, async markUsedOnce() { return false; } },
    sessions: { async revokeAllForUser() { /* no-op */ }, async create() { return { accessToken: '', refreshToken: '' }; } },
  };
}

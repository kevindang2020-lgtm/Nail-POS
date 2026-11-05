// system-reset.ports.kysely.ts — production Ports for SystemPasswordResetService (admin/super-admin reset + temp
// password) backed by Postgres (Kysely): tenant/user lookups, temporary-password set/clear, session revoke + issue,
// scrypt hashing, crypto RNG, injected SMS+Email, in-process rate limiter, audit no-op hook. A null variant keeps the
// endpoints alive DB-less. Validated against a live schema via scripts/system-reset-smoke.ts.
import { canMoveToSql } from '@aipowersalon/database';
import { SESSION } from './identity-lifecycles';
import { type SmsSender, type EmailSender } from '@aipowersalon/notifications';
import { randomBytes, randomInt } from 'node:crypto';
import { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { Ports, TenantRow, UserRow } from './system-password-reset.service';
import type { AnyRole } from './reset-authz';
import { hashPassword, verifyPassword } from '@aipowersalon/auth';
import { signSession } from './auth-session-token';
import { propagateTechnicianPassword } from './password-scope';

const nowMs = () => Date.now();
const hasher = { hash: (s: string) => hashPassword(s), verify: (s: string, h: string) => verifyPassword(s, h) };
const clock = { now: () => nowMs(), iso: () => new Date().toISOString() };
const rng = { int: (maxExclusive: number) => randomInt(0, Math.max(1, maxExclusive)), token: () => randomBytes(24).toString('hex') };
const audit = { async record() { /* best-effort no-op hook */ } };
const SESSION_TTL = Number(process.env.AUTH_SESSION_TTL) || 60 * 60 * 12;

// in-process rate limiter: per-ip & per-identifier (15 min), per-tenant (1 h)
function makeRate() {
  const ip = new Map<string, number[]>(); const idf = new Map<string, number[]>(); const ten = new Map<string, number[]>();
  const recent = (m: Map<string, number[]>, k: string, win: number) => { const cut = nowMs() - win; const a = (m.get(k) || []).filter((t) => t >= cut); m.set(k, a); return a.length; };
  return {
    async counts(identifier: string, i?: string, tenantId?: string) {
      return { ipLast15: i ? recent(ip, i, 900_000) : 0, identifierLast15: recent(idf, identifier, 900_000), tenantLastHour: tenantId ? recent(ten, tenantId, 3_600_000) : 0 };
    },
    async bump(identifier: string, i?: string, tenantId?: string) {
      (idf.get(identifier) || idf.set(identifier, []).get(identifier)!).push(nowMs());
      if (i) (ip.get(i) || ip.set(i, []).get(i)!).push(nowMs());
      if (tenantId) (ten.get(tenantId) || ten.set(tenantId, []).get(tenantId)!).push(nowMs());
    },
  };
}

const userCols = ['id', 'tenant_id', 'branch_id', 'full_name', 'role', 'status', 'email', 'normalized_phone'] as const;
function toUserRow(r: any): UserRow {
  return { userId: r.id, tenantId: r.tenant_id ?? null, branchId: r.branch_id ?? null, fullName: r.full_name ?? '', role: String(r.role) as AnyRole, status: String(r.status), email: r.email ?? null, normalizedPhone: r.normalized_phone ?? null, permissions: [] };
}

function sessionsOps(db: Kysely<DB>) {
  return {
    async revokeAllForUser(userId: string): Promise<void> {
      await db.updateTable('sessions').set({ status: 'revoked', revoked_at: new Date() }).where('user_id', '=', userId).where('status', '=', 'active').where(canMoveToSql(SESSION, 'revoked') as any).execute();
    },
    async create(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
      const u = await db.selectFrom('users').select(['tenant_id', 'branch_id', 'role']).where('id', '=', userId).executeTakeFirstOrThrow();
      const s = await db.insertInto('sessions').values({ user_id: userId, tenant_id: u.tenant_id, branch_id: u.branch_id, status: 'active', expires_at: new Date(nowMs() + SESSION_TTL * 1000) }).returning(['id']).executeTakeFirstOrThrow();
      // Carry the session row id (`sid`) so this session is revocable like any other. Without it, a session minted
      // by the emergency system-reset path could never be killed.
      const accessToken = signSession({ userId, tenantId: u.tenant_id, branchId: u.branch_id, role: u.role, permissions: [], subscriptionStatus: 'active', sid: s.id } as any, { secret: process.env.AUTH_SESSION_SECRET || '', ttlSeconds: SESSION_TTL });
      const refreshPlain = rng.token();
      await db.insertInto('refresh_tokens').values({ session_id: s.id, user_id: userId, token_hash: await hasher.hash(refreshPlain), expires_at: new Date(nowMs() + 30 * 24 * 3_600_000) }).execute();
      return { accessToken, refreshToken: refreshPlain };
    },
  };
}

export function makeKyselySystemResetPorts(db: Kysely<DB>, sms: SmsSender, email: EmailSender): Ports {
  return {
    sms, email, hasher, clock, rng, audit, rate: makeRate(), sessions: sessionsOps(db),
    tenants: {
      async findActiveByCode(code: string): Promise<TenantRow | null> {
        const r = await db.selectFrom('tenants').select(['id', 'display_name', 'tenant_code', 'status']).where('tenant_code', '=', code).where('status', '=', 'active').executeTakeFirst();
        return r ? { tenantId: r.id, salonName: r.display_name, tenantCode: r.tenant_code, status: r.status, prefersSms: false } : null;
      },
    },
    users: {
      async findActiveInTenantByEmailOrPhone(tenantId: string, email: string | null, phone: string | null): Promise<UserRow | null> {
        let q = db.selectFrom('users').select(userCols as any).where('tenant_id', '=', tenantId).where('status', '=', 'active');
        q = q.where((eb) => eb.or([
          ...(email ? [eb('email', '=', email)] : []),
          ...(phone ? [eb('normalized_phone', '=', phone)] : []),
          ...(!email && !phone ? [eb('id', '=', '00000000-0000-0000-0000-000000000000')] : []),
        ]));
        const r = await q.executeTakeFirst();
        return r ? toUserRow(r) : null;
      },
      async findSuperAdminByEmailOrPhone(email: string | null, phone: string | null): Promise<UserRow | null> {
        let q = db.selectFrom('users').select(userCols as any).where('tenant_id', 'is', null).where('role', '=', 'SUPER_ADMIN');
        q = q.where((eb) => eb.or([
          ...(email ? [eb('email', '=', email)] : []),
          ...(phone ? [eb('normalized_phone', '=', phone)] : []),
          ...(!email && !phone ? [eb('id', '=', '00000000-0000-0000-0000-000000000000')] : []),
        ]));
        const r = await q.executeTakeFirst();
        return r ? toUserRow(r) : null;
      },
      async findById(userId: string): Promise<UserRow | null> {
        const r = await db.selectFrom('users').select(userCols as any).where('id', '=', userId).executeTakeFirst();
        return r ? toUserRow(r) : null;
      },
      async setTemporaryPassword(userId: string, hash: string, expiresAt: number, delivery: string): Promise<void> {
        await db.updateTable('users').set({ temp_password_hash: hash, temp_password_expires_at: new Date(expiresAt), temp_password_delivery: delivery, must_change_password: true, updated_at: new Date() }).where('id', '=', userId).execute();
      },
      async setNewPassword(userId: string, hash: string): Promise<void> {
        await db.updateTable('users').set({ password_hash: hash, temp_password_hash: null, temp_password_expires_at: null, must_change_password: false, password_changed_at: new Date(), updated_at: new Date() }).where('id', '=', userId).execute();
        // A technician has ONE password. See auth/password-scope.ts.
        await propagateTechnicianPassword(db as any, userId, hash);
      },
    },
  };
}

export function makeNullSystemResetPorts(sms: SmsSender, email: EmailSender): Ports {
  return {
    sms, email, hasher, clock, rng, audit, rate: makeRate(),
    tenants: { async findActiveByCode() { return null; } },
    users: { async findActiveInTenantByEmailOrPhone() { return null; }, async findSuperAdminByEmailOrPhone() { return null; }, async findById() { return null; }, async setTemporaryPassword() { /* no-op */ }, async setNewPassword() { /* no-op */ } },
    sessions: { async revokeAllForUser() { /* no-op */ }, async create() { return { accessToken: '', refreshToken: '' }; } },
  };
}

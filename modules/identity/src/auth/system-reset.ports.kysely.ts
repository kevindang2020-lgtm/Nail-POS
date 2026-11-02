// system-reset.ports.kysely.ts — production Ports for SystemPasswordResetService (admin/super-admin reset + temp
// password) backed by Postgres (Kysely): tenant/user lookups, temporary-password set/clear, session revoke + issue,
// scrypt hashing, crypto RNG, injected SMS+Email. Security Deep Scan C12/A2: the reset counters, the change-password
// sessions (ephemeral_grants) and the temporary-password attempt budget live in Postgres — they used to be per-process
// Maps, so with two replicas every limit was per replica — and the audit port writes through the platform's audit writer
// (it was a no-op: every reset / temporary-login / password-change record was dropped). A null variant keeps the
// endpoints alive DB-less. Validated against a live schema via scripts/system-reset-smoke.ts.
import { canMoveToSql } from '@aipowersalon/database';
import { SESSION } from './identity-lifecycles';
import { type SmsSender, type EmailSender } from '@aipowersalon/notifications';
import { randomBytes, randomInt } from 'node:crypto';
import { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { Ports, TenantRow, UserRow } from './system-password-reset.service';
import type { AnyRole } from './reset-authz';
import { hashPassword, verifyPassword, KyselyEphemeralGrants } from '@aipowersalon/auth';
import { sql } from 'kysely';
import { createHash } from 'node:crypto';
import type { AuditSink } from '@aipowersalon/audit';
import type { ResetAudit } from './password-reset-core';
import { PostgresAttemptBudget, type AttemptBudgetOptions } from './auth-attempt-budget';
import { signSession } from './auth-session-token';
import { propagateTechnicianPassword } from './password-scope';

const nowMs = () => Date.now();
const hasher = { hash: (s: string) => hashPassword(s), verify: (s: string, h: string) => verifyPassword(s, h) };
const clock = { now: () => nowMs(), iso: () => new Date().toISOString() };
const rng = { int: (maxExclusive: number) => randomInt(0, Math.max(1, maxExclusive)), token: () => randomBytes(24).toString('hex') };
const SESSION_TTL = Number(process.env.AUTH_SESSION_TTL) || 60 * 60 * 12;

/**
 * Reset-request counters in Postgres (auth_events rows of type PASSWORD_RESET_REQUESTED; the identifier is stored only as a
 * keyed SHA-256 in `reason`, the flow in metadata). Shared by every replica. `flow` keeps the tenant (salon code) flow's
 * counts apart from the system / Super Admin flow's.
 */
export class KyselyResetRequestLog {
  constructor(private readonly db: any, private readonly flow: string) {}
  static key(identifier: string): string { return createHash('sha256').update('aps-reset-rate:' + String(identifier || '').trim().toLowerCase()).digest('hex'); }
  /** How many requests in the window: for this identifier, this IP, and this salon. */
  async count(identifier: string, ip: string | undefined, tenantId: string | undefined, idWindowMs: number, ipWindowMs: number, tenantWindowMs: number): Promise<{ identifier: number; ip: number; tenant: number }> {
    const h = KyselyResetRequestLog.key(identifier); const longest = Math.max(idWindowMs, ipWindowMs, tenantWindowMs);
    const iv = (ms: number) => `${Math.round(ms)} milliseconds`;
    const t = tenantId && /^[0-9a-f-]{36}$/i.test(tenantId) ? tenantId : null; const i = ip ? String(ip).slice(0, 64) : null;
    const r: any = (await sql`select count(*) filter (where reason = ${h} and occurred_at > now() - ${iv(idWindowMs)}::interval)::int as by_id,
                                     count(*) filter (where ${i}::text is not null and ip = ${i} and occurred_at > now() - ${iv(ipWindowMs)}::interval)::int as by_ip,
                                     count(*) filter (where ${t}::uuid is not null and tenant_id = ${t}::uuid and occurred_at > now() - ${iv(tenantWindowMs)}::interval)::int as by_tenant
                                from auth_events
                               where event_type = 'PASSWORD_RESET_REQUESTED' and metadata->>'flow' = ${this.flow}
                                 and occurred_at > now() - ${iv(longest)}::interval
                                 and (reason = ${h} or (${i}::text is not null and ip = ${i}) or (${t}::uuid is not null and tenant_id = ${t}::uuid))`.execute(this.db)).rows[0];
    return { identifier: Number(r?.by_id ?? 0), ip: Number(r?.by_ip ?? 0), tenant: Number(r?.by_tenant ?? 0) };
  }
  async record(identifier: string, ip: string | undefined, tenantId: string | undefined): Promise<void> {
    const t = tenantId && /^[0-9a-f-]{36}$/i.test(tenantId) ? tenantId : null;
    await sql`insert into auth_events (event_type, outcome, tenant_id, ip, reason, metadata)
              values ('PASSWORD_RESET_REQUESTED', 'info', ${t}::uuid, ${ip ? String(ip).slice(0, 64) : null}, ${KyselyResetRequestLog.key(identifier)}, ${JSON.stringify({ flow: this.flow })}::jsonb)`.execute(this.db);
  }
}

/** System / Super Admin reset counters: per-ip & per-identifier (15 min), per-tenant (1 h) — in Postgres. */
export function makeKyselyResetRate(db: any): Ports['rate'] {
  const log = new KyselyResetRequestLog(db, 'system_reset');
  return {
    async counts(identifier: string, ip?: string, tenantId?: string) {
      const c = await log.count(identifier, ip, tenantId, 900_000, 900_000, 3_600_000);
      return { ipLast15: ip ? c.ip : 0, identifierLast15: c.identifier, tenantLastHour: tenantId ? c.tenant : 0 };
    },
    async bump(identifier: string, ip?: string, tenantId?: string) { await log.record(identifier, ip, tenantId); },
  };
}

/** The audit port over the platform's audit writer (audit_events for a salon user, audit_logs for a platform one). */
export function resetAuditPort(sink: AuditSink | null | undefined): Ports['audit'] {
  return {
    async record(a: ResetAudit): Promise<void> {
      if (!sink) return;
      await sink.record({
        tenantId: a.tenantId ?? null, userId: a.userId ?? null, module: 'auth', action: a.actionType,
        resourceType: 'user', resourceId: (a.metadata?.targetUserId as string | undefined) ?? a.userId ?? null,
        summary: a.actionType.replace(/_/g, ' '), ip: a.ipAddress ?? null, device: a.userAgent ?? null,
        metadata: { ...a.metadata, ...(a.phoneMasked ? { phoneMasked: a.phoneMasked } : {}) },
        ...(typeof a.metadata?.reason === 'string' ? { reason: a.metadata.reason } : {}),
      });
    },
  };
}

// in-process rate limiter: per-ip & per-identifier (15 min), per-tenant (1 h) — the DB-LESS stub only
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

export function makeKyselySystemResetPorts(db: Kysely<DB>, sms: SmsSender, email: EmailSender, opts: { audit?: AuditSink | null; budget?: AttemptBudgetOptions } = {}): Ports {
  return {
    sms, email, hasher, clock, rng, audit: resetAuditPort(opts.audit), rate: makeKyselyResetRate(db), sessions: sessionsOps(db),
    grants: new KyselyEphemeralGrants(db),
    attempts: new PostgresAttemptBudget(db, opts.budget),
    tenants: {
      async findActiveByCode(code: string): Promise<TenantRow | null> {
        const r = await db.selectFrom('tenants').select(['id', 'display_name', 'tenant_code', 'status']).where('tenant_code', '=', code).where('status', '=', 'active').executeTakeFirst();
        return r ? { tenantId: r.id, salonName: r.display_name, tenantCode: r.tenant_code, status: r.status, prefersSms: false } : null;
      },
    },
    users: {
      async findActiveInTenantByEmailOrPhone(tenantId: string, email: string | null, phone: string | null): Promise<UserRow | null> {
        let q = db.selectFrom('users').select(userCols).where('tenant_id', '=', tenantId).where('status', '=', 'active');
        q = q.where((eb) => eb.or([
          ...(email ? [eb('email', '=', email)] : []),
          ...(phone ? [eb('normalized_phone', '=', phone)] : []),
          ...(!email && !phone ? [eb('id', '=', '00000000-0000-0000-0000-000000000000')] : []),
        ]));
        const r = await q.executeTakeFirst();
        return r ? toUserRow(r) : null;
      },
      async findSuperAdminByEmailOrPhone(email: string | null, phone: string | null): Promise<UserRow | null> {
        let q = db.selectFrom('users').select(userCols).where('tenant_id', 'is', null).where('role', '=', 'SUPER_ADMIN');
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
      async temporaryPasswordHash(userId: string): Promise<string | null> {
        const r = await db.selectFrom('users').select(['temp_password_hash']).where('id', '=', userId).executeTakeFirst();
        return r?.temp_password_hash ?? null;
      },
      async setNewPassword(userId: string, hash: string): Promise<void> {
        await db.updateTable('users').set({ password_hash: hash, temp_password_hash: null, temp_password_expires_at: null, must_change_password: false, password_changed_at: new Date(), updated_at: new Date() }).where('id', '=', userId).execute();
        // A technician has ONE password. See auth/password-scope.ts.
        await propagateTechnicianPassword(db, userId, hash);
      },
    },
  };
}

export function makeNullSystemResetPorts(sms: SmsSender, email: EmailSender, auditSink?: AuditSink | null): Ports {
  return {
    sms, email, hasher, clock, rng, audit: resetAuditPort(auditSink), rate: makeRate(),
    tenants: { async findActiveByCode() { return null; } },
    users: { async findActiveInTenantByEmailOrPhone() { return null; }, async findSuperAdminByEmailOrPhone() { return null; }, async findById() { return null; }, async setTemporaryPassword() { /* no-op */ }, async setNewPassword() { /* no-op */ } },
    sessions: { async revokeAllForUser() { /* no-op */ }, async create() { return { accessToken: '', refreshToken: '' }; } },
  };
}

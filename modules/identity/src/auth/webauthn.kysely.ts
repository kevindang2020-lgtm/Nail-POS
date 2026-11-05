// webauthn.kysely.ts — the database adapter that finally makes Face ID reachable.
//
// `WebAuthnService` was fully implemented and THOROUGHLY tested (cross-tenant rejection, cross-user
// begin-as-victim/finish-as-self bypass, replayed challenges, clientData mismatch, cloned-authenticator sign-count
// detection) — and the `webauthn_credentials` / `webauthn_challenges` tables existed. But the service was
// registered in NO module, so it had no route and Face ID was completely unreachable.
//
// Nothing here touches the verified ceremony logic. This is persistence only: the Ports the service already
// expects, bound to the real tables. The session it mints carries a `sid`, so a Face ID session is revocable like
// any other — a biometric session you cannot kill would be the worst kind to lose with a device.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { Ports, WaUser, WaCredential } from './webauthn.service';
import { signSession } from './auth-session-token';
import { makeWebAuthnVerifier } from './webauthn-verifier';
import { webAuthnConfig } from './webauthn-config';
import { randomBytes, randomUUID } from 'crypto';
import type { SessionStore } from './session-store';

const rows = async (db: AppDatabase, q: any): Promise<any[]> => {
  try { return (await q.execute(db)).rows as any[]; } catch { return []; }
};
const one = async (db: AppDatabase, q: any): Promise<any | null> => {
  try { return (await q.execute(db)).rows[0] ?? null; } catch { return null; }
};
const exec = async (db: AppDatabase, q: any): Promise<void> => { try { await q.execute(db); } catch { /* degrade */ } };

const toUser = (r: any): WaUser => ({
  userId: String(r.id),
  tenantId: r.tenant_id ?? null,
  role: String(r.role),
  fullName: String(r.full_name ?? ''),
  userName: String(r.email ?? r.normalized_phone ?? ''),
  permissions: [],
  branchId: r.branch_id ?? null,
});

const toCred = (r: any): WaCredential => ({
  credentialId: String(r.credential_id),
  userId: String(r.user_id),
  tenantId: r.tenant_id ?? null,
  publicKey: String(r.public_key),
  signCount: Number(r.sign_count ?? 0),
});

const TTL = Number(process.env.AUTH_SESSION_TTL) || 60 * 60 * 12;

export function makeWebAuthnPorts(db: AppDatabase, sessions?: SessionStore): Ports {
  // A Face ID session with no `sid` is UNREVOCABLE — you could not kill it when the device is lost, which is the
  // single most likely reason you'd need to. If the store failed to resolve while a database is configured, that
  // is a misconfiguration, and it must fail LOUDLY rather than quietly minting biometric sessions nobody can
  // revoke. (This exact silent-degradation shape has bitten this codebase repeatedly.)
  const dbConfigured = !!process.env.DATABASE_URL || process.env.REPO_DRIVER === 'postgres';
  if (db && dbConfigured && !sessions) {
    throw new Error(
      'WebAuthn: SessionStore did not resolve while a database is configured. Face ID sessions would be minted ' +
      'without a session id and could never be revoked — refusing to start.',
    );
  }
  return {
    // Derived from the REQUEST's browser origin (validated against the trusted allowlist), not from env vars that
    // can silently disagree with the browser — the #1 cause of "Face ID doesn't work". Getters, so each request
    // resolves its own. `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN` still override if set.
    get config() { return webAuthnConfig(); },

    users: {
      /**
       * Are these two `users` rows the same global technician — and is the target one usable?
       *
       * The SAME predicate as `listForHuman`, deliberately: what is OFFERED in allowCredentials and what is
       * ACCEPTED at verification must be the same set, or the two drift and one of them becomes the hole.
       *
       * `targetUserId` is the row she is signing in to. It must be active — she has onboarded at that salon —
       * and the global account must be active. A platform suspension a technician could step around with her own
       * face would not be a suspension.
       */
      async isSameGlobalTechnician(credentialUserId: string, targetUserId: string): Promise<boolean> {
        const r = await one(db, sql`
          select 1 as ok
            from users a
            join users b on b.global_tech_profile_id = a.global_tech_profile_id
            join global_tech_profiles p on p.id = a.global_tech_profile_id
           where a.id = ${credentialUserId} and b.id = ${targetUserId}
             and a.global_tech_profile_id is not null
             and a.role = 'TECHNICIAN' and b.role = 'TECHNICIAN'
             and b.status = 'active'
             and p.status = 'active'
           limit 1`);
        return !!r;
      },
      async findById(userId: string): Promise<WaUser | null> {
        const r = await one(db, sql`
          select id, tenant_id, branch_id, role, full_name, email, normalized_phone
          from users where id = ${userId} and status = 'active'`);
        return r ? toUser(r) : null;
      },
      /** Resolve the user a biometric sign-in is FOR. Scoped to the tenant when one is given. */
      async findForAuthn(tenantId: string | null, hint?: string): Promise<WaUser | null> {
        if (!hint) return null;
        const h = hint.trim().toLowerCase();
        const r = await one(db, sql`
          select id, tenant_id, branch_id, role, full_name, email, normalized_phone
          from users
          where status = 'active'
            and (${tenantId}::uuid is null or tenant_id = ${tenantId})
            and (lower(email) = ${h} or normalized_phone = ${hint.trim()})
          limit 1`);
        return r ? toUser(r) : null;
      },
    },

    creds: {
      async listByUser(tenantId: string | null, userId: string): Promise<WaCredential[]> {
        const list = await rows(db, sql`
          select credential_id, user_id, tenant_id, public_key, sign_count
          from webauthn_credentials
          where user_id = ${userId} and revoked_at is null
            and (${tenantId}::uuid is null or tenant_id = ${tenantId})`);
        return list.map(toCred);
      },
      /**
       * Her passkeys across every salon she works at.
       *
       * Her OWN credentials always. Her other salons' credentials only when the DATABASE can prove those rows are
       * the same human: same global_tech_profile_id, both rows TECHNICIAN, HER row here active (she has onboarded
       * at this salon — a passkey saves her typing a password she already set; it never creates access she never
       * had), and the global account itself active (a platform-suspended technician signs in nowhere).
       */
      async listForHuman(userId: string): Promise<WaCredential[]> {
        const list = await rows(db, sql`
          select c.credential_id, c.user_id, c.tenant_id, c.public_key, c.sign_count
            from webauthn_credentials c
           where c.revoked_at is null
             and (c.user_id = ${userId}
               or c.user_id in (
                 select sib.id
                   from users me
                   join users sib on sib.global_tech_profile_id = me.global_tech_profile_id
                   join global_tech_profiles p on p.id = me.global_tech_profile_id
                  where me.id = ${userId}
                    and me.global_tech_profile_id is not null
                    and me.status = 'active' and me.role = 'TECHNICIAN'
                    and sib.role = 'TECHNICIAN'
                    and p.status = 'active'))`);
        return list.map(toCred);
      },
      async findByCredentialId(credentialId: string): Promise<WaCredential | null> {
        const r = await one(db, sql`
          select credential_id, user_id, tenant_id, public_key, sign_count
          from webauthn_credentials
          where credential_id = ${credentialId} and revoked_at is null`);
        return r ? toCred(r) : null;
      },
      async save(c: WaCredential & { transports?: string; deviceLabel?: string }): Promise<void> {
        await exec(db, sql`
          insert into webauthn_credentials (tenant_id, user_id, credential_id, public_key, sign_count, transports, device_label)
          values (${c.tenantId}, ${c.userId}, ${c.credentialId}, ${c.publicKey}, ${c.signCount}, ${c.transports ?? null}, ${c.deviceLabel ?? null})`);
      },
      async updateSignCount(credentialId: string, signCount: number): Promise<void> {
        await exec(db, sql`
          update webauthn_credentials set sign_count = ${signCount}, last_used_at = now()
          where credential_id = ${credentialId}`);
      },
    },

    challenges: {
      async put(handle, data): Promise<void> {
        await exec(db, sql`
          insert into webauthn_challenges (handle, user_id, tenant_id, challenge, purpose, expires_at)
          values (${handle}, ${data.userId}, ${data.tenantId}, ${data.challenge}, ${data.purpose}, ${new Date(data.expiresAt)})`);
      },
      /** Single use: consuming marks it, so a replayed handle finds nothing. (The service also checks expiry.) */
      async consume(handle: string) {
        const r = await one(db, sql`
          select handle, user_id, tenant_id, challenge, purpose, expires_at
          from webauthn_challenges
          where handle = ${handle} and consumed_at is null`);
        if (!r) return null;
        await exec(db, sql`update webauthn_challenges set consumed_at = now() where handle = ${handle}`);
        return {
          challenge: String(r.challenge),
          userId: r.user_id ?? null,
          tenantId: r.tenant_id ?? null,
          purpose: String(r.purpose),
          expiresAt: new Date(r.expires_at).getTime(),
        };
      },
    },

    tenants: {
      async resolveId(tenantCodeOrSlug: string): Promise<string | null> {
        const r = await one(db, sql`
          select id from tenants where tenant_code = ${tenantCodeOrSlug} or tenant_slug = ${tenantCodeOrSlug} limit 1`);
        return r ? String(r.id) : null;
      },
    },

    // The REAL cryptographic verifier. Never a stub: a permissive verifier would accept any forged signature.
    verifier: makeWebAuthnVerifier(),

    audit: {
      async record(a) {
        await exec(db, sql`
          insert into audit_logs (tenant_id, user_id, role, action_type, entity_type, metadata_json)
          values (${a.tenantId ?? null}, ${a.userId ?? null}, 'CUSTOMER', ${`webauthn.${a.actionType}`}, 'webauthn',
                  ${JSON.stringify(a.metadata ?? {})}::jsonb)`);
      },
    },

    clock: { now: () => Date.now() },

    rng: {
      bytes: (n: number) => Array.from(randomBytes(n)),      // cryptographically secure
      token: () => randomUUID(),
    },

    sessions: {
      /** Mint the platform's normal signed session — WITH a `sid`, so a Face ID session is revocable. */
      async create(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
        const u = await one(db, sql`
          select id, tenant_id, branch_id, role from users where id = ${userId} and status = 'active'`);
        if (!u) throw new Error('WEBAUTHN_USER_NOT_FOUND');

        const sid = sessions
          ? await sessions.create({ userId, tenantId: u.tenant_id ?? null, branchId: u.branch_id ?? null, ttlSeconds: TTL })
          : null;

        const accessToken = signSession(
          {
            userId, tenantId: u.tenant_id ?? null, branchId: u.branch_id ?? null,
            role: u.role, permissions: [], subscriptionStatus: 'active',
            ...(sid ? { sid } : {}),
          } as any,
          { secret: process.env.AUTH_SESSION_SECRET || '', ttlSeconds: TTL },
        );
        return { accessToken, refreshToken: '' };
      },
    },
  };
}

import { Kysely, sql } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { MOBILE_PAY_DEVICE, MOBILE_PAY_DEVICE_ATTESTATION } from '../checkout/checkout-lifecycles';
import { SESSION } from '@aipowersalon/identity';
import type { DB } from '@aipowersalon/database';
import { DeviceBindingError, DeviceKeyMismatchError, type MobilePayDeviceRecord, type MobilePayDeviceStatus, type MobilePayDeviceStore, type MobilePayPlatform, type RegisterDeviceInput, type DeviceActivityRows } from './mobile-pay-device';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

/*
 * Postgres store for the mobile-pay device registry (migrations 385 + 660). Every statement is scoped by tenant_id, and a
 * device is addressed by (tenant_id, device_id) — the UNIQUE key. Registering NEVER changes status (a device cannot
 * self-approve); only setStatus (owner/Super Admin) moves it, through the lifecycle (canMoveToSql). Mandate §14: the
 * install is BOUND to the first user who registers it (bound_user_id) — a second user re-registering the same install is
 * refused in SQL (the conditional update matches nothing) and reported as DEVICE_NOT_AUTHORIZED. Raw sql keeps the
 * statements explicit; no device secret/token is stored here.
 */
const COLS = sql`d.device_id, d.branch_id, d.label, d.platform, d.os_version, d.app_version, d.tap_to_pay_capable, d.status, d.approved_at, d.last_seen_at, d.bound_user_id, d.revoked_at, d.revoke_reason, d.last_payment_at, d.last_error_at, d.last_error_code,
  d.public_key, d.key_fingerprint, d.attestation_status, d.paired_via, d.shared,
  coalesce((select array_agg(b.branch_id::text order by b.branch_id) from mobile_pay_device_branches b where b.tenant_id = d.tenant_id and b.device_id = d.device_id), '{}') as allowed_branch_ids`;
const iso = (v: any) => (v ? new Date(v).toISOString() : null);
function mapRow(r: any): MobilePayDeviceRecord {
  return {
    deviceId: r.device_id,
    branchId: r.branch_id ?? null,
    label: r.label ?? null,
    platform: (r.platform ?? 'unknown') as MobilePayPlatform,
    osVersion: r.os_version ?? null,
    appVersion: r.app_version ?? null,
    tapToPayCapable: !!r.tap_to_pay_capable,
    status: r.status as MobilePayDeviceStatus,
    approvedAt: iso(r.approved_at),
    lastSeenAt: iso(r.last_seen_at),
    boundUserId: r.bound_user_id ?? null,
    revokedAt: iso(r.revoked_at),
    revokeReason: r.revoke_reason ?? null,
    lastPaymentAt: iso(r.last_payment_at),
    lastErrorAt: iso(r.last_error_at),
    lastErrorCode: r.last_error_code ?? null,
    publicKey: r.public_key ?? null,
    keyFingerprint: r.key_fingerprint ?? null,
    attestationStatus: (r.attestation_status ?? 'none') as MobilePayDeviceRecord['attestationStatus'],
    pairedVia: r.paired_via ?? null,
    allowedBranchIds: Array.isArray(r.allowed_branch_ids) ? r.allowed_branch_ids.map(String) : [],
    shared: !!r.shared,
  };
}

/** M6-5: the API's session store (identity's 'SessionStore'), so a revoked phone's sessions end in this process at once. */
export interface DeviceSessionRevoker { revoke(sessionId: string): Promise<void> }

export class KyselyMobilePayDeviceStore implements MobilePayDeviceStore {
  /** `sessionRevoker` (optional): resolves the API's session store lazily (checkout never imports identity's module). */
  constructor(private readonly db: Kysely<DB>, private readonly sessionRevoker?: () => DeviceSessionRevoker | null) {}

  async get(tenantId: string, deviceId: string): Promise<MobilePayDeviceRecord | null> {
    const res: any = await sql`select ${COLS} from mobile_pay_devices d where d.tenant_id = ${tenantId} and d.device_id = ${deviceId} limit 1`.execute(this.db);
    const r = res?.rows?.[0];
    return r ? mapRow(r) : null;
  }

  async list(tenantId: string): Promise<MobilePayDeviceRecord[]> {
    const res: any = await sql`select ${COLS} from mobile_pay_devices d where d.tenant_id = ${tenantId} order by d.created_at desc`.execute(this.db);
    return (res?.rows ?? []).map(mapRow);
  }

  async upsertOnRegister(tenantId: string, input: RegisterDeviceInput): Promise<MobilePayDeviceRecord> {
    const by = input.registeredBy || null;
    // Secure Tap to Pay §4 / §18: the key is set ONCE; a different key for this device id is a different phone
    const prior = await this.get(tenantId, input.deviceId);
    if (prior?.publicKey && input.publicKey && prior.publicKey !== input.publicKey) throw new DeviceKeyMismatchError();
    const pairing = !prior && input.pairing ? input.pairing : null;   // a POS pairing pre-approves a NEW phone only
    // The conditional ON CONFLICT keeps status untouched (never self-approve) and refuses to move the binding: when the
    // row is bound to a different user nothing updates (RETURNING is empty) → DEVICE_NOT_AUTHORIZED.
    const res: any = await sql`
      insert into mobile_pay_devices (tenant_id, device_id, branch_id, label, platform, os_version, app_version, tap_to_pay_capable, registered_by, bound_user_id, status, last_seen_at,
                                      public_key, key_alg, key_fingerprint, key_registered_at, paired_via, approved_by, approved_at, shared)
      values (${tenantId}, ${input.deviceId}, ${pairing ? pairing.branchId : (input.branchId || null)}, ${input.label || null}, ${input.platform || 'unknown'}, ${input.osVersion || null}, ${input.appVersion || null}, ${input.tapToPayCapable ?? false}, ${by}, ${by},
              ${pairing ? 'active' : 'pending'}, now(),
              ${input.publicKey || null}, ${input.publicKey ? 'ES256' : null}, ${input.keyFingerprint || null}, ${input.publicKey ? sql`now()` : null}, ${pairing ? 'pos_qr' : null}, ${pairing ? pairing.approvedBy : null}, ${pairing ? sql`now()` : null}, ${!!pairing?.shared})
      on conflict (tenant_id, device_id) do update set
        public_key = coalesce(mobile_pay_devices.public_key, excluded.public_key),
        key_alg = coalesce(mobile_pay_devices.key_alg, excluded.key_alg),
        key_fingerprint = coalesce(mobile_pay_devices.key_fingerprint, excluded.key_fingerprint),
        key_registered_at = coalesce(mobile_pay_devices.key_registered_at, excluded.key_registered_at),
        branch_id = coalesce(excluded.branch_id, mobile_pay_devices.branch_id),
        label = coalesce(mobile_pay_devices.label, excluded.label),   -- §15: once named, only the owner's Rename changes it
        platform = excluded.platform,
        os_version = coalesce(excluded.os_version, mobile_pay_devices.os_version),
        app_version = coalesce(excluded.app_version, mobile_pay_devices.app_version),
        tap_to_pay_capable = excluded.tap_to_pay_capable,
        bound_user_id = coalesce(mobile_pay_devices.bound_user_id, excluded.bound_user_id),
        last_seen_at = now(), updated_at = now()
      where mobile_pay_devices.shared or mobile_pay_devices.bound_user_id is null or excluded.bound_user_id is null or mobile_pay_devices.bound_user_id = excluded.bound_user_id
      returning device_id
    `.execute(this.db).catch((e: any) => {
      // ux_mobile_pay_devices_key_fingerprint: this key already belongs to another device (a copied phone)
      if (e?.code === '23505' && /key_fingerprint/.test(String(e?.constraint ?? e?.message ?? ''))) throw withCode(new DeviceKeyMismatchError('This payment key already belongs to another device.'), 'DEVICE_KEY_MISMATCH');
      throw e;
    });   // NB: status intentionally NOT touched on re-register — a device can never self-approve
    if (!res?.rows?.length) throw new DeviceBindingError();
    return (await this.get(tenantId, input.deviceId))!;
  }

  async setStatus(tenantId: string, deviceId: string, status: MobilePayDeviceStatus, actorId?: string | null, reason?: string | null): Promise<MobilePayDeviceRecord | null> {
    const blocking = status === 'revoked' || status === 'compromised' || status === 'disabled';
    await sql`
      update mobile_pay_devices set
        status = ${status},
        approved_by = case when ${status} = 'active' then ${actorId || null} else approved_by end,
        approved_at = case when ${status} = 'active' then now() else approved_at end,
        -- Payment Terminals guide audit (Nov 4 2026): a phone disabled and then enabled again kept its revoked_at, so the screen
        -- showed it as Revoked. Re-enabling clears the block stamps (the audit log keeps the history; a revoked phone can never
        -- become active — canMoveToSql below refuses it).
        revoked_at = case when ${blocking} then now() when ${status} = 'active' then null else revoked_at end,
        revoked_by = case when ${blocking} then ${actorId || null} when ${status} = 'active' then null else revoked_by end,
        revoke_reason = case when ${blocking} then ${reason || null} when ${status} = 'active' then null else revoke_reason end,
        updated_at = now()
      where tenant_id = ${tenantId} and device_id = ${deviceId} and ${canMoveToSql(MOBILE_PAY_DEVICE, status)}
    `.execute(this.db);
    return this.get(tenantId, deviceId);
  }

  async consumeNonce(tenantId: string, deviceId: string, nonce: string): Promise<boolean> {
    // the window is 5 minutes either side; anything older than 15 minutes can never be presented again
    await sql`delete from mobile_pay_device_nonces where tenant_id = ${tenantId} and device_id = ${deviceId} and created_at < now() - interval '15 minutes'`.execute(this.db).catch((e: unknown) => console.warn('[device-proof] nonce cleanup failed (housekeeping only):', (e as Error)?.message));
    const r: any = await sql`insert into mobile_pay_device_nonces (tenant_id, device_id, nonce) values (${tenantId}, ${deviceId}, ${nonce}) on conflict do nothing returning nonce`.execute(this.db);
    return (r?.rows?.length ?? 0) > 0;
  }

  async setAllowedBranches(tenantId: string, deviceId: string, branchIds: string[], actorId?: string | null): Promise<MobilePayDeviceRecord | null> {
    if (!(await this.get(tenantId, deviceId))) return null;
    const ids = [...new Set(branchIds.map(String))];
    await this.db.transaction().execute(async (trx) => {
      await sql`delete from mobile_pay_device_branches where tenant_id = ${tenantId} and device_id = ${deviceId}`.execute(trx);
      // the tenant-consistency trigger refuses a branch of another salon (and the FK an unknown one)
      for (const b of ids) await sql`insert into mobile_pay_device_branches (tenant_id, device_id, branch_id, created_by) values (${tenantId}, ${deviceId}, ${b}, ${actorId || null})`.execute(trx);
      await sql`update mobile_pay_devices set updated_at = now() where tenant_id = ${tenantId} and device_id = ${deviceId}`.execute(trx);
    });
    return this.get(tenantId, deviceId);
  }

  async rename(tenantId: string, deviceId: string, label: string, actorId?: string | null): Promise<MobilePayDeviceRecord | null> {
    await sql`update mobile_pay_devices set label = ${label}, updated_by = ${actorId || null}, updated_at = now() where tenant_id = ${tenantId} and device_id = ${deviceId}`.execute(this.db);
    return this.get(tenantId, deviceId);
  }

  async setAttestation(tenantId: string, deviceId: string, status: 'none' | 'passed' | 'failed'): Promise<MobilePayDeviceRecord | null> {
    if (status === 'none') return this.get(tenantId, deviceId);   // a verdict never goes back to 'none'
    await sql`update mobile_pay_devices set attestation_status = ${status}, updated_at = now() where tenant_id = ${tenantId} and device_id = ${deviceId} and ${canMoveToSql(MOBILE_PAY_DEVICE_ATTESTATION, status)}`.execute(this.db);
    return this.get(tenantId, deviceId);
  }

  async revokeDeviceSessions(tenantId: string, deviceId: string): Promise<number> {
    // the sign-ins opened on this phone (sessions.device_id = the payment device id the app signs in with) end now; their
    // refresh tokens die with the session (refresh rotation refuses a revoked session) — and are stamped for the record
    const r: any = await sql`update sessions set status = 'revoked', revoked_at = now() where tenant_id = ${tenantId} and device_id = ${deviceId} and revoked_at is null and ${canMoveToSql(SESSION, 'revoked')} returning id`.execute(this.db);
    const ids = (r?.rows ?? []).map((x: any) => x.id);
    if (ids.length) await sql`update refresh_tokens set revoked_at = now() where session_id in (${sql.join(ids)}) and revoked_at is null`.execute(this.db);
    // M6-5 (live pilot): the rows above are revoked, but the API's session store caches a LIVE answer for up to 15 s — the
    // revoked phone's session kept working on routes without a device proof. Telling the store ends it in this process
    // now (the store's own revoke is sticky); other API instances see the row within their cache bound.
    const store = this.sessionRevoker?.() ?? null;
    if (store) for (const id of ids) await store.revoke(String(id)).catch((e: unknown) => console.warn('[device-revoke] session store revoke failed (the DB row is revoked):', (e as Error)?.message));
    return ids.length;
  }

  async signedInUser(tenantId: string, deviceId: string): Promise<string | null> {
    const r: any = await sql`select user_id from sessions where tenant_id = ${tenantId} and device_id = ${deviceId} and revoked_at is null and status = 'active' and expires_at > now()
                               order by coalesce(last_activity_at, last_seen_at, created_at) desc, created_at desc limit 1`.execute(this.db);
    return r?.rows?.[0]?.user_id ? String(r.rows[0].user_id) : null;
  }

  async deviceForSession(tenantId: string, sessionId: string): Promise<string | null> {
    const r: any = await sql`select s.device_id from sessions s join mobile_pay_devices d on d.tenant_id = s.tenant_id and d.device_id = s.device_id
                              where s.tenant_id = ${tenantId} and s.id = ${sessionId}::uuid and s.revoked_at is null and d.status not in ('revoked', 'compromised') limit 1`.execute(this.db);
    return r?.rows?.[0]?.device_id ? String(r.rows[0].device_id) : null;
  }

  async activity(tenantId: string, deviceId: string, limits: { sessions?: number; audit?: number } = {}): Promise<DeviceActivityRows> {
    const nS = Math.min(Math.max(1, limits.sessions ?? 25), 100); const nA = Math.min(Math.max(1, limits.audit ?? 50), 200);
    const s: any = await sql`select id, user_id, branch_id, created_at, coalesce(last_activity_at, last_seen_at) as last_active_at, expires_at, revoked_at, status
                               from sessions where tenant_id = ${tenantId} and device_id = ${deviceId} order by created_at desc limit ${nS}`.execute(this.db);
    // the phone's own events (resource = the device, or metadata.deviceId) AND what was done in a sign-in opened on it
    const a: any = await sql`select e.occurred_at, e.action, e.actor_user_id, e.actor_name, e.summary, e.reason, e.resource_type, e.resource_id, e.status, e.metadata->>'ticketId' as ticket_id
                               from audit_events e
                              where e.tenant_id = ${tenantId}
                                and (e.resource_id = ${deviceId} or e.metadata->>'deviceId' = ${deviceId}
                                     or e.session_id in (select id::text from sessions where tenant_id = ${tenantId} and device_id = ${deviceId}))
                              order by e.occurred_at desc limit ${nA}`.execute(this.db);
    return {
      sessions: (s?.rows ?? []).map((r: any) => ({ id: String(r.id), userId: String(r.user_id), branchId: r.branch_id ? String(r.branch_id) : null, createdAt: iso(r.created_at)!, lastActiveAt: iso(r.last_active_at), expiresAt: iso(r.expires_at)!, revokedAt: iso(r.revoked_at), status: String(r.status ?? '') })),
      audit: (a?.rows ?? []).map((r: any) => ({ at: iso(r.occurred_at)!, action: String(r.action), actorUserId: r.actor_user_id ?? null, actorName: r.actor_name ?? null, summary: r.summary ?? null, reason: r.reason ?? null, resourceType: r.resource_type ?? null, resourceId: r.resource_id ?? null, status: r.status ?? null, ticketId: r.ticket_id ?? null })),
    };
  }

  /** §51 unusual registration: rows CREATED (a new phone — a re-register only updates) in the last 24 h, per salon and per user. */
  async registrationCounts(tenantId: string, userId: string | null): Promise<{ tenantLast24h: number; userLast24h: number }> {
    const r: any = await sql`select count(*)::int as t, count(*) filter (where ${userId}::uuid is not null and registered_by = ${userId}::uuid)::int as u
                               from mobile_pay_devices where tenant_id = ${tenantId} and created_at >= now() - interval '24 hours'`.execute(this.db);
    return { tenantLast24h: Number(r?.rows?.[0]?.t ?? 0), userLast24h: Number(r?.rows?.[0]?.u ?? 0) };
  }

  async revokeForUser(tenantId: string, userId: string, reason: string): Promise<number> {
    const res: any = await sql`
      update mobile_pay_devices set status = 'revoked', revoked_at = now(), revoke_reason = ${reason}, updated_at = now()
      where tenant_id = ${tenantId} and bound_user_id = ${userId} and status <> 'revoked' and ${canMoveToSql(MOBILE_PAY_DEVICE, 'revoked')}
    `.execute(this.db);
    return Number(res?.numAffectedRows ?? res?.numUpdatedRows ?? 0);
  }

  async touchPayment(tenantId: string, deviceId: string): Promise<void> {
    await sql`update mobile_pay_devices set last_payment_at = now(), last_seen_at = now(), updated_at = now() where tenant_id = ${tenantId} and device_id = ${deviceId}`.execute(this.db).catch(() => undefined);
  }

  async touchError(tenantId: string, deviceId: string, code: string): Promise<void> {
    await sql`update mobile_pay_devices set last_error_at = now(), last_error_code = ${String(code).slice(0, 64)}, updated_at = now() where tenant_id = ${tenantId} and device_id = ${deviceId}`.execute(this.db).catch(() => undefined);
  }

  async rebind(tenantId: string, deviceId: string, userId: string, actorId?: string | null): Promise<MobilePayDeviceRecord | null> {
    // a reassigned phone goes back to 'pending': the owner approves it again for its new user (never silently active)
    await sql`update mobile_pay_devices set bound_user_id = ${userId}, status = 'pending', approved_at = null, approved_by = null, updated_by = ${actorId || null}, updated_at = now()
              where tenant_id = ${tenantId} and device_id = ${deviceId} and ${canMoveToSql(MOBILE_PAY_DEVICE, 'pending')}`.execute(this.db);
    return this.get(tenantId, deviceId);
  }
}

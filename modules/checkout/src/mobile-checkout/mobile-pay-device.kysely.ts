import { Kysely, sql } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { MOBILE_PAY_DEVICE } from '../checkout/checkout-lifecycles';
import type { DB } from '@aipowersalon/database';
import { DeviceBindingError, type MobilePayDeviceRecord, type MobilePayDeviceStatus, type MobilePayDeviceStore, type MobilePayPlatform, type RegisterDeviceInput } from './mobile-pay-device';

/*
 * Postgres store for the mobile-pay device registry (migrations 385 + 660). Every statement is scoped by tenant_id, and a
 * device is addressed by (tenant_id, device_id) — the UNIQUE key. Registering NEVER changes status (a device cannot
 * self-approve); only setStatus (owner/Super Admin) moves it, through the lifecycle (canMoveToSql). Mandate §14: the
 * install is BOUND to the first user who registers it (bound_user_id) — a second user re-registering the same install is
 * refused in SQL (the conditional update matches nothing) and reported as DEVICE_NOT_AUTHORIZED. Raw sql keeps the
 * statements explicit; no device secret/token is stored here.
 */
const COLS = sql`device_id, branch_id, label, platform, os_version, app_version, tap_to_pay_capable, status, approved_at, last_seen_at, bound_user_id, revoked_at, revoke_reason, last_payment_at, last_error_at, last_error_code`;
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
  };
}

export class KyselyMobilePayDeviceStore implements MobilePayDeviceStore {
  constructor(private readonly db: Kysely<DB>) {}

  async get(tenantId: string, deviceId: string): Promise<MobilePayDeviceRecord | null> {
    const res: any = await sql`select ${COLS} from mobile_pay_devices where tenant_id = ${tenantId} and device_id = ${deviceId} limit 1`.execute(this.db);
    const r = res?.rows?.[0];
    return r ? mapRow(r) : null;
  }

  async list(tenantId: string): Promise<MobilePayDeviceRecord[]> {
    const res: any = await sql`select ${COLS} from mobile_pay_devices where tenant_id = ${tenantId} order by created_at desc`.execute(this.db);
    return (res?.rows ?? []).map(mapRow);
  }

  async upsertOnRegister(tenantId: string, input: RegisterDeviceInput): Promise<MobilePayDeviceRecord> {
    const by = input.registeredBy || null;
    // The conditional ON CONFLICT keeps status untouched (never self-approve) and refuses to move the binding: when the
    // row is bound to a different user nothing updates (RETURNING is empty) → DEVICE_NOT_AUTHORIZED.
    const res: any = await sql`
      insert into mobile_pay_devices (tenant_id, device_id, branch_id, label, platform, os_version, app_version, tap_to_pay_capable, registered_by, bound_user_id, status, last_seen_at)
      values (${tenantId}, ${input.deviceId}, ${input.branchId || null}, ${input.label || null}, ${input.platform || 'unknown'}, ${input.osVersion || null}, ${input.appVersion || null}, ${input.tapToPayCapable ?? false}, ${by}, ${by}, 'pending', now())
      on conflict (tenant_id, device_id) do update set
        branch_id = coalesce(excluded.branch_id, mobile_pay_devices.branch_id),
        label = coalesce(excluded.label, mobile_pay_devices.label),
        platform = excluded.platform,
        os_version = coalesce(excluded.os_version, mobile_pay_devices.os_version),
        app_version = coalesce(excluded.app_version, mobile_pay_devices.app_version),
        tap_to_pay_capable = excluded.tap_to_pay_capable,
        bound_user_id = coalesce(mobile_pay_devices.bound_user_id, excluded.bound_user_id),
        last_seen_at = now(), updated_at = now()
      where mobile_pay_devices.bound_user_id is null or excluded.bound_user_id is null or mobile_pay_devices.bound_user_id = excluded.bound_user_id
      returning device_id
    `.execute(this.db);   // NB: status intentionally NOT touched on re-register — a device can never self-approve
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
        revoked_at = case when ${blocking} then now() else revoked_at end,
        revoked_by = case when ${blocking} then ${actorId || null} else revoked_by end,
        revoke_reason = case when ${blocking} then ${reason || null} else revoke_reason end,
        updated_at = now()
      where tenant_id = ${tenantId} and device_id = ${deviceId} and ${canMoveToSql(MOBILE_PAY_DEVICE, status)}
    `.execute(this.db);
    return this.get(tenantId, deviceId);
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

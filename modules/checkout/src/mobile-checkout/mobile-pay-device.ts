// mobile-pay-device.ts — the per-install registry of iPhones authorized to take Tap to Pay, plus the pure logic that
// turns a device record into the readiness facts (deviceApproved / deviceSupported / appVersionOk). Spec §6.

// Mandate §13 (wave 3 / TTP): trust states. 'compromised' = a risk signal (jailbreak / attestation / suspicious change) —
// never re-activated in place; 'disabled' = switched off by the owner, may be re-activated. UNREGISTERED is "no row".
export type MobilePayDeviceStatus = 'pending' | 'active' | 'revoked' | 'compromised' | 'disabled';
export type MobilePayPlatform = 'ios' | 'ipados' | 'web' | 'unknown';

export const MOBILE_PAY_DEVICE_STATUSES: MobilePayDeviceStatus[] = ['pending', 'active', 'revoked', 'compromised', 'disabled'];
/** §190 taxonomy for a refused device. */
export type DeviceBlockReason = 'DEVICE_NOT_AUTHORIZED' | 'DEVICE_REVOKED';
export class DeviceBindingError extends Error {
  readonly code: DeviceBlockReason = 'DEVICE_NOT_AUTHORIZED';
  constructor(message = 'This phone is registered to another user. Sign in with the account it was registered with, or ask the owner to reassign it.') { super(message); this.name = 'DeviceBindingError'; }
}

export interface MobilePayDeviceRecord {
  deviceId: string;
  branchId?: string | null;
  label?: string | null;
  platform: MobilePayPlatform;
  osVersion?: string | null;
  appVersion?: string | null;
  tapToPayCapable: boolean;
  status: MobilePayDeviceStatus;
  approvedAt?: string | null;
  lastSeenAt?: string | null;
  /** §14: the ONE user this install is bound to (the registering user). Payment is refused for anyone else. */
  boundUserId?: string | null;
  revokedAt?: string | null;
  revokeReason?: string | null;
  /** §145 device health */
  lastPaymentAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorCode?: string | null;
}

export interface RegisterDeviceInput {
  deviceId: string;
  branchId?: string | null;
  label?: string | null;
  platform?: MobilePayPlatform;
  osVersion?: string | null;
  appVersion?: string | null;
  tapToPayCapable?: boolean;
  registeredBy?: string | null;
}

export interface MobilePayDeviceStore {
  /** The device record for (tenant, deviceId), or null. */
  get(tenantId: string, deviceId: string): Promise<MobilePayDeviceRecord | null>;
  /** List a tenant's registered devices (newest first). */
  list(tenantId: string): Promise<MobilePayDeviceRecord[]>;
  /**
   * Register or refresh a device. A NEW device lands 'pending' (must be approved); an existing one keeps its status
   * (re-registering can never self-approve) and just refreshes metadata + last_seen. Returns the record.
   */
  upsertOnRegister(tenantId: string, input: RegisterDeviceInput): Promise<MobilePayDeviceRecord>;
  /** Set a device's status (approve → 'active', revoke → 'revoked', …) through the lifecycle (an illegal move is a
   *  no-op that returns the unchanged record). `reason` is kept for revoke / compromised / disabled. Null if unknown. */
  setStatus(tenantId: string, deviceId: string, status: MobilePayDeviceStatus, actorId?: string | null, reason?: string | null): Promise<MobilePayDeviceRecord | null>;
  /** §140 user termination / lost phone: revoke EVERY device bound to the user. Returns how many moved to revoked. */
  revokeForUser(tenantId: string, userId: string, reason: string): Promise<number>;
  /** §145: a payment captured on this device (last_payment_at). Best-effort. */
  touchPayment(tenantId: string, deviceId: string): Promise<void>;
  /** §143: the last error the device hit (code only — never provider payloads). Best-effort. */
  touchError?(tenantId: string, deviceId: string, code: string): Promise<void>;
  /** Owner / Super Admin reassign (§17 step-up): move the binding to another user of the same tenant. */
  rebind?(tenantId: string, deviceId: string, userId: string, actorId?: string | null): Promise<MobilePayDeviceRecord | null>;
}

export interface DeviceReadinessFacts { deviceApproved: boolean; deviceSupported: boolean; appVersionOk: boolean; blockReason?: DeviceBlockReason }

/** Compare dotted numeric versions. Returns -1 / 0 / 1. Non-numeric segments compare as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Turn a device record into readiness facts. Honest defaults when the device is NOT registered: not approved, but we
 * make no claim it is unsupported or outdated (the accurate blocking reason is "not approved"). When a record exists,
 * every fact comes from it: approved iff status 'active' (and, when branch-bound, matching this branch); supported iff
 * the device reported Tap to Pay capability; app-version ok iff no minimum is set or the reported version meets it.
 */
export function computeDeviceFacts(
  rec: MobilePayDeviceRecord | null | undefined,
  opts: { requiredBranchId?: string | null; minAppVersion?: string | null; requiredUserId?: string | null } = {},
): DeviceReadinessFacts {
  if (!rec) return { deviceApproved: false, deviceSupported: true, appVersionOk: true, blockReason: 'DEVICE_NOT_AUTHORIZED' };
  const branchOk = !opts.requiredBranchId || !rec.branchId || rec.branchId === opts.requiredBranchId;
  // §14 USER + TENANT + BRANCH + DEVICE: a bound device answers only to its user — a token copied to another phone, or
  // another person signed in on this phone, is DEVICE_NOT_AUTHORIZED (the tenant scope is the store's key).
  const userOk = !opts.requiredUserId || !rec.boundUserId || rec.boundUserId === opts.requiredUserId;
  const deviceApproved = rec.status === 'active' && branchOk && userOk;
  const deviceSupported = !!rec.tapToPayCapable;
  const appVersionOk = !opts.minAppVersion ? true : !!rec.appVersion && compareVersions(rec.appVersion, opts.minAppVersion) >= 0;
  const blockReason: DeviceBlockReason | undefined = deviceApproved ? undefined
    : rec.status === 'revoked' || rec.status === 'compromised' ? 'DEVICE_REVOKED' : 'DEVICE_NOT_AUTHORIZED';
  return { deviceApproved, deviceSupported, appVersionOk, blockReason };
}

export class InMemoryMobilePayDeviceStore implements MobilePayDeviceStore {
  private readonly m = new Map<string, MobilePayDeviceRecord & { tenantId: string; createdAt: number }>();
  private key(t: string, d: string) { return `${t}::${d}`; }

  async get(tenantId: string, deviceId: string): Promise<MobilePayDeviceRecord | null> {
    return this.m.get(this.key(tenantId, deviceId)) ?? null;
  }
  async list(tenantId: string): Promise<MobilePayDeviceRecord[]> {
    return [...this.m.values()].filter((r) => r.tenantId === tenantId).sort((a, b) => b.createdAt - a.createdAt);
  }
  async upsertOnRegister(tenantId: string, input: RegisterDeviceInput): Promise<MobilePayDeviceRecord> {
    const k = this.key(tenantId, input.deviceId);
    const existing = this.m.get(k);
    // §14: the binding is set once, by the first registering user; another user cannot take the install over here.
    if (existing?.boundUserId && input.registeredBy && existing.boundUserId !== input.registeredBy) throw new DeviceBindingError();
    const rec = {
      tenantId,
      createdAt: existing?.createdAt ?? Date.now(),
      deviceId: input.deviceId,
      branchId: input.branchId ?? existing?.branchId ?? null,
      label: input.label ?? existing?.label ?? null,
      platform: input.platform ?? existing?.platform ?? 'unknown',
      osVersion: input.osVersion ?? existing?.osVersion ?? null,
      appVersion: input.appVersion ?? existing?.appVersion ?? null,
      tapToPayCapable: input.tapToPayCapable ?? existing?.tapToPayCapable ?? false,
      status: existing?.status ?? 'pending',   // re-registering NEVER self-approves
      approvedAt: existing?.approvedAt ?? null,
      lastSeenAt: new Date().toISOString(),
      boundUserId: existing?.boundUserId ?? input.registeredBy ?? null,
      revokedAt: existing?.revokedAt ?? null, revokeReason: existing?.revokeReason ?? null,
      lastPaymentAt: existing?.lastPaymentAt ?? null, lastErrorAt: existing?.lastErrorAt ?? null, lastErrorCode: existing?.lastErrorCode ?? null,
    };
    this.m.set(k, rec);
    return rec;
  }
  async setStatus(tenantId: string, deviceId: string, status: MobilePayDeviceStatus, actorId?: string | null, reason?: string | null): Promise<MobilePayDeviceRecord | null> {
    const k = this.key(tenantId, deviceId);
    const existing = this.m.get(k);
    if (!existing) return null;
    if (!DEVICE_TRANSITIONS[existing.status]?.includes(status)) return existing;   // the lifecycle refuses (e.g. compromised → active)
    existing.status = status;
    if (status === 'active') { existing.approvedAt = new Date().toISOString(); void actorId; }
    if (status === 'revoked' || status === 'compromised' || status === 'disabled') { existing.revokedAt = new Date().toISOString(); existing.revokeReason = reason ?? null; }
    this.m.set(k, existing);
    return existing;
  }
  async revokeForUser(tenantId: string, userId: string, reason: string): Promise<number> {
    let n = 0;
    for (const r of this.m.values()) {
      if (r.tenantId !== tenantId || r.boundUserId !== userId || r.status === 'revoked') continue;
      r.status = 'revoked'; r.revokedAt = new Date().toISOString(); r.revokeReason = reason; n++;
    }
    return n;
  }
  async touchPayment(tenantId: string, deviceId: string): Promise<void> {
    const r = this.m.get(this.key(tenantId, deviceId)); if (r) r.lastPaymentAt = new Date().toISOString();
  }
  async touchError(tenantId: string, deviceId: string, code: string): Promise<void> {
    const r = this.m.get(this.key(tenantId, deviceId)); if (r) { r.lastErrorAt = new Date().toISOString(); r.lastErrorCode = code; }
  }
  async rebind(tenantId: string, deviceId: string, userId: string): Promise<MobilePayDeviceRecord | null> {
    const r = this.m.get(this.key(tenantId, deviceId)); if (!r) return null;
    if (!DEVICE_TRANSITIONS[r.status]?.includes('pending')) return r;   // a compromised / revoked phone is not re-bound in place
    r.boundUserId = userId; r.status = 'pending'; r.approvedAt = null;   // the owner approves it again for its new user
    return r;
  }
}

/** The same transitions as checkout-lifecycles MOBILE_PAY_DEVICE (the Kysely store enforces them in SQL through canMoveToSql). */
export const DEVICE_TRANSITIONS: Record<MobilePayDeviceStatus, MobilePayDeviceStatus[]> = {
  pending: ['pending', 'active', 'revoked', 'compromised', 'disabled'],
  active: ['active', 'pending', 'revoked', 'compromised', 'disabled'],
  revoked: ['revoked', 'active'],
  compromised: ['compromised', 'revoked'],
  disabled: ['disabled', 'pending', 'active', 'revoked', 'compromised'],
};

// ── BUILD_PLAN Phase 13 B: the minimum Tap-to-Pay app version comes from the ONE version policy ────────────────────────
// mobile_app_versions (migration 558, app 'manager-pay'), set by Super Admin with step-up + reason + audit — the same row
// the API's UPDATE_REQUIRED gate and the app's /app-config read. MOBILE_PAY_MIN_APP_VERSION is a DEPRECATED fallback,
// honoured only while no policy row exists for the platform (remove it from the environment once the row is set).
export interface MinVersionRead { found: boolean; minSupported: string | null }
export function effectiveMinAppVersion(read: MinVersionRead, env: Record<string, string | undefined> = process.env): string | null {
  if (read.found) return read.minSupported;
  return env.MOBILE_PAY_MIN_APP_VERSION || null;
}
/** The manager-pay policy row for the device's platform (Tap to Pay is iPhone: ipados / unknown read the ios row). Never throws. */
export async function readMobilePayMinVersion(db: any, platform: MobilePayPlatform | string | null | undefined): Promise<MinVersionRead> {
  if (!db) return { found: false, minSupported: null };
  const p = platform === 'android' ? 'android' : 'ios';
  try {
    const r = await db.selectFrom('mobile_app_versions').select(['min_supported']).where('app', '=', 'manager-pay').where('platform', '=', p).executeTakeFirst();
    return r ? { found: true, minSupported: r.min_supported ?? null } : { found: false, minSupported: null };
  } catch { return { found: false, minSupported: null }; }
}

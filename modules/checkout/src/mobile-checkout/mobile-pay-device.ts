import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English
// mobile-pay-device.ts — the per-install registry of iPhones authorized to take Tap to Pay, plus the pure logic that
// turns a device record into the readiness facts (deviceApproved / deviceSupported / appVersionOk). Spec §6.

// Mandate §13 (wave 3 / TTP): trust states. 'compromised' = a risk signal (jailbreak / attestation / suspicious change) —
// never re-activated in place; 'disabled' = switched off by the owner, may be re-activated. UNREGISTERED is "no row".
export type MobilePayDeviceStatus = 'pending' | 'active' | 'revoked' | 'compromised' | 'disabled';
export type MobilePayPlatform = 'ios' | 'ipados' | 'web' | 'unknown';

export const MOBILE_PAY_DEVICE_STATUSES: MobilePayDeviceStatus[] = ['pending', 'active', 'revoked', 'compromised', 'disabled'];
/** §190 taxonomy for a refused device. */
export type DeviceBlockReason = 'DEVICE_NOT_AUTHORIZED' | 'DEVICE_REVOKED' | 'DEVICE_NOT_REGISTERED' | 'DEVICE_PENDING_APPROVAL' | 'DEVICE_SUSPENDED' | 'DEVICE_BRANCH_NOT_AUTHORIZED';
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
  /** Secure Tap to Pay §4: the phone's P-256 public key (SPKI, base64) — never a private key. Null = a legacy phone. */
  publicKey?: string | null;
  keyFingerprint?: string | null;
  /** §5: an integrity signal, never the only control */
  attestationStatus?: 'none' | 'passed' | 'failed';
  /** §7: 'pos_qr' when the phone was registered through a single-use POS pairing code */
  pairedVia?: string | null;
  /** §9: the branches this phone may take payments in (empty / absent = its own branchId, or any when that is null) */
  allowedBranchIds?: string[];
  /** §14 / §77: a shared salon phone — any authorized employee of the salon may sign in on it; payments stay attributed to
   *  whoever was signed in. A personal phone (false) answers only to its bound user. */
  shared?: boolean;
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
  /** Secure Tap to Pay §4: set ONCE (first registration); a different key for the same device id is refused */
  publicKey?: string | null;
  keyFingerprint?: string | null;
  /** §7: a POS pairing pre-approved this phone (active at once, bound to the pairing's branch) */
  pairing?: { branchId: string; approvedBy: string; shared?: boolean } | null;
}

/** Secure Tap to Pay §4 / §18: a different key for a registered device id is a different phone (a replacement gets a NEW id). */
export class DeviceKeyMismatchError extends Error {
  readonly code = 'DEVICE_KEY_MISMATCH' as const;
  constructor(message = 'This device id is registered with a different payment key. A replacement phone registers as a new device.') { super(message); this.name = 'DeviceKeyMismatchError'; }
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
  /** Secure Tap to Pay §70: record a signed request's nonce ONCE — false = already used (a replay). */
  consumeNonce?(tenantId: string, deviceId: string, nonce: string): Promise<boolean>;
  /** §15: the owner renames a phone (the label shown on the POS, reports and the device dashboard). Null if unknown. */
  rename?(tenantId: string, deviceId: string, label: string, actorId?: string | null): Promise<MobilePayDeviceRecord | null>;
  /** §5: store an attestation verdict (an integrity signal, never the only control). Null if unknown. */
  setAttestation?(tenantId: string, deviceId: string, status: 'none' | 'passed' | 'failed'): Promise<MobilePayDeviceRecord | null>;
  /** §9: replace the branches a device may take payments in (validated tenant branches; [] = back to its own branch). */
  setAllowedBranches?(tenantId: string, deviceId: string, branchIds: string[], actorId?: string | null): Promise<MobilePayDeviceRecord | null>;
  /** §51 unusual registration (Oct 27): NEW phones registered in the last 24 h for this salon, and by this user. */
  registrationCounts?(tenantId: string, userId: string | null): Promise<{ tenantLast24h: number; userLast24h: number }>;
  /** §16: a revoked phone's sign-ins die with it — every session (and so every refresh family) opened on this device. */
  revokeDeviceSessions?(tenantId: string, deviceId: string): Promise<number>;
  /** M6-6 §14 / §77: the employee signed in on this phone NOW — the newest live (unrevoked, unexpired) session opened on it. */
  signedInUser?(tenantId: string, deviceId: string): Promise<string | null>;
  /** M6-6: the payment device an authenticated session was opened on (sessions.device_id that is a non-revoked registered
   *  device of this tenant), or null — what subscribes a stream to that phone's realtime room. */
  deviceForSession?(tenantId: string, sessionId: string): Promise<string | null>;
  /** M6-6 §15 / §62: the owner's view of one phone — its sign-ins and its audit history (newest first, bounded). */
  activity?(tenantId: string, deviceId: string, limits?: { sessions?: number; audit?: number }): Promise<DeviceActivityRows>;
}

/** Raw rows for the owner's device dashboard (the service names the users and shapes the wire contract). */
export interface DeviceActivityRows {
  sessions: { id: string; userId: string; branchId: string | null; createdAt: string; lastActiveAt: string | null; expiresAt: string; revokedAt: string | null; status: string }[];
  audit: { at: string; action: string; actorUserId: string | null; actorName: string | null; summary: string | null; reason: string | null; resourceType: string | null; resourceId: string | null; status: string | null; ticketId: string | null }[];
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
  if (!rec) return { deviceApproved: false, deviceSupported: true, appVersionOk: true, blockReason: 'DEVICE_NOT_REGISTERED' };
  // §9 effective access = the user's branches (the session is already in one of them) ∩ the device's branches
  const allowed = rec.allowedBranchIds ?? [];
  const branchOk = !opts.requiredBranchId || (allowed.length ? allowed.includes(opts.requiredBranchId) : (!rec.branchId || rec.branchId === opts.requiredBranchId));
  // §14 USER + TENANT + BRANCH + DEVICE: a bound device answers only to its user — a token copied to another phone, or
  // another person signed in on this phone, is DEVICE_NOT_AUTHORIZED (the tenant scope is the store's key).
  const userOk = !!rec.shared || !opts.requiredUserId || !rec.boundUserId || rec.boundUserId === opts.requiredUserId;
  const deviceApproved = rec.status === 'active' && branchOk && userOk;
  const deviceSupported = !!rec.tapToPayCapable;
  const appVersionOk = !opts.minAppVersion ? true : !!rec.appVersion && compareVersions(rec.appVersion, opts.minAppVersion) >= 0;
  // Secure Tap to Pay §57: the precise refusal — revoked beats everything, then the lifecycle state, then who / where
  const blockReason: DeviceBlockReason | undefined = deviceApproved ? undefined
    : rec.status === 'revoked' || rec.status === 'compromised' ? 'DEVICE_REVOKED'
    : !userOk ? 'DEVICE_NOT_AUTHORIZED'
    : rec.status === 'disabled' ? 'DEVICE_SUSPENDED'
    : rec.status === 'pending' ? 'DEVICE_PENDING_APPROVAL'
    : !branchOk ? 'DEVICE_BRANCH_NOT_AUTHORIZED' : 'DEVICE_NOT_AUTHORIZED';
  return { deviceApproved, deviceSupported, appVersionOk, blockReason };
}

/**
 * Secure Tap to Pay M6-6 (§2 / §16 / §61): may a session opened on this install be extended by a refresh? Identity asks
 * through its REFRESH_DEVICE_GUARD port (modules/identity auth/refresh-device-guard.ts); this is the answer, pure.
 *  • no record → not a payment phone (an ordinary sign-in on a browser / tablet) → no objection;
 *  • revoked / compromised → DEVICE_REVOKED and the session + its refresh family END (revocation is final, §16);
 *  • disabled (suspended by the owner) → DEVICE_SUSPENDED, this refresh refused, the session kept (re-activation works);
 *  • pending / active → no objection (a pending phone signs in to wait for approval; payment routes refuse it anyway).
 */
export function refreshBlockFor(rec: MobilePayDeviceRecord | null | undefined): { code: 'DEVICE_REVOKED' | 'DEVICE_SUSPENDED'; endSession: boolean } | null {
  if (!rec) return null;
  if (rec.status === 'revoked' || rec.status === 'compromised') return { code: 'DEVICE_REVOKED', endSession: true };
  if (rec.status === 'disabled') return { code: 'DEVICE_SUSPENDED', endSession: false };
  return null;
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
    if (!existing?.shared && existing?.boundUserId && input.registeredBy && existing.boundUserId !== input.registeredBy) throw new DeviceBindingError();
    if (existing?.publicKey && input.publicKey && existing.publicKey !== input.publicKey) throw new DeviceKeyMismatchError();
    if (input.keyFingerprint && [...this.m.values()].some((r) => r.keyFingerprint === input.keyFingerprint && !(r.tenantId === tenantId && r.deviceId === input.deviceId))) throw withCode(new DeviceKeyMismatchError('This payment key already belongs to another device.'), 'DEVICE_KEY_MISMATCH');
    const rec = {
      tenantId,
      createdAt: existing?.createdAt ?? Date.now(),
      deviceId: input.deviceId,
      branchId: (input.pairing && !existing ? input.pairing.branchId : null) ?? input.branchId ?? existing?.branchId ?? null,
      label: existing?.label ?? input.label ?? null,   // §15: once named, only the owner's Rename changes it
      platform: input.platform ?? existing?.platform ?? 'unknown',
      osVersion: input.osVersion ?? existing?.osVersion ?? null,
      appVersion: input.appVersion ?? existing?.appVersion ?? null,
      tapToPayCapable: input.tapToPayCapable ?? existing?.tapToPayCapable ?? false,
      status: existing?.status ?? (input.pairing ? 'active' : 'pending'),   // re-registering NEVER self-approves; a POS pairing pre-approved a NEW phone
      publicKey: existing?.publicKey ?? input.publicKey ?? null, keyFingerprint: existing?.keyFingerprint ?? input.keyFingerprint ?? null,
      attestationStatus: existing?.attestationStatus ?? 'none', pairedVia: existing?.pairedVia ?? (input.pairing ? 'pos_qr' : null),
      allowedBranchIds: existing?.allowedBranchIds ?? [], shared: existing?.shared ?? !!input.pairing?.shared,
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
  private nonces = new Set<string>();
  async consumeNonce(tenantId: string, deviceId: string, nonce: string): Promise<boolean> {
    const k = `${tenantId}::${deviceId}::${nonce}`; if (this.nonces.has(k)) return false; this.nonces.add(k); return true;
  }
  async rename(tenantId: string, deviceId: string, label: string): Promise<MobilePayDeviceRecord | null> {
    const r = this.m.get(this.key(tenantId, deviceId)); if (!r) return null; r.label = label; return r;
  }
  async setAttestation(tenantId: string, deviceId: string, status: 'none' | 'passed' | 'failed'): Promise<MobilePayDeviceRecord | null> {
    const r = this.m.get(this.key(tenantId, deviceId)); if (!r) return null; r.attestationStatus = status; return r;
  }
  async setAllowedBranches(tenantId: string, deviceId: string, branchIds: string[]): Promise<MobilePayDeviceRecord | null> {
    const r = this.m.get(this.key(tenantId, deviceId)); if (!r) return null; r.allowedBranchIds = [...new Set(branchIds)]; return r;
  }
  sessionsRevoked: string[] = [];
  async revokeDeviceSessions(tenantId: string, deviceId: string): Promise<number> { this.sessionsRevoked.push(`${tenantId}::${deviceId}`); return 0; }
  /** tests: the rows activity() answers per `tenant::device` */
  activityRows = new Map<string, DeviceActivityRows>();
  async activity(tenantId: string, deviceId: string): Promise<DeviceActivityRows> { return this.activityRows.get(this.key(tenantId, deviceId)) ?? { sessions: [], audit: [] }; }
  /** tests: who is signed in on a phone now (`tenant::device` → user) and which session was opened on which phone */
  signedIn = new Map<string, string>();
  sessionDevices = new Map<string, string>();
  async signedInUser(tenantId: string, deviceId: string): Promise<string | null> { return this.signedIn.get(this.key(tenantId, deviceId)) ?? null; }
  async deviceForSession(tenantId: string, sessionId: string): Promise<string | null> {
    const d = this.sessionDevices.get(`${tenantId}::${sessionId}`); const rec = d ? this.m.get(this.key(tenantId, d)) : undefined;
    return rec && rec.status !== 'revoked' && rec.status !== 'compromised' ? d! : null;
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
  revoked: ['revoked'],   // Secure Tap to Pay §18: a revoked phone is never re-activated — a found / replacement phone registers anew
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

/**
 * Secure Tap to Pay §15: a device name the owner types (or the phone first reports). Control characters, bidirectional
 * overrides / isolates and zero-width characters are removed (a name must read the same on every screen), whitespace is
 * collapsed, and it is cut to 80 characters. Empty after cleaning → null (the caller refuses it).
 */
export const DEVICE_LABEL_MAX = 80;
export function sanitizeDeviceLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '')
    .replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return [...s].slice(0, DEVICE_LABEL_MAX).join('').trim();
}

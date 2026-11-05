// customer-phone-settings.service.ts — the tenant's Customer Phone Management policy.
//
// PURE-ish: no SQL. The port carries the rows; the decisions live here and are testable without a database.
//
// ── The two settings that are NOT ordinary settings ─────────────────────────────────────────────────────
//
//   allowManualConfirmation   OFF by default, and it must stay that way. A "manually confirmed" number is a
//                             manager's JUDGEMENT, not cryptographic evidence, and the spec is right that a tenant
//                             should have to choose to allow it. Defaulting it on would quietly convert every
//                             salon into one where a phone can be marked usable without anybody ever proving it.
//
//   allowReceptionistUpdates  A receptionist is who a social engineer calls. Turning this off is a real control,
//                             not a preference — and a tenant being targeted needs it to actually work.
import type { AuditSink } from '@aipowersalon/audit';
import type { PhoneSettings } from './customer-phone-update.service';
import { hasPermission } from '@aipowersalon/permissions';

export class PhoneSettingsError extends Error {
  constructor(msg: string, readonly code: 'forbidden' | 'invalid' | 'not_found') { super(msg); }
}

export interface PhoneSettingsStore {
  get(tenantId: string, branchId: string | null): Promise<PhoneSettings | null>;
  upsert(tenantId: string, branchId: string | null, s: PhoneSettings, actorUserId: string | null): Promise<void>;
  /** The branch's OWN row only (no inheritance), or null. */
  getOwn?(tenantId: string, branchId: string): Promise<PhoneSettings | null>;
  /** Does this branch belong to this salon? */
  branchBelongs?(tenantId: string, branchId: string): Promise<boolean>;
  /** Delete a branch's override. */
  deleteBranch?(tenantId: string, branchId: string): Promise<boolean>;
}

const SETTING_KEYS: (keyof PhoneSettings)[] = [
  'allowReceptionistUpdates', 'requireSmsVerification', 'allowPendingUnverified', 'allowSharedFamilyPhones',
  'customerAppSelfService', 'notifyOldNumber', 'allowManualConfirmation', 'requireManagerApproval', 'requireReauthentication',
];

export const PHONE_SETTINGS_DEFAULTS: PhoneSettings = {
  allowReceptionistUpdates: true,
  requireSmsVerification: true,
  allowPendingUnverified: true,
  allowSharedFamilyPhones: true,
  customerAppSelfService: true,
  notifyOldNumber: true,
  // OFF. See the header.
  allowManualConfirmation: false,
  requireManagerApproval: false,
  requireReauthentication: true,
};

/** Only an owner or a manager configures this. A receptionist changing the rules that constrain receptionists is
 *  not a permission model. */
// BUILD_PLAN Phase 9: was CAN_EDIT = ['OWNER', 'MANAGER'] — a role NAME check behind the route's own key. The policy is
// edited with pos.customers.phone.settings (→ customers.phone_manage: owners and managers by default).
const EDIT_PERM = 'pos.customers.phone.settings';
const canEdit = (a: { role: string; permissions?: readonly string[] }) => hasPermission({ tenantId: '', branchId: '', userId: '', role: a.role as any, permissions: [...(a.permissions ?? [])] }, EDIT_PERM);

export class CustomerPhoneSettingsService {
  constructor(
    private readonly store: PhoneSettingsStore,
    private readonly audit?: AuditSink,
  ) {}

  async get(tenantId: string, branchId: string | null): Promise<PhoneSettings> {
    return (await this.store.get(tenantId, branchId)) ?? PHONE_SETTINGS_DEFAULTS;
  }

  /** A branch's effective policy and whether it has its own override. */
  async getBranch(tenantId: string, branchId: string): Promise<PhoneSettings & { branchOverride: boolean }> {
    if (this.store.branchBelongs && !(await this.store.branchBelongs(tenantId, branchId))) throw new PhoneSettingsError('Branch not found.', 'not_found');
    const own = this.store.getOwn ? await this.store.getOwn(tenantId, branchId) : null;
    return { ...(await this.get(tenantId, branchId)), branchOverride: !!own };
  }

  async clearBranch(actor: { tenantId: string; branchId: string; userId: string; role: string; permissions?: readonly string[] }): Promise<{ ok: true; removed: boolean }> {
    if (!canEdit(actor)) throw new PhoneSettingsError('Only an owner or a manager can change phone-management settings.', 'forbidden');
    if (this.store.branchBelongs && !(await this.store.branchBelongs(actor.tenantId, actor.branchId))) throw new PhoneSettingsError('Branch not found.', 'not_found');
    const removed = this.store.deleteBranch ? await this.store.deleteBranch(actor.tenantId, actor.branchId) : false;
    await this.audit?.record({ tenantId: actor.tenantId, branchId: actor.branchId, userId: actor.userId, module: 'customer_phone', action: 'phone_settings_branch_override_removed', metadata: { removed, role: actor.role } }).catch(() => undefined);
    return { ok: true, removed };
  }

  async update(
    actor: { tenantId: string; branchId: string | null; userId: string; role: string; permissions?: readonly string[] },
    patch: Partial<PhoneSettings>,
  ): Promise<PhoneSettings> {
    if (!canEdit(actor)) {
      throw new PhoneSettingsError('Only an owner or a manager can change phone-management settings.', 'forbidden');
    }
    if (actor.branchId && this.store.branchBelongs && !(await this.store.branchBelongs(actor.tenantId, actor.branchId))) {
      throw new PhoneSettingsError('Branch not found.', 'not_found');
    }
    // Only known keys, only booleans — a body is not a settings row.
    const clean: Partial<PhoneSettings> = {};
    for (const k of SETTING_KEYS) if (typeof (patch as any)?.[k] === 'boolean') (clean as any)[k] = (patch as any)[k];

    const current = await this.get(actor.tenantId, actor.branchId);
    const next: PhoneSettings = { ...current, ...clean };

    // ── requireSmsVerification: false is a SUPPORTED, DELIBERATE configuration ──────────────────────────
    //
    // It means: **a staff phone change takes effect immediately, without an OTP.** The number becomes
    // `active_unverified` — usable for calls, texts and appointment reminders, and honestly labelled as never
    // having been proved.
    //
    // It does NOT mean verification disappears. It moves it to where it actually protects something:
    //
    //     `canCompleteBookingVerification()` requires `active_verified`.
    //
    // So the moment that customer tries to book remotely, the booking gate sees an unproven number and sends a
    // code. **Verification happens at BOOKING, which is the only place a fake number does real damage** — a fake
    // appointment, a no-show attack, an abused slot.
    //
    // An earlier version of this file REFUSED this combination, on the grounds that "no number could ever be
    // verified". That was wrong, and it was wrong in an expensive direction: it forced a salon to run an OTP on
    // every counter correction — a customer reading out their new number to a receptionist standing in front of
    // them — to protect against nothing. The customer is RIGHT THERE. The receptionist is looking at them.
    //
    // What the salon accepts by turning this off is narrower and worth stating plainly: **a mistyped number means
    // the salon starts texting a stranger.** Reminders, not bookings. That is a real cost, and it is theirs to
    // weigh — it is not a security hole, and refusing to let them weigh it was paternalism wearing a safety
    // jacket.

    await this.store.upsert(actor.tenantId, actor.branchId, next, actor.userId);

    await this.audit?.record({
      tenantId: actor.tenantId, branchId: actor.branchId, userId: actor.userId,
      module: 'customer_phone', action: 'phone_settings_changed',
      // Recorded because these are SECURITY settings, not preferences: turning manual confirmation on, or
      // receptionist updates off, changes who can move a customer's phone number and how.
      metadata: {
        allowManualConfirmation: next.allowManualConfirmation,
        allowReceptionistUpdates: next.allowReceptionistUpdates,
        requireSmsVerification: next.requireSmsVerification,
        requireManagerApproval: next.requireManagerApproval,
        requireReauthentication: next.requireReauthentication,
        branchOverride: actor.branchId ?? null,
        role: actor.role,
      },
    }).catch(() => undefined);

    return next;
  }
}

// tenant-auth-policy.ts — Constitution 3 §176 (Step 9, Oct 3 2026): the salon's sign-in policy (settings category
// `security`) is ENFORCED. It was saved and never read.
//   mfaForOwner            → owners and managers must use two-factor (with no authenticator yet: a session limited to
//                            setting one up — never a lock-out);
//   rememberTrustedDevices → off: devices cannot be trusted;
//   passkeyEnabled         → off: Face ID / passkey sign-in and registration are refused;
//   pinLogin               → off: an idle-locked screen needs a full sign-in, not the PIN.
//   autoLockEnabled / autoLockMinutes → Kevin, Oct 12 2026: the POS auto-lock, ON at 60 minutes unless the salon chose
//                            otherwise — enforced by the server on POS sessions (session-store.ts). Unlike the four above,
//                            this default applies to EVERY salon, saved policy or not (it is Kevin's default, not a change).
// A salon that never saved the policy keeps today's behaviour (the stored defaults include passkeys OFF, and enforcing
// that default would switch Face ID off for every salon) — only an explicitly saved policy is enforced.
import { sql } from 'kysely';
import { autoLockPolicyFrom, AUTO_LOCK_DEFAULT } from '@aipowersalon/api-contracts';

export interface TenantAuthPolicy { explicit: boolean; mfaForOwner: boolean; rememberTrustedDevices: boolean; passkeyEnabled: boolean; pinLogin: boolean; autoLockEnabled: boolean; autoLockMinutes: number }
export const PLATFORM_DEFAULT_POLICY: TenantAuthPolicy = { explicit: false, mfaForOwner: false, rememberTrustedDevices: true, passkeyEnabled: true, pinLogin: true, autoLockEnabled: AUTO_LOCK_DEFAULT.enabled, autoLockMinutes: AUTO_LOCK_DEFAULT.minutes };
export const MFA_ENROLLMENT_REQUIRED = 'MFA_ENROLLMENT_REQUIRED' as const;
/** Roles the salon's "require two-factor" setting applies to. */
export const POLICY_MFA_ROLES = ['OWNER', 'MANAGER'] as const;
export function policyFromStored(stored: any): TenantAuthPolicy {
  if (!stored || typeof stored !== 'object') return PLATFORM_DEFAULT_POLICY;
  const b = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const lock = autoLockPolicyFrom(stored);
  return { explicit: true, mfaForOwner: b(stored.mfaForOwner, false), rememberTrustedDevices: b(stored.rememberTrustedDevices, true), passkeyEnabled: b(stored.passkeyEnabled, true), pinLogin: b(stored.pinLogin, true), autoLockEnabled: lock.enabled, autoLockMinutes: lock.minutes };
}
export interface TenantAuthPolicyPort { get(tenantId: string): Promise<TenantAuthPolicy> }
export class KyselyTenantAuthPolicy implements TenantAuthPolicyPort {
  private cache = new Map<string, { p: TenantAuthPolicy; at: number }>();
  constructor(private readonly db: any, private readonly ttlMs = 60_000, private readonly now: () => number = () => Date.now()) {}
  async get(tenantId: string): Promise<TenantAuthPolicy> {
    if (!tenantId) return PLATFORM_DEFAULT_POLICY;
    const hit = this.cache.get(tenantId); if (hit && this.now() - hit.at < this.ttlMs) return hit.p;
    let p = PLATFORM_DEFAULT_POLICY;
    try {
      // the most recently saved `security` row of the salon (settings are saved per branch; the policy is salon-wide)
      const r: any = (await sql`select settings_json from tenant_settings where tenant_id = ${tenantId}::uuid and category = 'security' order by updated_at desc nulls last limit 1`.execute(this.db)).rows[0];
      p = policyFromStored(r?.settings_json);
    } catch { /* fall back to today's behaviour; never block sign-in on a policy read */ }
    this.cache.set(tenantId, { p, at: this.now() });
    return p;
  }
}

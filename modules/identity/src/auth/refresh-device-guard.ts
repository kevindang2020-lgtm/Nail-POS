// refresh-device-guard.ts — the port refresh-token rotation asks before it extends a session that was opened on a payment
// phone (Secure Tap to Pay mandate §2 / §16 / §61: "refresh … from revoked phone → denied"). Identity owns rotation but not
// the payment-device registry, so it only defines the question; the module that owns mobile_pay_devices provides
// REFRESH_DEVICE_GUARD (today: modules/checkout MobileCheckoutModule). Resolved lazily through ModuleRef (strict: false),
// the same pattern as BRANCH_SWITCH_GUARD — identity never imports checkout. Not provided → no device check (a slice of the
// API without the payment module behaves as before). A guard that THROWS fails the refresh closed (503), never open.

export const REFRESH_DEVICE_GUARD = 'REFRESH_DEVICE_GUARD';

export interface RefreshDeviceQuestion {
  tenantId: string;
  userId: string;
  /** sessions.device_id — the per-install id the app signed in with (the payment phone's device id, when it is one). */
  deviceId: string;
  sessionId: string;
}

/** endSession: true → the session and its whole refresh family are revoked (a revoked / compromised phone is final);
 *  false → this refresh is refused but the session survives (a SUSPENDED phone may be re-activated by the owner). */
export interface RefreshDeviceBlock { code: 'DEVICE_REVOKED' | 'DEVICE_SUSPENDED'; endSession: boolean }

export interface RefreshDeviceGuardPort {
  /** null = not a payment device, or one in good standing; otherwise why this session may not be extended. */
  refreshBlock(q: RefreshDeviceQuestion): Promise<RefreshDeviceBlock | null>;
}

/** What resolveRefreshDeviceGuard needs of Nest's ModuleRef (kept structural so identity's tests need no Nest container). */
export interface GuardLookup { get<T>(token: string, opts: { strict: boolean }): T }

/**
 * The guard the payment module registered, looked up lazily (the payment module may be wired after identity). A deployment
 * without one says so ONCE in the log and refreshes without a device check — the behaviour before M6-6. A found guard is
 * cached; a missing one is looked up again next time (module init order), still logged only once.
 */
export function refreshDeviceGuardResolver(moduleRef: GuardLookup | null | undefined): () => RefreshDeviceGuardPort | null {
  let found: RefreshDeviceGuardPort | null = null; let said = false;
  return () => {
    if (found || !moduleRef) return found;
    try { found = moduleRef.get<RefreshDeviceGuardPort>(REFRESH_DEVICE_GUARD, { strict: false }) ?? null; }
    catch (e) {
      if (!said) { said = true; console.warn('[refresh] no REFRESH_DEVICE_GUARD in this app — refresh rotation does not check payment devices:', (e as Error)?.message); }
      found = null;
    }
    return found;
  };
}

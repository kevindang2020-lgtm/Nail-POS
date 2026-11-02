import type { ReadinessCheck, ReadinessReport, CheckState } from '@aipowersalon/api-contracts/tenant';
export type { ReadinessCheck, ReadinessReport, CheckState };   // owned by packages/api-contracts (Constitution 13 §13)
import type { OverallStatus } from '@aipowersalon/api-contracts/tenant';
export type { OverallStatus };   // owned by packages/api-contracts (Constitution 13 §13)
// mobile-checkout-readiness.ts — pure, I/O-free readiness logic for the Owner & Manager Payment App.
//
// Implements the spec's hard rule: NEVER report "ready" when a critical check is unavailable or stale. `canTakePayment`
// is true only when every critical leg is ok, so the app cannot start a card-present payment on a half-ready device.
// This is intentionally a pure function so it is exhaustively unit-tested without a DB, processor, or device.



// GatewayStatus: ONE definition, the tenant contract's (Constitution 13 §15) — this module had its own copy.
export type { GatewayStatus } from '@aipowersalon/api-contracts/tenant';
import type { GatewayStatus } from '@aipowersalon/api-contracts/tenant';

export interface ReadinessFacts {
  backendUp: boolean;          // this API is responding (always true if we got here, but kept explicit)
  posSyncUp: boolean;          // canonical checkout/ticket store reachable
  gatewayStatus: GatewayStatus;
  gatewayConfigured: boolean;  // a usable tenant-bound processor was built
  tapToPayConfigured: boolean; // CommerceHub TTP creds present (see ttp-config.ts)
  smsReceiptConfigured: boolean;
  emailReceiptConfigured: boolean;
  appVersionOk: boolean;       // client app version >= required
  deviceApproved: boolean;     // this device is approved for this tenant/branch
  deviceSupported: boolean;    // supported iPhone + iOS for Tap to Pay
  /** mandate §197–§199: the platform / provider kill switch is on (Tap to Pay off; terminals and cash unaffected) */
  /** 'rollout' (Oct 21 2026): the mobile_tap_to_pay flag is not rolled out to / is killed for this salon (§208) */
  tapToPayDisabledReason?: 'platform' | 'provider' | 'rollout' | null;
  /** mandate §190: why the device is refused (DEVICE_NOT_AUTHORIZED | DEVICE_REVOKED) */
  deviceBlockReason?: 'DEVICE_NOT_AUTHORIZED' | 'DEVICE_REVOKED' | 'DEVICE_NOT_REGISTERED' | 'DEVICE_PENDING_APPROVAL' | 'DEVICE_SUSPENDED' | 'DEVICE_BRANCH_NOT_AUTHORIZED';
}



function gatewayToStates(status: GatewayStatus, configured: boolean): { processor: CheckState; merchant: CheckState } {
  if (status === 'active' && configured) return { processor: 'ok', merchant: 'ok' };
  if (status === 'error') return { processor: 'unavailable', merchant: 'unavailable' };
  // not_configured / pending / disabled / paused → the rail may be fine but this tenant's merchant isn't usable yet
  return { processor: 'ok', merchant: 'setup_required' };
}

/** Build the readiness checklist + derive the overall status. Pure. */
export function computeReadiness(facts: ReadinessFacts, now: Date = new Date()): ReadinessReport {
  const { processor, merchant } = gatewayToStates(facts.gatewayStatus, facts.gatewayConfigured);

  const checks: ReadinessCheck[] = [
    { key: 'backend', label: 'AI PowerSalon Backend', critical: true, state: facts.backendUp ? 'ok' : 'unavailable' },
    { key: 'pos_sync', label: 'POS Checkout Sync', critical: true, state: facts.posSyncUp ? 'ok' : 'unavailable' },
    { key: 'processor', label: 'Payment Processor', critical: true, state: processor },
    { key: 'merchant', label: 'Merchant Account', critical: true, state: merchant,
      detail: merchant === 'setup_required' ? 'This branch merchant account is not active yet.' : undefined },
    { key: 'tap_to_pay', label: 'Tap to Pay', critical: true,
      state: facts.tapToPayDisabledReason ? 'unavailable' : facts.tapToPayConfigured ? 'ok' : 'setup_required',
      detail: facts.tapToPayDisabledReason === 'platform' ? 'Tap to Pay is currently switched off by the platform. Use the terminal, cash or another payment option.'
        : facts.tapToPayDisabledReason === 'provider' ? 'Tap to Pay through this provider is currently switched off. Use the terminal, cash or another payment option.'
        : facts.tapToPayDisabledReason === 'rollout' ? 'Tap to Pay is not enabled for this salon yet (platform rollout). Use the terminal, cash or another payment option.'
        : facts.tapToPayConfigured ? undefined : 'Tap to Pay on iPhone is not onboarded (Apple entitlement + CommerceHub).' },
    { key: 'device', label: 'Device Security', critical: true,
      state: !facts.deviceSupported ? 'unavailable' : !facts.deviceApproved ? 'setup_required' : 'ok',
      detail: !facts.deviceSupported ? 'This iPhone/iOS does not support Tap to Pay.' : !facts.deviceApproved ? (facts.deviceBlockReason === 'DEVICE_REVOKED' ? 'This phone’s payment access has been revoked.' : facts.deviceBlockReason === 'DEVICE_SUSPENDED' ? 'This payment device is suspended.' : facts.deviceBlockReason === 'DEVICE_NOT_REGISTERED' ? 'This phone is not registered as a payment device.' : facts.deviceBlockReason === 'DEVICE_BRANCH_NOT_AUTHORIZED' ? 'This phone is not authorized for this location.' : facts.deviceBlockReason === 'DEVICE_PENDING_APPROVAL' ? 'This device is waiting for the owner’s approval.' : 'This device is not approved.') : undefined },
    { key: 'app_version', label: 'App Version', critical: true, state: facts.appVersionOk ? 'ok' : 'unavailable',
      detail: facts.appVersionOk ? undefined : 'A newer app version is required.' },
    { key: 'sms_receipt', label: 'SMS Receipt', critical: false, state: facts.smsReceiptConfigured ? 'ok' : 'warn' },
    { key: 'email_receipt', label: 'Email Receipt', critical: false, state: facts.emailReceiptConfigured ? 'ok' : 'warn' },
  ];

  const criticalNotOk = checks.filter((c) => c.critical && c.state !== 'ok');
  const canTakePayment = criticalNotOk.length === 0;

  // Overall status: pick the most blocking critical failure first, then warnings, then ready.
  let overall: OverallStatus;
  if (!facts.backendUp || !facts.posSyncUp) overall = 'backend_unavailable';
  else if (!facts.appVersionOk) overall = 'update_required';
  else if (processor === 'unavailable' || facts.tapToPayDisabledReason) overall = 'processor_unavailable';
  else if (!facts.deviceSupported) overall = 'device_unsupported';
  else if (!facts.deviceApproved) overall = 'authentication_required';
  else if (merchant === 'setup_required') overall = 'merchant_setup_required';
  else if (!facts.tapToPayConfigured) overall = 'tap_to_pay_setup_required';
  else if (checks.some((c) => !c.critical && c.state === 'warn')) overall = 'ready_with_warning';
  else overall = 'ready';

  return { overall, canTakePayment, checks, generatedAt: now.toISOString(), ...(facts.deviceBlockReason && !facts.deviceApproved ? { deviceBlockReason: facts.deviceBlockReason } : {}) } as ReadinessReport;
}

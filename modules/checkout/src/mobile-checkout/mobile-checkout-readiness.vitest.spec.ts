import { describe, it, expect } from 'vitest';
import { computeReadiness, type ReadinessFacts } from './mobile-checkout-readiness';
import { can } from '@aipowersalon/permissions';

const ALL_OK: ReadinessFacts = {
  backendUp: true, posSyncUp: true, gatewayStatus: 'active', gatewayConfigured: true,
  tapToPayConfigured: true, smsReceiptConfigured: true, emailReceiptConfigured: true,
  appVersionOk: true, deviceApproved: true, deviceSupported: true,
};

describe('mobile-checkout readiness core', () => {
  it('reports ready + canTakePayment only when every critical leg is ok', () => {
    const r = computeReadiness(ALL_OK);
    expect(r.overall).toBe('ready');
    expect(r.canTakePayment).toBe(true);
    expect(r.checks.find((c) => c.key === 'tap_to_pay')!.state).toBe('ok');
  });

  it('NEVER reports ready when a critical check is unavailable (backend down)', () => {
    const r = computeReadiness({ ...ALL_OK, backendUp: false });
    expect(r.overall).toBe('backend_unavailable');
    expect(r.canTakePayment).toBe(false);
  });

  it('Tap to Pay not onboarded -> tap_to_pay_setup_required, cannot take payment', () => {
    const r = computeReadiness({ ...ALL_OK, tapToPayConfigured: false });
    expect(r.overall).toBe('tap_to_pay_setup_required');
    expect(r.canTakePayment).toBe(false);
    expect(r.checks.find((c) => c.key === 'tap_to_pay')!.state).toBe('setup_required');
  });

  it('merchant not active -> merchant_setup_required, cannot take payment', () => {
    const r = computeReadiness({ ...ALL_OK, gatewayStatus: 'not_configured', gatewayConfigured: false });
    expect(r.overall).toBe('merchant_setup_required');
    expect(r.canTakePayment).toBe(false);
  });

  it('processor error -> processor_unavailable', () => {
    const r = computeReadiness({ ...ALL_OK, gatewayStatus: 'error', gatewayConfigured: false });
    expect(r.overall).toBe('processor_unavailable');
    expect(r.canTakePayment).toBe(false);
  });

  it('unsupported device / unapproved device block payment', () => {
    expect(computeReadiness({ ...ALL_OK, deviceSupported: false }).overall).toBe('device_unsupported');
    expect(computeReadiness({ ...ALL_OK, deviceApproved: false }).overall).toBe('authentication_required');
    expect(computeReadiness({ ...ALL_OK, deviceApproved: false }).canTakePayment).toBe(false);
  });

  it('receipts unconfigured is only a warning, still able to take payment', () => {
    const r = computeReadiness({ ...ALL_OK, smsReceiptConfigured: false, emailReceiptConfigured: false });
    expect(r.overall).toBe('ready_with_warning');
    expect(r.canTakePayment).toBe(true);
  });
});

describe('mobile_checkout RBAC', () => {
  it('grants tap_to_pay to OWNER and MANAGER only', () => {
    expect(can('OWNER', 'mobile_checkout.tap_to_pay' as any)).toBe(true);
    expect(can('MANAGER', 'mobile_checkout.tap_to_pay' as any)).toBe(true);
    expect(can('FRONT_DESK', 'mobile_checkout.tap_to_pay' as any)).toBe(false);
    expect(can('TECHNICIAN', 'mobile_checkout.tap_to_pay' as any)).toBe(false);
    expect(can('CUSTOMER', 'mobile_checkout.tap_to_pay' as any)).toBe(false);
  });
  it('grants the full mobile_checkout set to MANAGER', () => {
    for (const p of ['login', 'view_queue', 'open_ticket', 'split_payment', 'refund_request', 'void_request']) {
      expect(can('MANAGER', `mobile_checkout.${p}` as any)).toBe(true);
    }
  });
});

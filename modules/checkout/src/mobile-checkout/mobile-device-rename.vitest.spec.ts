// mobile-device-rename.vitest.spec.ts — Secure Tap to Pay §15 (Oct 26 2026): the owner renames a payment phone.
// pos.devices.manage only; the name is cleaned (control / bidi / zero-width characters, whitespace) and cut to 80; an empty
// name is refused; a revoked phone keeps its name; another salon's phone is not_found; the change is audited before / after.
import { describe, it, expect, vi } from 'vitest';
import { MobileCheckoutService, AttemptError } from './mobile-checkout.service';
import { InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import { InMemoryMobilePayDeviceStore, sanitizeDeviceLabel, DEVICE_LABEL_MAX } from './mobile-pay-device';

const owner = { tenantId: 'T1', branchId: 'B1', userId: 'u-owner', role: 'OWNER', permissions: ['pos.devices.manage', 'mobile_checkout.login'] } as any;
const manager = { ...owner, userId: 'u-mgr', role: 'MANAGER', permissions: ['mobile_checkout.login'] };

async function setup() {
  const devices = new InMemoryMobilePayDeviceStore();
  await devices.upsertOnRegister('T1', { deviceId: 'ph-1', label: 'iPhone', registeredBy: 'u-mgr' });
  await devices.upsertOnRegister('T2', { deviceId: 'ph-x', label: 'Other salon', registeredBy: 'u-x' });
  const audit = { record: vi.fn() };
  const svc = new MobileCheckoutService(undefined as any, {} as any, {} as any, {} as any, new InMemoryMobilePaymentAttemptRepository(), undefined, devices, undefined, undefined, { audit });
  return { svc, devices, audit };
}

describe('sanitizeDeviceLabel', () => {
  it('cleans and limits', () => {
    expect(sanitizeDeviceLabel('  Front\tDesk \n iPhone ')).toBe('Front Desk iPhone');
    expect(sanitizeDeviceLabel('Pay\u202Eenohp')).toBe('Payenohp');          // a right-to-left override is removed
    expect(sanitizeDeviceLabel('a\u200Bb\u0000c')).toBe('ab c');
    expect(sanitizeDeviceLabel('x'.repeat(200))).toHaveLength(DEVICE_LABEL_MAX);
    expect(sanitizeDeviceLabel('   ')).toBeNull();
    expect(sanitizeDeviceLabel('\u202E')).toBeNull();
    expect(sanitizeDeviceLabel(42)).toBeNull();
    expect(sanitizeDeviceLabel('Bé Hoá phone')).toBe('Bé Hoá phone');    // NFC: one character per letter
  });
});

describe('renameDevice (§15)', () => {
  it('the owner renames a phone: cleaned name stored, audited mobile_pay_device_renamed with before / after', async () => {
    const { svc, devices, audit } = await setup();
    const r = await svc.renameDevice(owner, 'ph-1', '  Front   Desk\u202E ');
    expect(r.label).toBe('Front Desk');
    expect((await devices.get('T1', 'ph-1'))?.label).toBe('Front Desk');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'T1', userId: 'u-owner' }), expect.objectContaining({ action: 'mobile_pay_device_renamed', resourceId: 'ph-1', metadata: { before: 'iPhone', after: 'Front Desk' } }));
  });
  it('the same name again changes nothing and writes no audit line', async () => {
    const { svc, audit } = await setup();
    await svc.renameDevice(owner, 'ph-1', 'iPhone');
    expect(audit.record).not.toHaveBeenCalled();
  });
  it('without pos.devices.manage → PAYMENT_PERMISSION_DENIED; nothing changes', async () => {
    const { svc, devices } = await setup();
    await expect(svc.renameDevice(manager, 'ph-1', 'Mine now')).rejects.toMatchObject({ code: 'PAYMENT_PERMISSION_DENIED' });
    expect((await devices.get('T1', 'ph-1'))?.label).toBe('iPhone');
  });
  it('an empty / whitespace / control-only name is refused (invalid)', async () => {
    const { svc } = await setup();
    for (const bad of ['', '   ', '\u200B\u202E', null, 7]) await expect(svc.renameDevice(owner, 'ph-1', bad)).rejects.toMatchObject({ code: 'invalid' });
  });
  it('another salon\'s phone is not_found (no cross-tenant rename) and a revoked phone keeps its name', async () => {
    const { svc, devices } = await setup();
    await expect(svc.renameDevice(owner, 'ph-x', 'Hijack')).rejects.toMatchObject({ code: 'not_found' });
    expect((await devices.get('T2', 'ph-x'))?.label).toBe('Other salon');
    await devices.setStatus('T1', 'ph-1', 'revoked', 'u-owner', 'lost');
    await expect(svc.renameDevice(owner, 'ph-1', 'New')).rejects.toBeInstanceOf(AttemptError);
    expect((await devices.get('T1', 'ph-1'))?.label).toBe('iPhone');
  });
  it('a phone re-registering with its own name never overwrites the owner\'s', async () => {
    const { svc, devices } = await setup();
    await svc.renameDevice(owner, 'ph-1', 'Front Desk');
    await devices.upsertOnRegister('T1', { deviceId: 'ph-1', label: 'iPhone', registeredBy: 'u-mgr', appVersion: '2.0' });
    expect((await devices.get('T1', 'ph-1'))?.label).toBe('Front Desk');
  });
});
